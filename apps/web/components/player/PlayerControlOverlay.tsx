/**
 * PlayerControlOverlay — cinematic overlay with branded loading,
 * fullscreen toggle, and CPU abuse warning.
 *
 * Auto-hides after 2s of inactivity. Loading overlay is
 * pointer-events-none so iframe stays clickable underneath.
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { usePlayer } from './PlayerProvider';

interface PlayerControlOverlayProps {
  /** Whether the player is in a transitioning state (loading new episode) */
  isPending?: boolean;
}

const HIDE_DELAY = 2000; // ms before controls auto-hide

export function PlayerControlOverlay({
  isPending = false,
}: PlayerControlOverlayProps) {
  const { cpuWarning, setCpuWarning } = usePlayer();
  const [visible, setVisible] = useState(false); // start hidden, show on interaction
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const show = () => {
      setVisible(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), HIDE_DELAY);
    };

    // Show controls on any interaction
    document.addEventListener('mousemove', show);
    document.addEventListener('touchstart', show);

    return () => {
      document.removeEventListener('mousemove', show);
      document.removeEventListener('touchstart', show);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <>
      {/* ── Branded Loading State ── */}
      {/* pointer-events-none so if the iframe loads (visually) before
          onLoad fires, the video is still clickable underneath */}
      {isPending && (
        <div className="absolute inset-0 bg-[#070708] z-50 flex flex-col items-center justify-center gap-5 pointer-events-none">
          <div className="relative w-14 h-14">
            <div className="absolute inset-0 rounded-full border-2 border-[#222226]" />
            <div
              className="absolute inset-0 rounded-full border-t-2 border-[#D4A237] animate-spin"
              style={{ animationDuration: '1.2s' }}
            />
            <div className="absolute inset-3 rounded-full border-2 border-[#222226]" />
            <div className="absolute inset-[18px] rounded-full bg-[#D4A237]/30" />
          </div>
          <p className="text-xs font-black text-[#52525B] uppercase tracking-[0.3em] animate-pulse">
            Scanning Projection Room
          </p>
        </div>
      )}

      {/* ── Chrome / Controls layer ── */}
      {/* Always pointer-events-none so the iframe stays clickable underneath */}
      {!isPending && (
        <div
          className={`absolute inset-0 z-20 transition-opacity duration-300 ${
            visible ? 'opacity-100' : 'opacity-0'
          } pointer-events-none`}
        >
          {/* Gradient shadows for legibility */}
          <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
          <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
        </div>
      )}

      {/* ── CPU Abuse Warning ── */}
      {cpuWarning && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#070708]/85 backdrop-blur-sm">
          <div className="flex items-start gap-3 text-sm text-[#E05252] bg-red-500/10 px-5 py-4 rounded-xl border border-red-500/20 max-w-md mx-4">
            <AlertCircle size={16} className="text-[#E05252] flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-xs sm:text-sm">
              This server is using too much CPU — it has been stopped.
              <span className="block mt-1 text-[#A1A1AA]">
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
