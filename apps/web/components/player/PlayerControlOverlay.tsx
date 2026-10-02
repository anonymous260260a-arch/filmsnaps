/**
 * PlayerControlOverlay — branded loading cover + CPU abuse warning.
 *
 * (It used to also fade in top/bottom "legibility" gradient shadows on every
 * touch — those double-fired with the player's own chrome and read as a
 * shadow film over the pill/top/bottom controls, so they're gone.)
 *
 * Loading overlay is pointer-events-none so iframe stays clickable underneath.
 */

"use client";

import React, { useState, useEffect } from "react";
import { AlertCircle, X } from "lucide-react";
import { usePlayer } from "./PlayerProvider";

interface PlayerControlOverlayProps {
  /** Whether the player is in a transitioning state (loading new episode) */
  isPending?: boolean;
}

/**
 * Hard ceiling on the opaque loading cover. If the ready signal never arrives
 * (hung season fetch, missed iframe load event), the user would otherwise
 * stare at an un-dismissable sheet over a player that is already playing —
 * audio keeps going because the cover is pointer-events-none.
 */
const MAX_LOADING_MS = 20000;

export function PlayerControlOverlay({
  isPending = false,
}: PlayerControlOverlayProps) {
  const { cpuWarning, setCpuWarning } = usePlayer();
  const [loadingExpired, setLoadingExpired] = useState(false);

  // Reset whenever loading ends so the next episode/season gets a full budget.
  useEffect(() => {
    if (!isPending) {
      setLoadingExpired(false);
      return;
    }
    const expiry = setTimeout(() => setLoadingExpired(true), MAX_LOADING_MS);
    return () => clearTimeout(expiry);
  }, [isPending]);

  return (
    <>
      {/* ── Branded Loading State ── */}
      {/* pointer-events-none so if the iframe loads (visually) before
          onLoad fires, the video is still clickable underneath */}
      {isPending && !loadingExpired && (
        <div className="absolute inset-0 bg-[#070708] z-50 flex flex-col items-center justify-center gap-5 pointer-events-none">
          <div className="relative w-14 h-14">
            <div className="absolute inset-0 rounded-full border-2 border-[#222226]" />
            <div
              className="absolute inset-0 rounded-full border-t-2 border-[#D4A237] animate-spin"
              style={{ animationDuration: "1.2s" }}
            />
            <div className="absolute inset-3 rounded-full border-2 border-[#222226]" />
            <div className="absolute inset-[18px] rounded-full bg-[#D4A237]/30" />
          </div>
          <p className="text-xs font-black text-faint uppercase tracking-[0.3em] animate-pulse">
            Scanning Projection Room
          </p>
        </div>
      )}

      {/* ── CPU Abuse Warning ── */}
      {cpuWarning && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#070708]/85 backdrop-blur-sm">
          <div className="flex items-start gap-3 text-sm text-[#E05252] bg-red-500/10 px-5 py-4 rounded-xl border border-red-500/20 max-w-md mx-4">
            <AlertCircle
              size={16}
              className="text-[#E05252] flex-shrink-0 mt-0.5"
            />
            <div className="flex-1 text-xs sm:text-sm">
              This server is using too much CPU — it has been stopped.
              <span className="block mt-1 text-muted-foreground">
                Switch to a different server above to continue watching.
              </span>
            </div>
            <button
              onClick={() => setCpuWarning(false)}
              className="text-zinc-600 hover:text-zinc-300 transition-colors p-1 flex-shrink-0"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
