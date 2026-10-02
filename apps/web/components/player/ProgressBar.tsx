/**
 * ProgressBar — smooth, 60fps scrubbable progress bar with buffered display
 * and hover time preview.
 *
 * Instead of relying on the decoder's `timeupdate` events (which can fire as
 * infrequently as 4x/sec), this component runs its own requestAnimationFrame
 * loop that reads `getCurrentTime()`/`getDuration()` directly from the
 * adapter, so the fill and thumb glide continuously regardless of decoder.
 *
 * PERF: the loop writes fill width and thumb position straight to
 * `element.style`. React is only asked to render when something a person can
 * perceive changes — the whole-second value (~1/s), the duration, and the
 * buffered ranges (~2/s). The old version called setDisplayTime/setDuration/
 * setBuffered every frame; `getBuffered()` allocates a fresh TimeRanges per
 * call so the identity check never passed, and the component (plus, through
 * `onFrame`, its parent ControlBar) re-rendered 60×/s for the whole session —
 * competing with the decoder's own rAF presentation loop for main-thread time.
 *
 * Works with any PlayerAdapter via the ControlBar that owns it.
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

/** Buffered ranges are polled twice a second — nobody sees them move faster. */
const BUFFERED_EVERY_FRAMES = 30;

interface ProgressBarProps {
  player: PlayerAdapter;
  onSeek: (time: number) => void;
  onSeekStart?: () => void;
  onSeekEnd?: () => void;
  /** Called when the displayed time ticks over to a new second (~1/s), so the
   *  parent can keep its own time readout in sync without extra listeners. */
  onFrame?: (currentTime: number, duration: number) => void;
  /** False while the bar is hidden — stops the rAF loop entirely. */
  active?: boolean;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ProgressBar({
  player,
  onSeek,
  onSeekStart,
  onSeekEnd,
  onFrame,
  active = true,
}: ProgressBarProps) {
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
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const barRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const dragTimeRef = useRef<number | null>(null);
  const lastPctRef = useRef(-1);
  const lastSecRef = useRef(-1);
  const lastDurationRef = useRef(player.getDuration());

  /**
   * Imperative playhead. `width`/`left` are never present in the style object
   * React renders, and React only diffs properties that exist in both the
   * previous and next style objects — so a re-render can't clobber these.
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

  /** Re-render (and notify the parent) only when the clock text would change. */
  const commitSecond = useCallback(
    (time: number) => {
      const sec = Math.floor(time);
      if (sec === lastSecRef.current) return false;
      lastSecRef.current = sec;
      setDisplayTime(time);
      onFrame?.(time, lastDurationRef.current);
      return true;
    },
    [onFrame],
  );

  // 60fps sync loop — reads directly from the adapter rather than waiting on
  // decoder-specific timeupdate cadence.
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
            /* adapter tearing down */
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

  // Sync before first paint so the thumb never flashes at the left edge.
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

  const getTimeFromPosition = useCallback((clientX: number): number => {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    // A collapsed (zero-width) track would make x/width = 0/0 = NaN, which
    // JSON-serializes to null and mpv rejects with "invalid parameter".
    if (rect.width <= 0) return 0;
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    return (x / rect.width) * lastDurationRef.current;
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    isDraggingRef.current = true;
    setIsDragging(true);
    onSeekStart?.();
    const time = getTimeFromPosition(e.clientX);
    dragTimeRef.current = time;
    paint(pctFor(time));
    commitSecond(time);
    onSeek(time);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const time = getTimeFromPosition(e.clientX);
    setHoverX(Math.max(0, Math.min(e.clientX - rect.left, rect.width)));
    if (hoverTime === null || Math.floor(time) !== Math.floor(hoverTime)) {
      setHoverTime(time);
    }

    if (isDraggingRef.current) {
      dragTimeRef.current = time;
      paint(pctFor(time));
      commitSecond(time);
      onSeek(time);
    }
  };

  const endDrag = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    if (dragTimeRef.current !== null) onSeek(dragTimeRef.current);
    onSeekEnd?.();
    dragTimeRef.current = null;
  }, [onSeek, onSeekEnd]);

  const handlePointerUp = () => endDrag();
  const handlePointerLeave = () => {
    setHoverTime(null);
    setHoverX(null);
  };

  useEffect(() => {
    if (!isDragging) return;
    const up = () => endDrag();
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [isDragging, endDrag]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (lastDurationRef.current <= 0) return;
    e.preventDefault();
    const max = lastDurationRef.current;
    switch (e.key) {
      case "ArrowLeft":
        onSeekStart?.();
        onSeek(Math.max(0, displayTime - 5));
        onSeekEnd?.();
        break;
      case "ArrowRight":
        onSeekStart?.();
        onSeek(Math.min(max, displayTime + 5));
        onSeekEnd?.();
        break;
      case "Home":
        onSeekStart?.();
        onSeek(0);
        onSeekEnd?.();
        break;
      case "End":
        onSeekStart?.();
        onSeek(max);
        onSeekEnd?.();
        break;
    }
  };

  return (
    <div
      ref={barRef}
      className="relative h-2 w-full min-w-0 flex-1 bg-white/20 rounded-full cursor-pointer group hover:h-3 transition-[height] duration-150"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onKeyDown={handleKeyDown}
      role="slider"
      aria-label="Video progress"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={displayTime}
      aria-valuetext={`${formatTime(displayTime)} of ${formatTime(duration)}`}
      tabIndex={0}
    >
      {buffered.map((range, i) => {
        if (duration <= 0) return null;
        const startPct = (range.start / duration) * 100;
        const widthPct = ((range.end - range.start) / duration) * 100;
        if (startPct + widthPct < lastPctRef.current) return null;
        return (
          <div
            key={i}
            className="absolute top-0 bottom-0 bg-white/40 rounded-full transition-[width] duration-200 ease-linear"
            style={{ left: `${startPct}%`, width: `${Math.max(0, widthPct)}%` }}
          />
        );
      })}

      {/* `width` is owned by paint(), not by React */}
      <div
        ref={fillRef}
        className="absolute top-0 bottom-0 bg-[#D4A237] rounded-full will-change-[width]"
        aria-hidden="true"
      />

      {/* `left` is owned by paint(), not by React */}
      <div
        ref={thumbRef}
        className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-[#D4A237] rounded-full shadow-lg transition-transform duration-150 will-change-[left] ${
          isDragging || hoverTime !== null ? "scale-125" : "scale-100"
        }`}
        aria-hidden="true"
      />

      {hoverTime !== null && hoverX !== null && (
        <div
          className="absolute bottom-full mb-2 px-2 py-1 bg-black/90 text-white text-xs font-mono rounded pointer-events-none whitespace-nowrap border border-white/10 shadow-lg"
          style={{ left: hoverX, transform: "translateX(-50%)" }}
        >
          {formatTime(hoverTime)}
        </div>
      )}
    </div>
  );
}
