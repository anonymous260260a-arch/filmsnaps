/**
 * useGestureControls — vertical swipe gestures on mobile:
 *   swipe on the left half  → brightness
 *   swipe on the right half → volume
 *
 * Reports a live 0..1 value plus an `active` flag so the UI can show a
 * slider overlay while the gesture is in progress.
 */

"use client";

import { useRef, useState, useCallback } from "react";

export type GestureKind = "brightness" | "volume" | null;

export interface UseGestureControlsOptions {
  initialVolume: number;
  initialBrightness?: number;
  onVolumeChange: (v: number) => void;
  onBrightnessChange?: (v: number) => void;
  /** px of vertical drag to go from 0 to 1 */
  sensitivity?: number;
  disabled?: boolean;
}

export interface GestureState {
  kind: GestureKind;
  value: number; // 0..1
}

export function useGestureControls({
  initialVolume,
  initialBrightness = 1,
  onVolumeChange,
  onBrightnessChange,
  sensitivity = 200,
  disabled = false,
}: UseGestureControlsOptions) {
  const [gesture, setGesture] = useState<GestureState>({
    kind: null,
    value: 0,
  });
  const startRef = useRef<{
    y: number;
    value: number;
    kind: GestureKind;
  } | null>(null);

  const onTouchStart = useCallback(
    (e: React.TouchEvent<HTMLElement>) => {
      if (disabled || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = (touch.clientX - rect.left) / rect.width;
      const kind: GestureKind = relX < 0.5 ? "brightness" : "volume";
      const currentValue =
        kind === "volume" ? initialVolume : initialBrightness;
      startRef.current = { y: touch.clientY, value: currentValue, kind };
    },
    [disabled, initialVolume, initialBrightness],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent<HTMLElement>) => {
      if (!startRef.current || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const dy = startRef.current.y - touch.clientY; // up = positive
      const delta = dy / sensitivity;
      const newValue = Math.min(1, Math.max(0, startRef.current.value + delta));

      setGesture({ kind: startRef.current.kind, value: newValue });

      if (startRef.current.kind === "volume") onVolumeChange(newValue);
      else onBrightnessChange?.(newValue);
    },
    [sensitivity, onVolumeChange, onBrightnessChange],
  );

  const onTouchEnd = useCallback(() => {
    startRef.current = null;
    setGesture({ kind: null, value: 0 });
  }, []);

  return {
    gesture,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: onTouchEnd,
    },
  };
}
