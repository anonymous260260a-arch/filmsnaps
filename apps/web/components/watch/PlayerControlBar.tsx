/**
 * PlayerControlBar — strip below the video player.
 *
 * Only PiP (Electron) and buffering indicator remain.
 * The server pill is inside VideoZone (top-right corner).
 */

"use client";

import React from "react";
import { PictureInPicture2 } from "lucide-react";

interface PlayerControlBarProps {
  /** Whether the player is in a loading/transitioning state */
  isPending: boolean;
  /** Whether the player has finished loading */
  isPlayerReady: boolean;
  /** Whether running in Electron (show PiP button) */
  isElectron: boolean;
}

export function PlayerControlBar({
  isPending,
  isPlayerReady,
  isElectron,
}: PlayerControlBarProps) {
  const handlePiP = async () => {
    try {
      const video = document.querySelector("video");
      if (video && document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      }
    } catch {
      // PiP not supported or denied
    }
  };

  return (
    <div className="flex items-center justify-end px-1 py-1">
      <div className="flex items-center gap-3">
        {isPending && !isPlayerReady && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full border-2 border-[#D4A237] border-t-transparent animate-spin" />
            <span className="text-[11px] text-zinc-500 font-medium tracking-wide">
              Buffering...
            </span>
          </div>
        )}

        {isElectron && (
          <button
            onClick={handlePiP}
            className="flex items-center justify-center w-8 h-8 rounded-lg
              text-zinc-500 hover:text-zinc-300 hover:bg-[#0E0E11] transition-all"
            aria-label="Picture in Picture"
            title="Picture in Picture"
          >
            <PictureInPicture2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
