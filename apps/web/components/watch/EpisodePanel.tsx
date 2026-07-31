/**
 * EpisodePanel — right column episode list for TV shows (desktop).
 *
 * Vertical scrollable list with season tabs, now-playing header,
 * and prev/next navigation. Replaces the horizontal EpisodeRail carousel
 * on desktop (≥1280px).
 */

"use client";

import React, { useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePlayer } from "@/components/player/PlayerProvider";

interface SeasonData {
  episodes?: Array<{
    id: number;
    episode_number: number;
    name: string;
    overview?: string;
    still_path?: string | null;
    runtime?: number;
  }>;
}

interface EpisodePanelProps {
  /** Season data from TMDB (episodes list) */
  seasonData: SeasonData | null;
  /** Available seasons from TMDB */
  seasons?: Array<{ id: number; season_number: number; name?: string }>;
  /** Called when season changes */
  onSeasonChange: (season: number) => void;
}

export function EpisodePanel({
  seasonData,
  seasons = [],
  onSeasonChange,
}: EpisodePanelProps) {
  const {
    selectedSeason,
    activeEpisode,
    setActiveEpisode,
    goToNextEpisode,
    goToPrevEpisode,
  } = usePlayer();

  // Filter out Season 0 (Specials)
  const filteredSeasons = useMemo(
    () => seasons.filter((s) => s.season_number > 0),
    [seasons],
  );

  const episodes = seasonData?.episodes ?? [];
  const maxEpisode = episodes.length;
  const currentEpisode = episodes.find(
    (e) => e.episode_number === activeEpisode,
  );

  const selectedSeasonStr =
    selectedSeason < 10 ? `0${selectedSeason}` : `${selectedSeason}`;
  const activeEpisodeStr =
    activeEpisode < 10 ? `0${activeEpisode}` : `${activeEpisode}`;

  const handleEpisodeClick = useCallback(
    (episodeNum: number) => {
      setActiveEpisode(episodeNum);
    },
    [setActiveEpisode],
  );

  const handleSeasonClick = useCallback(
    (seasonNum: number) => {
      onSeasonChange(seasonNum);
    },
    [onSeasonChange],
  );

  return (
    <div className="space-y-3">
      {/* ── Now Playing header ── */}
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#D4A237] opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#D4A237]" />
        </span>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
          Now Playing
        </p>
      </div>

      <h3 className="text-sm font-bold text-[#F4F4F5]">
        S{selectedSeasonStr} : E{activeEpisodeStr}
      </h3>

      {currentEpisode && (
        <>
          <p className="text-xs text-zinc-400 italic truncate max-w-full">
            {currentEpisode.name}
          </p>
          {currentEpisode.runtime && (
            <p className="text-[11px] text-zinc-600">
              {currentEpisode.runtime} min
            </p>
          )}
        </>
      )}

      {/* ── Season tabs as inline pills ── */}
      {filteredSeasons.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-2 px-2 pb-1">
          {filteredSeasons.map((s) => {
            const isActive = s.season_number === selectedSeason;
            return (
              <button
                key={s.id}
                onClick={() => handleSeasonClick(s.season_number)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 ${
                  isActive
                    ? "bg-[#D4A237] text-[#070708]"
                    : "bg-[#0E0E11] text-zinc-500 border border-[#222226] hover:border-white/20"
                }`}
              >
                S
                {s.season_number < 10 ? `0${s.season_number}` : s.season_number}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Episode list (scrollable) ── */}
      <div className="space-y-0.5 max-h-[320px] overflow-y-auto scrollbar-hide -mx-2 px-2">
        {episodes.map((ep) => {
          const isActive = ep.episode_number === activeEpisode;

          return (
            <button
              key={ep.id}
              onClick={() => handleEpisodeClick(ep.episode_number)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all border ${
                isActive
                  ? "bg-[#D4A237]/10 border-l-2 border-[#D4A237] border-y-0 border-r-0"
                  : "border border-transparent hover:bg-[#0E0E11]"
              }`}
            >
              {/* Status dot */}
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  isActive
                    ? "bg-[#D4A237] shadow-[0_0_6px_rgba(212,162,55,0.6)]"
                    : "bg-zinc-700"
                }`}
              />

              {/* Episode info */}
              <div className="flex-1 min-w-0">
                <p
                  className={`text-xs font-semibold truncate ${
                    isActive ? "text-[#D4A237]" : "text-zinc-300"
                  }`}
                >
                  {ep.episode_number}.{" "}
                  {ep.name || `Episode ${ep.episode_number}`}
                </p>
              </div>

              {/* Duration */}
              {ep.runtime && (
                <span className="text-[10px] text-zinc-600 shrink-0">
                  {ep.runtime}m
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Prev / Next buttons ── */}
      <div className="flex items-center gap-2 pt-1">
        <button
          title="Previous Episode"
          disabled={activeEpisode <= 1}
          onClick={goToPrevEpisode}
          className="flex-1 flex items-center justify-center gap-1 h-9 rounded-lg
            bg-[#0E0E11] border border-white/5 text-zinc-500 hover:text-[#F4F4F5]
            hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed
            transition-all text-xs font-semibold"
        >
          <ChevronLeft size={14} />
          Prev
        </button>
        <button
          title="Next Episode"
          disabled={activeEpisode >= maxEpisode}
          onClick={goToNextEpisode}
          className="flex-1 flex items-center justify-center gap-1 h-9 rounded-lg
            bg-[#D4A237] text-[#070708] font-bold hover:bg-[#B88B2A]
            disabled:opacity-30 disabled:cursor-not-allowed
            transition-all text-xs"
        >
          Next
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
