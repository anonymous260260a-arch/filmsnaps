import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Shared reduce-motion flag (module scope — one OS listener for the whole
 * app, every consumer re-renders off the same value). Phase-2 rule: accent
 * surfaces SNAP instead of running their 450ms fades when the OS asks for
 * reduced motion (FilmGrain already handles itself; this is the general
 * helper for everything else).
 */
let reduceMotionFlag = false;
let reduceMotionStarted = false;
const listeners = new Set<(v: boolean) => void>();

function ensureWatcher(): void {
  if (reduceMotionStarted) return;
  reduceMotionStarted = true;
  AccessibilityInfo.isReduceMotionEnabled()
    .then((v) => {
      if (reduceMotionFlag !== v) {
        reduceMotionFlag = v;
        for (const l of [...listeners]) l(v);
      }
    })
    .catch(() => {});
  AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => {
    reduceMotionFlag = v;
    for (const l of [...listeners]) l(v);
  });
}

/**
 * True when the OS requests reduced motion. Accent surfaces use this to SNAP
 * (setValue instead of Animated.timing) — a fade-in of a large color wash is
 * exactly the kind of motion the setting exists to suppress.
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(reduceMotionFlag);
  useEffect(() => {
    ensureWatcher();
    listeners.add(setReduceMotion);
    return () => {
      listeners.delete(setReduceMotion);
    };
  }, []);
  return reduceMotion;
}
