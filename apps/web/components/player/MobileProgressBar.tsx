/**
 * MobileProgressBar — the HEVC player's timeline, ported to the web.
 *
 * Geometry matches apps/mobile/components/player/ProgressBar: a 44px hit area
 * whose visible track is inset 10px per side (so the thumb never clips at the
 * edges while the gutters still seek to 0%/100%), a 3.5px track that swells to
 * 6px while dragging, a dim-gold buffered fill behind the gold playhead, and a
 * scrub bubble instead of a hover tooltip.
 *
 * PERF: the 60fps loop writes the fill width and thumb position STRAIGHT to
 * `element.style` and never touches React state to do it. The previous version
 * called setDisplayTime/setDuration/setBuffered every frame — and getBuffered()
 * allocates a fresh TimeRanges object per call, so `Object.is` was never equal
 * and the component re-rendered 60×/s for the entire playback session. That
 * competes with movi's own requestAnimationFrame presentation loop
 * (CanvasRenderer.presentationLoop) on the same main thread, and a stretched
 * frame there is a dropped video frame. React is now only asked to render when
 * something a human can perceive changes: the whole-second aria value (~1/s),
 * the duration, the buffered ranges (~2/s) and the scrub bubble while dragging.
 */

"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
} from "react";
import type { PlayerAdapter, TimeRange } from "./player-adapters";

const VISUAL_INSET = 10;
/** Half the bubble width — clamps the scrub bubble inside the track. */
const BUBBLE_HALF = 44;
/** Buffered ranges are polled twice a second — nobody sees them move faster. */
const BUFFERED_EVERY_FRAMES = 30;

