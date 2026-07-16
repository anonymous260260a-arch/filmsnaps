/**
 * PlayerControlOverlay — glassmorphism overlay with player controls.
 *
 * Features: fullscreen toggle, provider switch trigger, loading/CPU states.
 * Auto-hides after 4s of inactivity.
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Maximize, Minimize, AlertCircle, X } from 'lucide-react';
import { usePlayer } from './PlayerProvider';

interface PlayerControlOverlayProps {
  /** Whether the player is in a transitioning state (loading new episode) */
  isPending?: boolean;
}

export function PlayerControlOverlay({ isPending = false }: PlayerControlOverlayProps) {
  const { isFullscreen, toggleFullscreen, cpuWarning, setCpuWarning, minimal } = usePlayer();
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Always show initially
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 4000);

    const show = () => {
      setVisible(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), 4000);
    };

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
      {/* Fullscreen button — bottom right */}
      <button
        onClick={toggleFullscreen}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        className={`absolute bottom-3 right-3 z-20 flex items-center gap-2 px-3 py-2 rounded-lg
          bg-[#070708]/60 backdrop-blur-sm border border-white/10
          text-white/80 hover:text-white hover:bg-[#070708]/80
          transition-all duration-200
          text-xs font-semibold tracking-wide
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40
          ${visible ? 'opacity-100' : 'opacity-0 group-hover/player:opacity-100'}`}
      >
        {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
      </button>

      {/* CPU Abuse Warning */}
      {cpuWarning && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#070708]/80 backdrop-blur-sm">
          <div className="flex items-center gap-3 text-sm text-[#E05252] bg-red-500/10 px-5 py-4 rounded-xl border border-red-500/20 max-w-md mx-4">
            <AlertCircle size={16} className="text-[#E05252] flex-shrink-0" />
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

      {/* Loading overlay */}
      {isPending && (
        <div className="absolute inset-0 bg-[#070708]/90 backdrop-blur-md flex items-center justify-center z-50">
          <div className="animate-spin w-8 h-8 border-2 border-[#D4A237] border-t-transparent rounded-full" />
        </div>
      )}
    </>
  );
}
