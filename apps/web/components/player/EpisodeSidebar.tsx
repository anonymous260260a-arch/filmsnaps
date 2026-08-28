"use client";

import React from "react";
import { X, ChevronLeft, ChevronRight, ListVideo } from "lucide-react";
import { usePlayer } from "./PlayerProvider";
import { SeasonSelector, NowWatchingBar } from "./EpisodeRail";
import { VerticalEpisodeList } from "./VerticalEpisodeList";

interface SeasonData {
  episodes?: Array<{
    id: number;
    episode_number: number;
    name?: string;
    overview?: string;
    still_path?: string | null;
    runtime?: number;
  }>;
}

interface EpisodeSidebarProps {
  seasonData: SeasonData | null;
  seasons?: Array<{ id: number; season_number: number; name?: string }>;
  onSeasonChange: (season: number) => void;
  title?: string;
  onClose?: () => void;
}

/**
 * Desktop / tablet-landscape right column inner content:
 * YouTube-inspired playlist panel with:
 * - Playlist header with Season selector, episode count, and close 'X' button
 * - Scrollable episode list with active equalizer indicator
 * - Now Watching footer with quick Prev/Next buttons
 */
export function EpisodeSidebar({
  seasonData,
  seasons = [],
  onSeasonChange,
  title,
  onClose,
}: EpisodeSidebarProps) {
  const { selectedSeason, activeEpisode, goToNextEpisode, goToPrevEpisode } =
    usePlayer();

  const episodes = seasonData?.episodes ?? [];
  const currentEpisode = episodes.find(
    (e) => e.episode_number === activeEpisode,
  );
  const totalEpisodes = episodes.length;
  const isFirstEpisode = activeEpisode <= 1;
  const isLastEpisode = activeEpisode >= totalEpisodes && totalEpisodes > 0;

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0E0E12] sm:rounded-2xl border border-white/[0.08] overflow-hidden shadow-2xl">
      {/* ── YouTube-style Playlist Header ── */}
      <div className="shrink-0 px-3 py-2.5 border-b border-white/[0.08] flex items-center justify-between bg-[#141418] gap-1.5">
        <div className="min-w-0 flex items-center gap-2">
          <SeasonSelector
            seasons={seasons}
            selectedSeason={selectedSeason}
            onSeasonChange={onSeasonChange}
          />
          <div className="flex items-center gap-1 text-xs text-zinc-400 font-medium whitespace-nowrap">
            <span className="text-[#D4A237] font-bold">{activeEpisode}</span>
            <span>/</span>
            <span>{totalEpisodes || "?"}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onClose && (
            <button
              onClick={onClose}
              className="flex items-center justify-center w-7 h-7 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors active:scale-95"
              title="Close Episodes (Theater Mode)"
              aria-label="Close Episodes"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* ── Scrollable list ── */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 sm:p-2.5">
        <VerticalEpisodeList seasonData={seasonData} autoScroll={true} />
      </div>

      {/* ── Footer: Now Watching & Quick Prev/Next ── */}
      <div className="shrink-0 px-3 py-2 border-t border-white/[0.08] bg-[#141418]/90 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 leading-none">
            <span className="w-1.5 h-1.5 rounded-full bg-[#D4A237]" />
            <span className="text-[9px] font-black uppercase tracking-wider text-zinc-500">
              Now Watching
            </span>
          </div>
          <p className="text-xs font-semibold text-zinc-200 truncate mt-0.5">
            {currentEpisode?.name || `Episode ${activeEpisode}`}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={goToPrevEpisode}
            disabled={isFirstEpisode}
            title="Previous Episode"
            className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/[0.06] border border-white/[0.08] text-zinc-400 hover:text-white hover:bg-white/[0.12] disabled:opacity-30 disabled:pointer-events-none transition-all active:scale-95"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={goToNextEpisode}
            disabled={isLastEpisode}
            title="Next Episode"
            className="flex items-center justify-center w-7 h-7 rounded-lg bg-[#D4A237] text-[#070708] font-bold hover:bg-[#B88B2A] disabled:opacity-30 disabled:pointer-events-none transition-all active:scale-95 shadow-md shadow-[#D4A237]/10"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
