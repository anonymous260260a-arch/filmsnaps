/**
 * useIsMobilePlayer — touch/small-screen detection for the player chrome.
 *
 * True on narrow viewports (<768px) AND on coarse-pointer devices without
 * hover (phones/tablets at any width). Those two surfaces get the HEVC-style
 * custom overlay; everything else keeps movi-player's built-in control bar.
 *
 * Initial value is read synchronously from matchMedia so the first render
 * picks the right chrome (same contract as useIsDesktop).
 */

"use client";

import { useState, useEffect } from "react";

const QUERY = "(max-width: 767px), (hover: none) and (pointer: coarse)";

function getInitialValue(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(QUERY).matches;
}

export function useIsMobilePlayer(): boolean {
  const [isMobile, setIsMobile] = useState(getInitialValue);

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isMobile;
}
