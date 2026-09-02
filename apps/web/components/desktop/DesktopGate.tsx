/**
 * DesktopGate — a tiny client component that renders nothing inside the
 * Electron desktop shell.
 *
 * Server components (like /download) can't read `window.electronAPI`, so
 * they can't detect the desktop shell directly. Wrapping their redundant
 * website header (logo + back link) in this component hides it on desktop
 * where the GlobalTopBar already provides the chrome, and keeps it on web.
 */

"use client";

import React, { useState } from "react";

export function DesktopGate({ children }: { children: React.ReactNode }) {
  // Lazy-init: synchronously detect Electron on first client render to avoid
  // the one-frame flash of the website header inside the desktop shell.
  const [isDesktop] = useState(() => {
    if (typeof window === "undefined") return false;
    return !!window.electronAPI?.isDesktop;
  });

  if (isDesktop) return null;
  return <>{children}</>;
}
