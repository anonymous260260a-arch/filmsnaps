/**
 * ProgressBar — smooth, 60fps scrubbable progress bar with buffered display
 * and hover time preview.
 *
 * Instead of relying on the decoder's `timeupdate` events (which can fire as
 * infrequently as 4x/sec), this component runs its own requestAnimationFrame
 * loop that reads `getCurrentTime()`/`getDuration()` directly from the
 * adapter, so the fill and thumb glide continuously regardless of decoder.
 *
 * Works with any PlayerAdapter via the ControlBar that owns it.
 */

"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import type { PlayerAdapter, TimeRange } from "./player-adapters";

interface ProgressBarProps {
  player: PlayerAdapter;
  onSeek: (time: number) => void;
  onSeekStart?: () => void;
  onSeekEnd?: () => void;
  /** Called every animation frame with the live (non-seeking) time, so the
   *  parent can keep its own time display in sync without extra listeners. */
  onFrame?: (currentTime: number, duration: number) => void;
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
}: ProgressBarProps) {
  const [displayTime, setDisplayTime] = useState(player.getCurrentTime());
  const [duration, setDuration] = useState(player.getDuration());
  const [buffered, setBuffered] = useState<TimeRange[]>(player.getBuffered());
  const [isDragging, setIsDragging] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const barRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const dragTimeRef = useRef<number | null>(null);

  // 60fps sync loop — reads directly from the adapter rather than waiting on
  // decoder-specific timeupdate cadence.
  useEffect(() => {
    const tick = () => {
      if (!isDraggingRef.current) {
        const t = player.getCurrentTime();
        const d = player.getDuration();
        setDisplayTime(t);
        setDuration(d);
        setBuffered(player.getBuffered());
        onFrame?.(t, d);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [player, onFrame]);

  const durationOk = Number.isFinite(duration) && duration > 0;
  const progressPercent = durationOk ? (displayTime / duration) * 100 : 0;

  const getTimeFromPosition = useCallback(
    (clientX: number): number => {
      if (!barRef.current || !durationOk) return 0;
      const rect = barRef.current.getBoundingClientRect();
      // A collapsed (zero-width) track would make x/width = 0/0 = NaN, which
      // JSON-serializes to null and mpv rejects with "invalid parameter".
      if (rect.width <= 0) return 0;
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      return (x / rect.width) * duration;
    },
    [duration, durationOk],
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    isDraggingRef.current = true;
    setIsDragging(true);
    onSeekStart?.();
    const time = getTimeFromPosition(e.clientX);
    dragTimeRef.current = time;
    setDisplayTime(time);
    onSeek(time);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const time = getTimeFromPosition(e.clientX);
    setHoverTime(time);
    setHoverX(Math.max(0, Math.min(e.clientX - rect.left, rect.width)));

    if (isDraggingRef.current) {
      dragTimeRef.current = time;
      setDisplayTime(time);
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
    if (duration <= 0) return;
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
        if (startPct + widthPct < progressPercent) return null;
        return (
          <div
            key={i}
            className="absolute top-0 bottom-0 bg-white/40 rounded-full transition-[width] duration-200 ease-linear"
            style={{ left: `${startPct}%`, width: `${Math.max(0, widthPct)}%` }}
          />
        );
      })}

      <div
        className="absolute top-0 bottom-0 bg-[#D4A237] rounded-full will-change-[width]"
        style={{ width: `${Math.min(progressPercent, 100)}%` }}
      />

      <div
        className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-[#D4A237] rounded-full shadow-lg transition-transform duration-150 will-change-[left] ${
          isDragging || hoverTime !== null ? "scale-125" : "scale-100"
        }`}
        style={{ left: `${Math.min(progressPercent, 100)}%` }}
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
