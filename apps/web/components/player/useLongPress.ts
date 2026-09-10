/**
 * useLongPress — detects a press-and-hold gesture (mouse or touch) on an element.
 *
 * Fires `onStart` after `thresholdMs` of continuous holding, and `onEnd` on
 * release/cancel. Movement beyond `moveTolerance` px cancels the hold (so it
 * doesn't fire during drags/swipes). A press shorter than `thresholdMs`
 * triggers neither callback, allowing normal click/tap handlers to run.
 */

"use client";

import { useRef, useCallback, useEffect } from "react";

export interface UseLongPressOptions {
  thresholdMs?: number;
  moveTolerance?: number;
  onStart?: () => void;
  onEnd?: () => void;
  /** Disable the gesture entirely (e.g. while a settings panel is open). */
  disabled?: boolean;
}

export interface LongPressHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
}

export function useLongPress({
  thresholdMs = 400,
  moveTolerance = 10,
  onStart,
  onEnd,
  disabled = false,
}: UseLongPressOptions): LongPressHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isActiveRef = useRef(false);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const endPress = useCallback(() => {
    clearTimer();
    if (isActiveRef.current) {
      isActiveRef.current = false;
      onEnd?.();
    }
    startPosRef.current = null;
  }, [clearTimer, onEnd]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || e.button !== 0) return;
      startPosRef.current = { x: e.clientX, y: e.clientY };
      clearTimer();
      timerRef.current = setTimeout(() => {
        isActiveRef.current = true;
        onStart?.();
      }, thresholdMs);
    },
    [disabled, thresholdMs, onStart, clearTimer],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!startPosRef.current) return;
      const dx = e.clientX - startPosRef.current.x;
      const dy = e.clientY - startPosRef.current.y;
      if (Math.hypot(dx, dy) > moveTolerance) {
        endPress();
      }
    },
    [moveTolerance, endPress],
  );

  const onPointerUp = useCallback(() => endPress(), [endPress]);
  const onPointerLeave = useCallback(() => endPress(), [endPress]);
  const onPointerCancel = useCallback(() => endPress(), [endPress]);

  useEffect(() => clearTimer, [clearTimer]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onPointerCancel,
  };
}
