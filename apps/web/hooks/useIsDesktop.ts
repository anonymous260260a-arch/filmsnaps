/**
 * useIsDesktop — viewport-based desktop detection hook.
 *
 * Returns true when the viewport is ≥1280px wide (Tailwind `xl` breakpoint).
 * Used to branch between the desktop two-zone layout and the mobile
 * single-column layout on the Watch page.
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

function getInitialValue(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(min-width: 1280px)").matches;
}

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(getInitialValue);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");

    // Listen for changes
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);

    return () => mq.removeEventListener("change", handler);
  }, []);

  return isDesktop;
}
