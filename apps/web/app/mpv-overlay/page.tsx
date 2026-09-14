"use client";

/**
 * mpv-overlay — loaded inside the transparent video window.
 *
 * The video window is a PURE OUTPUT surface: mpv's child HWND renders the
 * video and the window ignores all mouse input (setIgnoreMouseEvents in
 * VLCVideoWindow), forwarding it to the main window beneath. Every piece of
 * player UI — controls, gestures, source picker — lives in the main window's
 * page (DirectVideoPlayer renders PlayerShell in strip mode), exactly where
 * the embed webview used to sit. This page therefore hosts nothing and must
 * stay fully transparent.
 */

import { useEffect } from "react";

export default function MpvOverlayPage() {
  useEffect(() => {
    // The page must be transparent wherever nothing is painted, or the
    // video beneath won't show through.
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";
  }, []);

  return null;
}
