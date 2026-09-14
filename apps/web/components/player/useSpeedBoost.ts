/**
 * useSpeedBoost — implements "hold to play at 2x" from two input sources:
 *   1. Holding the Space bar (ignored while an <input>/<textarea> is focused)
 *   2. Long-pressing anywhere on the video surface (see useLongPress)
 *
 * While either is active, playback rate is forced to `boostRate` and the
 * caller's original rate is restored on release. Returns `isBoosted` so the
 * UI can show a "2x ►" indicator, plus long-press pointer handlers to spread
 * onto the video surface.
 */

"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { PlayerAdapter } from "./player-adapters";
import { useLongPress, type LongPressHandlers } from "./useLongPress";

export interface UseSpeedBoostOptions {
  player: PlayerAdapter;
  normalRate: number;
  boostRate?: number;
  enabled?: boolean;
}

export interface UseSpeedBoostResult {
  isBoosted: boolean;
  longPressHandlers: LongPressHandlers;
}

export function useSpeedBoost({
  player,
  normalRate,
  boostRate = 2,
  enabled = true,
}: UseSpeedBoostOptions): UseSpeedBoostResult {
  const [isBoosted, setIsBoosted] = useState(false);
  const spaceHeldRef = useRef(false);
  const longPressHeldRef = useRef(false);
  const normalRateRef = useRef(normalRate);
  // Mirror of isBoosted usable inside stable callbacks — the restore rate must
  // be snapshotted BEFORE applying the boost (reading getPlaybackRate after
  // setPlaybackRate would return the boosted rate and "restore" into 2x).
  const isBoostedRef = useRef(false);
  if (!isBoostedRef.current) normalRateRef.current = normalRate;

  const applyBoost = useCallback(() => {
    if (isBoostedRef.current) return;
    isBoostedRef.current = true;
    normalRateRef.current = player.getPlaybackRate();
    player.setPlaybackRate(boostRate);
    setIsBoosted(true);
  }, [player, boostRate]);

  const releaseBoost = useCallback(() => {
    if (spaceHeldRef.current || longPressHeldRef.current) return;
    if (!isBoostedRef.current) return;
    isBoostedRef.current = false;
    setIsBoosted(false);
    player.setPlaybackRate(normalRateRef.current);
  }, [player]);

  const onLongPressStart = useCallback(() => {
    if (!enabled) return;
    longPressHeldRef.current = true;
    applyBoost();
  }, [enabled, applyBoost]);

  const onLongPressEnd = useCallback(() => {
    longPressHeldRef.current = false;
    releaseBoost();
  }, [releaseBoost]);

  const longPressHandlers = useLongPress({
    thresholdMs: 400,
    onStart: onLongPressStart,
    onEnd: onLongPressEnd,
    disabled: !enabled,
  });

  const spaceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spaceStartTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== " " && e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      )
        return;
      if (target?.contentEditable === "true") return;

      e.preventDefault();

      if (e.repeat) return;

      spaceStartTimeRef.current = Date.now();

      if (spaceTimerRef.current) clearTimeout(spaceTimerRef.current);
      spaceTimerRef.current = setTimeout(() => {
        spaceHeldRef.current = true;
        applyBoost();
      }, 200);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key !== " " && e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      )
        return;
      if (target?.contentEditable === "true") return;

      e.preventDefault();

      if (spaceTimerRef.current) {
        clearTimeout(spaceTimerRef.current);
        spaceTimerRef.current = null;
      }

      const pressDuration = Date.now() - spaceStartTimeRef.current;

      if (spaceHeldRef.current) {
        spaceHeldRef.current = false;
        releaseBoost();
      } else if (pressDuration < 200 && player) {
        // Quick tap Space -> toggle play/pause
        if (player.isPaused()) {
          player.play();
        } else {
          player.pause();
        }
      }
    };

    const handleBlur = () => {
      if (spaceTimerRef.current) {
        clearTimeout(spaceTimerRef.current);
        spaceTimerRef.current = null;
      }
      spaceHeldRef.current = false;
      longPressHeldRef.current = false;
      releaseBoost();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      if (spaceTimerRef.current) clearTimeout(spaceTimerRef.current);
      // If we unmount (or `enabled` flips) mid-boost, restore the rate —
      // otherwise playback would stay stuck at the boosted speed.
      spaceHeldRef.current = false;
      longPressHeldRef.current = false;
      if (isBoostedRef.current) {
        isBoostedRef.current = false;
        setIsBoosted(false);
        player.setPlaybackRate(normalRateRef.current);
      }
    };
  }, [enabled, applyBoost, releaseBoost, player]);

  return { isBoosted, longPressHandlers };
}
