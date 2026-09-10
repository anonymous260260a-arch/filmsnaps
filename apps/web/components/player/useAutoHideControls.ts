/**
 * useAutoHideControls — shows controls on any interaction, hides them after
 * `idleMs` of inactivity. Pass `forceVisible` (seeking, settings open, paused,
 * etc.) to suppress hiding while true.
 */

"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export function useAutoHideControls(
  idleMs: number = 3200,
  forceVisible: boolean = false,
) {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearTimer();
    if (forceVisible) return;
    timerRef.current = setTimeout(() => setVisible(false), idleMs);
  }, [clearTimer, forceVisible, idleMs]);

  const show = useCallback(() => {
    setVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    if (forceVisible) {
      clearTimer();
      setVisible(true);
    } else {
      scheduleHide();
    }
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceVisible]);

  useEffect(() => clearTimer, [clearTimer]);

  return { visible, show };
}
