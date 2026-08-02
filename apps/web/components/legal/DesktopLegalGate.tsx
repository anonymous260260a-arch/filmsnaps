/**
 * DesktopLegalGate — first-time Legal & DMCA acceptance for the Electron app.
 *
 * Unlike the browser gate, acceptance is persisted in the MAIN process
 * (userData/legal-accepted.json, via IPC) because the desktop renderer origin
 * changes every launch (the bundled Next.js server binds a random localhost
 * port), so renderer localStorage would not survive a restart.
 *
 * Renders an opaque full-screen neutral blocker the moment Electron is
 * detected, then resolves the acceptance status over IPC. Only when the IPC
 * confirms the user has NOT accepted does the actual legal overlay appear —
 * so returning users never see the legal page flicker on startup.
 */

"use client";

import React, { useCallback, useEffect, useState } from "react";
import { LegalGateOverlay } from "./LegalGateOverlay";

type GateState = "idle" | "blocking" | "accepted" | "pending";

export function DesktopLegalGate() {
  // SSR + first client render: nothing (mirrors DesktopAppShell's mounted gate —
  // never read window.electronAPI during render, only in an effect).
  const [mounted, setMounted] = useState(false);
  const [gate, setGate] = useState<GateState>("idle");

  useEffect(() => {
    setMounted(true);
    const api = window.electronAPI;
    if (!api?.isDesktop || !api.getLegalAccepted) return;

    // Block immediately so no app UI flashes before IPC resolves.
    setGate("blocking");
    api
      .getLegalAccepted()
      .then((accepted) => setGate(accepted ? "accepted" : "pending"))
      .catch(() => setGate("pending")); // IPC failure → show the gate (safe path)
  }, []);

  const handleAccept = useCallback(() => {
    const api = window.electronAPI;
    if (!api?.setLegalAccepted) return;
    api
      .setLegalAccepted()
      .then(() => setGate("accepted"))
      .catch(() => setGate("accepted")); // Persistence failure → still proceed; safe.
  }, []);

  const handleExit = useCallback(() => {
    window.electronAPI?.close?.();
  }, []);

  if (!mounted) return null;
  // `idle` (not Electron, or the effect hasn't run) and `accepted` render nothing.
  if (gate === "idle" || gate === "accepted") return null;

  // `blocking`: IPC still resolving — show a neutral opaque cover the same
  // colour as the app background, so returning users see no legal-page flash.
  // `pending`: IPC confirmed unaccepted — show the real legal overlay.
  if (gate === "blocking") {
    return <div className="fixed inset-0 z-[100] bg-[#070708]" />;
  }

  return <LegalGateOverlay open onAccept={handleAccept} onExit={handleExit} />;
}