interface MobileProgressBarProps {
  player: PlayerAdapter;
  onSeek: (time: number) => void;
  onSeekStart?: () => void;
  onSeekEnd?: () => void;
  /** False while the chrome is faded out — stops the rAF loop entirely. */
  active?: boolean;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function MobileProgressBar({
  player,
  onSeek,
  onSeekStart,
  onSeekEnd,
  active = true,
}: MobileProgressBarProps) {
  const [displayTime, setDisplayTime] = useState(player.getCurrentTime());
  const [duration, setDuration] = useState(player.getDuration());
  const [buffered, setBuffered] = useState<TimeRange[]>(() => {
    try {
      return player.getBuffered();
    } catch {
      return [];
    }
  });
  const [isDragging, setIsDragging] = useState(false);
  const [bubble, setBubble] = useState<{ x: number; text: string } | null>(
    null,
  );

  const hitRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const rowWidthRef = useRef(0);
  const lastPctRef = useRef(-1);
  const lastSecRef = useRef(-1);
  const lastDurationRef = useRef(player.getDuration());

  /**
   * Imperative playhead. React never puts `width`/`left` into the style object
   * for these two nodes, so its re-renders can't clobber what we write here
   * (React only diffs properties present in both the previous and next style
   * objects).
   */
  const paint = useCallback((pct: number) => {
    const clamped = pct < 0 ? 0 : pct > 100 ? 100 : pct;
    if (Math.abs(clamped - lastPctRef.current) < 0.02) return;
    lastPctRef.current = clamped;
    const value = `${clamped}%`;
    if (fillRef.current) fillRef.current.style.width = value;
    if (thumbRef.current) thumbRef.current.style.left = value;
  }, []);

  const pctFor = useCallback((time: number): number => {
    const d = lastDurationRef.current;
    if (!isFinite(d) || d <= 0) return 0;
    return (time / d) * 100;
  }, []);

  /** Only re-render when the aria value would actually print differently. */
  const commitSecond = useCallback((time: number) => {
    const sec = Math.floor(time);
    if (sec === lastSecRef.current) return false;
    lastSecRef.current = sec;
    setDisplayTime(time);
    return true;
  }, []);

  // 60fps sync loop — reads the adapter directly so the playhead glides
  // regardless of how rarely the decoder emits `timeupdate`.
  useEffect(() => {
    if (!active) return;
    let frames = 0;
    const tick = () => {
      if (!isDraggingRef.current) {
        const t = player.getCurrentTime();
        const d = player.getDuration();
        if (d !== lastDurationRef.current) {
          lastDurationRef.current = d;
          setDuration(d);
        }
        paint(pctFor(t));
        commitSecond(t);
        if (++frames >= BUFFERED_EVERY_FRAMES) {
          frames = 0;
          try {
            setBuffered(player.getBuffered());
          } catch {
            /* adapters may not be ready mid-teardown */
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [player, active, paint, pctFor, commitSecond]);

  // Re-sync immediately when the loop starts or the duration arrives, so the
  // thumb never flashes at the left edge on (re)mount.
  useLayoutEffect(() => {
    if (isDraggingRef.current) return;
    const d = player.getDuration();
    if (d !== lastDurationRef.current) {
      lastDurationRef.current = d;
      setDuration(d);
    }
    const t = player.getCurrentTime();
    paint(pctFor(t));
    commitSecond(t);
  }, [player, active, duration, paint, pctFor, commitSecond]);

  const durationOk = isFinite(duration) && duration > 0;

  // Map a client X to a time against the INSET track row: X outside the row
  // (the gutters) clamps to 0% / 100%, matching mobile's full-bleed gesture.
  const getTimeFromPosition = useCallback(
    (clientX: number): number => {
      if (!rowRef.current || !durationOk) return 0;
      const rect = rowRef.current.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      return (x / rect.width) * duration;
    },
    [duration, durationOk],
  );

  const bubbleXFor = useCallback((clientX: number): number => {
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const width = rowWidthRef.current || rect.width;
    const x = clientX - rect.left;
    return Math.max(BUBBLE_HALF, Math.min(width - BUBBLE_HALF, x));
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const rect = rowRef.current?.getBoundingClientRect();
    rowWidthRef.current = rect?.width ?? 0;
    isDraggingRef.current = true;
    setIsDragging(true);
    onSeekStart?.();
    const time = getTimeFromPosition(e.clientX);
    paint(pctFor(time));
    commitSecond(time);
    setBubble({ x: bubbleXFor(e.clientX), text: formatTime(time) });
    onSeek(time);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const time = getTimeFromPosition(e.clientX);
    // Track the finger imperatively — waiting for a render to move the thumb
    // during a drag makes the playhead lag behind the finger.
    paint(pctFor(time));
    commitSecond(time);
    setBubble({ x: bubbleXFor(e.clientX), text: formatTime(time) });
    onSeek(time);
  };

  const endDrag = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    setBubble(null);
    onSeekEnd?.();
  }, [onSeekEnd]);

  useEffect(() => {
    if (!isDragging) return;
    const up = () => endDrag();
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [isDragging, endDrag]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!durationOk) return;
    e.preventDefault();
    switch (e.key) {
      case "ArrowLeft":
        onSeekStart?.();
        onSeek(Math.max(0, displayTime - 5));
        onSeekEnd?.();
        break;
      case "ArrowRight":
        onSeekStart?.();
        onSeek(Math.min(duration, displayTime + 5));
        onSeekEnd?.();
        break;
      case "Home":
        onSeekStart?.();
        onSeek(0);
        onSeekEnd?.();
        break;
      case "End":
        onSeekStart?.();
        onSeek(duration);
        onSeekEnd?.();
        break;
    }
  };

  const trackHeight = isDragging ? 6 : 3.5;
  const thumbSize = isDragging ? 18 : 14;

  return (
    <div
      ref={hitRef}
      className="relative h-11 w-full cursor-pointer touch-none select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      role="slider"
      aria-label="Video progress"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={displayTime}
      aria-valuetext={`${formatTime(displayTime)} of ${formatTime(duration)}`}
      tabIndex={0}
    >
      {/* Visible track — inset so the thumb never clips off either edge */}
      <div
        ref={rowRef}
        className="absolute inset-y-0 rounded-full"
        style={{ left: VISUAL_INSET, right: VISUAL_INSET }}
      >
        {/* Base track */}
        <div
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-white/[0.22]"
          style={{ height: trackHeight }}
        />

        {/* Buffered ranges — dim gold behind the playhead */}
        {durationOk &&
          buffered.map((range, i) => {
            const startPct = (range.start / duration) * 100;
            const widthPct = ((range.end - range.start) / duration) * 100;
            if (startPct + widthPct < lastPctRef.current) return null;
            return (
              <div
                key={i}
                className="absolute top-1/2 -translate-y-1/2 rounded-full bg-[#D4A237]/30"
                style={{
                  height: trackHeight,
                  left: `${startPct}%`,
                  width: `${Math.max(0, widthPct)}%`,
                }}
              />
            );
          })}

        {/* Played fill — `width` is owned by `paint()`, not by React */}
        <div
          ref={fillRef}
          className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-[#D4A237] will-change-[width]"
          style={{ height: trackHeight }}
          aria-hidden="true"
        />

        {/* Thumb — `left` is owned by `paint()`, not by React */}
        <div
          ref={thumbRef}
          className="absolute top-1/2 flex items-center justify-center rounded-full will-change-[left]"
          style={{
            width: thumbSize,
            height: thumbSize,
            marginLeft: -thumbSize / 2,
            transform: "translateY(-50%)",
            backgroundColor: "#D4A237",
            transition: "width 120ms ease, height 120ms ease",
          }}
          aria-hidden="true"
        />

        {/* Scrub bubble */}
        {bubble && (
          <div
            className="pointer-events-none absolute bottom-full mb-1.5 flex w-[88px] items-center justify-center rounded-[10px] bg-black/85 py-1.5"
            style={{ left: bubble.x, transform: "translateX(-50%)" }}
          >
            <span className="text-xs font-bold tabular-nums text-[#F4F4F5]">
              {bubble.text}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
