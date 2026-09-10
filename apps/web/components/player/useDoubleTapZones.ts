/**
 * useDoubleTapZones — detects double-click (desktop) / double-tap (mobile) on
 * an element, split into three horizontal zones: left / center / right.
 *
 * Left half  → onLeft   (skip back)
 * Right half → onRight  (skip forward)
 * Center 20% → onCenter (play/pause) — a narrow center band avoids the left/
 * right zones fighting over ambiguous double clicks near the middle.
 *
 * A single click/tap is forwarded after `singleClickDelayMs` if no second
 * click arrives, so single-tap-to-toggle-controls still works.
 */

"use client";

import { useRef, useCallback } from "react";

export type TapZone = "left" | "center" | "right";

export interface UseDoubleTapZonesOptions {
  onDoubleLeft?: () => void;
  onDoubleRight?: () => void;
  onDoubleCenter?: () => void;
  onSingle?: (zone: TapZone) => void;
  doubleDelayMs?: number;
  centerZoneWidth?: number; // fraction of width, e.g. 0.2 = middle 20%
  disabled?: boolean;
}

export function useDoubleTapZones({
  onDoubleLeft,
  onDoubleRight,
  onDoubleCenter,
  onSingle,
  doubleDelayMs = 280,
  centerZoneWidth = 0.22,
  disabled = false,
}: UseDoubleTapZonesOptions) {
  const lastTapRef = useRef<{ time: number; zone: TapZone } | null>(null);
  const singleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const zoneFor = useCallback(
    (clientX: number, rect: DOMRect): TapZone => {
      const relX = (clientX - rect.left) / rect.width;
      const centerStart = 0.5 - centerZoneWidth / 2;
      const centerEnd = 0.5 + centerZoneWidth / 2;
      if (relX >= centerStart && relX <= centerEnd) return "center";
      return relX < 0.5 ? "left" : "right";
    },
    [centerZoneWidth],
  );

  const handleTap = useCallback(
    (clientX: number, rect: DOMRect) => {
      if (disabled) return;
      const zone = zoneFor(clientX, rect);
      const now = performance.now();
      const last = lastTapRef.current;

      if (last && now - last.time < doubleDelayMs && last.zone === zone) {
        if (singleTimerRef.current) {
          clearTimeout(singleTimerRef.current);
          singleTimerRef.current = null;
        }
        lastTapRef.current = null;
        if (zone === "left") onDoubleLeft?.();
        else if (zone === "right") onDoubleRight?.();
        else onDoubleCenter?.();
        return;
      }

      lastTapRef.current = { time: now, zone };
      if (singleTimerRef.current) clearTimeout(singleTimerRef.current);
      singleTimerRef.current = setTimeout(() => {
        onSingle?.(zone);
        lastTapRef.current = null;
      }, doubleDelayMs);
    },
    [
      disabled,
      doubleDelayMs,
      zoneFor,
      onDoubleLeft,
      onDoubleRight,
      onDoubleCenter,
      onSingle,
    ],
  );

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      handleTap(e.clientX, rect);
    },
    [handleTap],
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLElement>) => {
      const touch = e.changedTouches[0];
      if (!touch) return;
      const rect = e.currentTarget.getBoundingClientRect();
      handleTap(touch.clientX, rect);
    },
    [handleTap],
  );

  return { onClick, onTouchEnd };
}
