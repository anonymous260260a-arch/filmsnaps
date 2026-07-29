/**
 * All [DL] logging must go through this module instead of calling console.log directly.
 * console.log on Android is a synchronous bridge call into Logcat — at 300-400ms progress
 * event frequency with 5-10 log lines per event, this alone was a meaningful chunk of the
 * JS-thread starvation. In production builds every call here is a true no-op (not even a
 * string template gets evaluated, since we short-circuit before touching args).
 */
const ENABLED = __DEV__;

export const logger = {
  debug: (...args: unknown[]) => {
    if (ENABLED) console.log("[DL]", ...args);
  },
  warn: (...args: unknown[]) => {
    if (ENABLED) console.warn("[DL]", ...args);
  },
  error: (...args: unknown[]) => {
    if (ENABLED) console.error("[DL]", ...args);
  },
};
