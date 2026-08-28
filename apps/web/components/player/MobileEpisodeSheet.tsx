"use client";

import React, { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  X,
  ListVideo,
  Info,
  Play,
  Sparkles,
} from "lucide-react";
import { usePlayer } from "./PlayerProvider";
import { VerticalEpisodeList } from "./VerticalEpisodeList";
import { SeasonSelector } from "./EpisodeRail";

interface MobileEpisodeSheetProps {
  seasonData: {
    episodes?: Array<{
      id: number;
      episode_number: number;
      name?: string;
      overview?: string;
      still_path?: string | null;
      runtime?: number;
    }>;
  } | null;
  seasons?: Array<{ id: number; season_number: number; name?: string }>;
  onSeasonChange: (season: number) => void;
  seriesTitle?: string;
  seriesOverview?: string;
}

export function MobileEpisodeSheet({
  seasonData,
  seasons = [],
  onSeasonChange,
  seriesTitle,
  seriesOverview,
}: MobileEpisodeSheetProps) {
  const {
    selectedSeason,
    activeEpisode,
    setActiveEpisode,
    goToNextEpisode,
    goToPrevEpisode,
  } = usePlayer();

  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"episodes" | "overview">(
    "episodes",
  );

  const episodes = seasonData?.episodes ?? [];
  const currentEpisode = episodes.find(
    (e) => e.episode_number === activeEpisode,
  );
  const totalEpisodes = episodes.length;
  const isFirstEpisode = activeEpisode <= 1;
  const isLastEpisode = activeEpisode >= totalEpisodes && totalEpisodes > 0;

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[#0A0A0D] border-t border-white/[0.08] relative overflow-hidden select-none">
      {/* ── Collapsed Bar (Compact YouTube-style Playlist Bar) ── */}
      {!isExpanded && (
        <div className="shrink-0 flex items-center justify-between px-3 py-2 bg-[#0E0E12] border-b border-white/[0.06] gap-2">
          {/* Left: Tap to open drawer */}
          <button
            onClick={() => setIsExpanded(true)}
            className="flex-1 flex items-center gap-2 min-w-0 text-left group active:opacity-75 transition-opacity"
            aria-label="Open episode list"
          >
            <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-[#D4A237]/10 border border-[#D4A237]/30 text-[#D4A237] shrink-0">
              <ListVideo size={13} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 leading-none">
                <span className="text-[10px] font-black uppercase tracking-wider text-[#D4A237]">
                  S{selectedSeason < 10 ? `0${selectedSeason}` : selectedSeason}
                  :E
                  {activeEpisode < 10 ? `0${activeEpisode}` : activeEpisode}
                </span>
                <span className="text-[10px] text-zinc-500">
                  • {activeEpisode}/{totalEpisodes || "?"}
                </span>
              </div>
              <p className="text-xs font-semibold text-zinc-200 truncate mt-0.5 group-hover:text-white">
                {currentEpisode?.name || `Episode ${activeEpisode}`}
              </p>
            </div>
            <ChevronUp
              size={15}
              className="text-zinc-400 shrink-0 group-hover:text-white transition-colors mr-0.5"
            />
          </button>

          {/* Right: Quick Next Episode Button */}
          <button
            onClick={goToNextEpisode}
            disabled={isLastEpisode}
            title="Next Episode"
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#D4A237] text-[#070708] text-xs font-bold hover:bg-[#B88B2A] disabled:opacity-30 disabled:pointer-events-none transition-all active:scale-95 shadow-md shadow-[#D4A237]/10 shrink-0"
          >
            <span>Next</span>
            <ChevronRight size={13} />
          </button>
        </div>
      )}

      {/* ── Collapsed Content Area (When drawer is closed: shows Overview + Quick Details) ── */}
      {!isExpanded && (
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
          {/* Quick Info Chip */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D4A237] animate-pulse" />
              <span className="text-xs text-zinc-300 font-medium">
                Season {selectedSeason} ({totalEpisodes} episodes)
              </span>
            </div>
            <button
              onClick={() => setIsExpanded(true)}
              className="text-xs font-bold text-[#D4A237] hover:underline"
            >
              Browse All
            </button>
          </div>

          {/* Episode or Series Synopsis */}
          {currentEpisode?.overview ? (
            <div>
              <h4 className="text-[10px] font-black uppercase tracking-wider text-zinc-500 mb-0.5">
                Episode Synopsis
              </h4>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {currentEpisode.overview}
              </p>
            </div>
          ) : seriesOverview ? (
            <div>
              <h4 className="text-[10px] font-black uppercase tracking-wider text-zinc-500 mb-0.5">
                Series Overview
              </h4>
              <p className="text-xs text-zinc-400 leading-relaxed line-clamp-4">
                {seriesOverview}
              </p>
            </div>
          ) : null}
        </div>
      )}

      {/* ── Expanded Drawer (YouTube-style Full Episode Sheet) ── */}
      {isExpanded && (
        <div className="flex-1 min-h-0 flex flex-col bg-[#0E0E12] animate-in fade-in slide-in-from-bottom-4 duration-200">
          {/* Header */}
          <div className="shrink-0 px-3 py-2 border-b border-white/[0.08] flex items-center justify-between bg-[#141418] gap-2">
            <div className="min-w-0 flex items-center gap-2">
              <SeasonSelector
                seasons={seasons}
                selectedSeason={selectedSeason}
                onSeasonChange={onSeasonChange}
              />
              <span className="text-xs text-zinc-400 font-medium truncate">
                {totalEpisodes} episodes
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {/* Tab Switcher */}
              <button
                onClick={() =>
                  setActiveTab(
                    activeTab === "episodes" ? "overview" : "episodes",
                  )
                }
                className={`p-1.5 rounded-lg text-xs font-medium transition-colors ${
                  activeTab === "overview"
                    ? "bg-white/10 text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
                title={
                  activeTab === "episodes" ? "Show Overview" : "Show Episodes"
                }
              >
                {activeTab === "episodes" ? (
                  <Info size={15} />
                ) : (
                  <ListVideo size={15} />
                )}
              </button>

              {/* Close Button */}
              <button
                onClick={() => setIsExpanded(false)}
                className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/[0.06] text-zinc-300 hover:text-white hover:bg-white/[0.12] active:scale-95 transition-all"
                aria-label="Close episode drawer"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Content: Episodes list or Overview */}
          {activeTab === "episodes" ? (
            <div className="flex-1 min-h-0 overflow-y-auto p-2.5">
              <VerticalEpisodeList
                seasonData={seasonData}
                onSelect={(ep) => {
                  setActiveEpisode(ep);
                }}
                autoScroll={true}
              />
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3">
              {currentEpisode && (
                <div>
                  <h3 className="text-xs font-bold text-foreground">
                    Episode {currentEpisode.episode_number}:{" "}
                    {currentEpisode.name}
                  </h3>
                  {currentEpisode.overview && (
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      {currentEpisode.overview}
                    </p>
                  )}
                </div>
              )}
              {seriesOverview && (
                <div className="pt-2.5 border-t border-white/[0.06]">
                  <h4 className="text-xs font-bold text-zinc-300">
                    About the Show
                  </h4>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    {seriesOverview}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Pinned Prev / Next Footer */}
          <div className="shrink-0 p-2 bg-[#141418] border-t border-white/[0.08] flex items-center gap-2">
            <button
              onClick={goToPrevEpisode}
              disabled={isFirstEpisode}
              className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-xl bg-white/[0.06] border border-white/[0.08] text-zinc-300 text-xs font-bold hover:bg-white/[0.12] hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-all active:scale-[0.98]"
            >
              <ChevronLeft size={13} />
              <span>Prev Episode</span>
            </button>
            <button
              onClick={goToNextEpisode}
              disabled={isLastEpisode}
              className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-xl bg-[#D4A237] text-[#070708] text-xs font-bold hover:bg-[#B88B2A] disabled:opacity-30 disabled:pointer-events-none transition-all active:scale-[0.98] shadow-md shadow-[#D4A237]/10"
            >
              <span>Next Episode</span>
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
