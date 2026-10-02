"use client";

import React from "react";
import { X } from "lucide-react";
import { HubEpisodesPane } from "./HubEpisodesPane";

interface SeasonData {
  episodes?: Array<{
    id: number;
    episode_number: number;
    name?: string;
    overview?: string;
    still_path?: string | null;
    runtime?: number;
    air_date?: string;
  }>;
}

interface EpisodeSidebarProps {
  seasonData: SeasonData | null;
  seasons?: Array<{ id: number; season_number: number; name?: string }>;
  onSeasonChange: (season: number) => void;
  title?: string;
  onClose?: () => void;
  /** TMDB show id — enables per-episode progress bars (mobile parity). */
  tvId?: string | null;
}

/**
 * Desktop right-column episode panel.
 *
 * Renders the SAME clean pane as the below-player hub's Episodes tab (the
 * mobile PlayerHub copy — season pills + bordered episode cards with
 * thumbs, progress bars and Playing/watched badges). Only the slim
 * title/close header is desktop-specific; the old playlist header
 * (season dropdown + episode counter), equalizer list and Now-Watching
 * prev/next footer are gone.
 */
export function EpisodeSidebar({
  seasonData,
  seasons = [],
  onSeasonChange,
  title,
  onClose,
  tvId,
}: EpisodeSidebarProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border border-white/[0.08] bg-[#0E0E12] shadow-2xl sm:rounded-2xl">
      {/* Slim header — series title + close (theater-mode toggle lives here
          and in the player chrome) */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2.5">
        <span className="truncate text-sm font-bold text-zinc-100">
          {title || "Episodes"}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white active:scale-95"
            title="Close Episodes (Theater Mode)"
            aria-label="Close Episodes"
          >
            <X size={15} />
          </button>
        )}
      </div>

      <HubEpisodesPane
        seasonData={seasonData}
        seasons={seasons}
        onSeasonChange={onSeasonChange}
        tvId={tvId}
      />
    </div>
  );
}
