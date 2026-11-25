/**
 * useIsDesktop — viewport-based desktop detection hook.
 *
 * Returns true when the viewport is ≥ `minWidth`px wide (default 1280 = the
 * Tailwind `xl` breakpoint). Used to branch between desktop and mobile
 * layouts — the Watch page (≥1280) and the detail pages (≥640 = `sm`, where
 * the desktop variant takes over) both gate their layout fork on it, so each
 * branch mounts exactly ONE instance of heavy children (DetailEpisodes,
 * webviews, …). NEVER use CSS `hidden`/`sm:hidden` to branch heavy children:
 * both branches mount and run effects simultaneously.
 *
 * NOT to be confused with Electron detection (window.electronAPI?.isDesktop)
 * which is about runtime environment, not viewport size.
 *
 * CRITICAL: Initial value is set SYNCHRONOUSLY from matchMedia so the first
 * render matches the correct layout. An async hook that starts as `false`
 * then flips to `true` causes a full React tree remount — the mobile branch
 * renders first including a webview/iframe that starts loading, then everything
 * unmounts and the desktop branch remounts. This doubles load time, flashes
 * "Connecting to provider", and resets security state mid-flight.
 */

"use client";

import { useState, useEffect } from "react";

function getInitialValue(minWidth: number): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(`(min-width: ${minWidth}px)`).matches;
}

/**
 * The desktop window has a native minimum width (960px), so a viewport this
 * narrow can only be the transient size Windows reports while the window is
 * minimized. Acting on it forks every responsive layout for a size nobody ever
 * sees, which unmounts the watch tree and its mpv session — playback then
 * restarts from scratch on restore. Only transitions are filtered: a device
 * that genuinely boots narrow still renders the narrow layout.
 */
const TRANSIENT_MAX_WIDTH = 640;

function isTransientMinimize(): boolean {
  return (
    typeof window !== "undefined" &&
    window.electronAPI?.isDesktop === true &&
    window.innerWidth < TRANSIENT_MAX_WIDTH
  );
}

export function useIsDesktop(minWidth: number = 1280): boolean {
  const [isDesktop, setIsDesktop] = useState(() => getInitialValue(minWidth));

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minWidth}px)`);

    // Listen for changes
    const handler = (e: MediaQueryListEvent) => {
      if (!e.matches && isTransientMinimize()) return;
      setIsDesktop(e.matches);
    };
    mq.addEventListener("change", handler);

    return () => mq.removeEventListener("change", handler);
  }, [minWidth]);

  return isDesktop;
}
