/**
 * Platform detection — single source of truth for "is this the Electron shell".
 *
 * The previous pattern (`useState(false)` + `useEffect(() => setIsDesktop(...))`)
 * renders the FIRST client pass as web: any provider/page decision made during
 * that pass (e.g. PlayerProvider seeding its provider id) is wrong and never
 * re-seeds. useSyncExternalStore resolves the client snapshot synchronously
 * during the first render, so there is no stale first pass — this is the
 * predictability fix for provider defaults.
 */

import { useSyncExternalStore } from "react";

const subscribeNoop = () => () => {};

/** Synchronous (non-hook) check — safe in event handlers and module helpers. */
export function isElectronNow(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as any).electronAPI?.isDesktop === true
  );
}

/** React hook — true from the very first client render inside Electron. */
export function useIsElectron(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    // Client snapshot — evaluated during render, no effect tick needed.
    () => (window as any).electronAPI?.isDesktop === true,
    // Server snapshot (static export / SSR) — never Electron.
    () => false,
  );
}
