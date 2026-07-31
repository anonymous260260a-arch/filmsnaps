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

import React, { useEffect, useState } from "react";

export function DesktopGate({ children }: { children: React.ReactNode }) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.electronAPI?.isDesktop) {
      setIsDesktop(true);
    }
  }, []);

  // Avoid a hydration mismatch: server renders children, client flips to
  // nothing only after mount. On web this stays visible.
  if (isDesktop) return null;
  return <>{children}</>;
}
