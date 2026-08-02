/**
 * WebLegalGate — first-time Legal & DMCA acceptance for the browser.
 *
 * Shows the gate once (first open of the watch page), persisting acceptance
 * in localStorage (`@filmsnaps/legal-accepted`). No-op inside Electron — the
 * desktop app has its own main-process gate (DesktopLegalGate) because the
 * desktop renderer origin (random localhost port) doesn't persist localStorage.
 */

"use client";

import React, { useEffect, useState } from "react";
import { LegalGateOverlay } from "./LegalGateOverlay";

const LEGAL_KEY = "@filmsnaps/legal-accepted";

export function WebLegalGate() {
  // Hydration-safe: server + first client render render nothing. The gate
  // only appears after mount confirms we're in a browser (not Electron).
  const [mounted, setMounted] = useState(false);
  const [showGate, setShowGate] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined" && window.electronAPI?.isDesktop) return;
    let accepted = false;
    try {
      accepted = localStorage.getItem(LEGAL_KEY) === "1";
    } catch {
      accepted = false;
    }
    setShowGate(!accepted);
  }, []);

  const handleAccept = () => {
    try {
      localStorage.setItem(LEGAL_KEY, "1");
    } catch {
      // Storage unavailable — gate would reappear next load; safe path.
    }
    setShowGate(false);
  };

  if (!mounted) return null;

  return <LegalGateOverlay open={showGate} onAccept={handleAccept} />;
}
