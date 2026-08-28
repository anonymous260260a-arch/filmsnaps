"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { ChevronLeft, ChevronRight, Film, Check } from "lucide-react";
import { usePlayer } from "./PlayerProvider";

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

interface EpisodeRailProps {
  seasonData: SeasonData | null;
  seasons?: Array<{ id: number; season_number: number; name?: string }>;
  onSeasonChange: (season: number) => void;
}

/** Season selector button + popover. Shared by EpisodeRail (phone/tablet) and EpisodeSidebar (desktop). */
export function SeasonSelector({
  seasons = [],
  selectedSeason,
  onSeasonChange,
}: {
  seasons?: Array<{ id: number; season_number: number; name?: string }>;
  selectedSeason: number;
  onSeasonChange: (season: number) => void;
}) {
  const [showSeasons, setShowSeasons] = useState(false);
  const seasonsRef = useRef<HTMLDivElement>(null);
  const filteredSeasons = seasons.filter((s) => s.season_number > 0);

  useEffect(() => {
    if (!showSeasons) return;
    const handleClick = (e: MouseEvent) => {
      if (seasonsRef.current && !seasonsRef.current.contains(e.target as Node))
        setShowSeasons(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSeasons]);

  const handleSeasonSelect = useCallback(
    (seasonNum: number) => {
      onSeasonChange(seasonNum);
      setShowSeasons(false);
    },
    [onSeasonChange],
  );

  if (filteredSeasons.length === 0) return null;

  return (
    <div className="relative" ref={seasonsRef}>
      <button
        onClick={() => setShowSeasons(!showSeasons)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#0E0E11] border border-white/[0.08] hover:border-white/20 rounded-xl text-xs font-bold text-foreground active:scale-[0.98] transition-all whitespace-nowrap"
      >
        <span className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
          Season
        </span>
        <span className="text-xs">
          {selectedSeason < 10 ? `0${selectedSeason}` : selectedSeason}
        </span>
        <ChevronRight
          size={13}
          className={`text-zinc-400 transition-transform duration-200 ${
            showSeasons ? "rotate-90 text-white" : ""
          }`}
        />
      </button>

      {showSeasons && (
        <div className="absolute top-full mt-2 left-0 right-0 sm:right-auto z-50 sm:w-44 max-h-72 overflow-y-auto bg-[#16161A] border border-[#222226] rounded-xl p-1.5 shadow-xl animate-scale-in origin-top">
          {filteredSeasons.map((s) => {
            const isActive = s.season_number === selectedSeason;
            return (
              <button
                key={s.id}
                onClick={() => handleSeasonSelect(s.season_number)}
                className={`w-full flex items-center gap-3 px-3 py-3 sm:py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-[#D4A237]/10 text-[#D4A237]"
                    : "text-zinc-400 hover:bg-white/5 hover:text-zinc-300"
                }`}
              >
                <span className="flex-1 text-left">
                  Season{" "}
                  {s.season_number < 10
                    ? `0${s.season_number}`
                    : s.season_number}
                </span>
                {isActive && <Check size={14} className="text-[#D4A237]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Always-visible episode number "jump strip". P0 on phone (long seasons discoverable without swipe). */
export function EpisodeJumpStrip({
  seasonData,
  activeEpisode,
  onSelect,
}: {
  seasonData: SeasonData | null;
  activeEpisode: number;
  onSelect: (episode: number) => void;
}) {
  const pillScrollRef = useRef<HTMLDivElement>(null);
  const activePillRef = useRef<HTMLButtonElement>(null);
  const episodes = seasonData?.episodes ?? [];

  // Keep the active pill centered when the episode changes.
  useEffect(() => {
    activePillRef.current?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [activeEpisode]);

  if (episodes.length === 0) return null;

  return (
    <div
      ref={pillScrollRef}
      className="flex gap-1.5 overflow-x-auto scroll-smooth pb-1 -mx-1 px-1 [&::-webkit-scrollbar]:hidden"
    >
      {episodes.map((ep) => {
        const isActive = ep.episode_number === activeEpisode;
        return (
          <button
            key={`pill-${ep.id}`}
            ref={isActive ? activePillRef : undefined}
            onClick={() => onSelect(ep.episode_number)}
            className={`flex-shrink-0 min-w-[2.5rem] h-10 px-2 rounded-lg text-xs font-bold transition-all active:scale-95 ${
              isActive
                ? "bg-[#D4A237] text-[#070708] shadow-[0_2px_10px_rgba(212,162,55,0.35)]"
                : "bg-[#0E0E11] border border-white/[0.08] text-zinc-400"
            }`}
            aria-current={isActive ? "true" : undefined}
            aria-label={`Episode ${ep.episode_number}`}
          >
            {ep.episode_number}
          </button>
        );
      })}
    </div>
  );
}

/** Now Watching footer bar (S:E + title). Reused by EpisodeRail and EpisodeSidebar. */
export function NowWatchingBar({
  selectedSeason,
  activeEpisode,
  episodeName,
}: {
  selectedSeason: number;
  activeEpisode: number;
  episodeName?: string;
}) {
  const s = selectedSeason < 10 ? `0${selectedSeason}` : selectedSeason;
  const e = activeEpisode < 10 ? `0${activeEpisode}` : activeEpisode;
  return (
    <div className="flex items-center gap-3 pt-1.5">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#D4A237] opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#D4A237]" />
      </span>
      <p className="text-[11px] font-black uppercase text-zinc-500 tracking-[0.2em]">
        Now Watching
      </p>
      <h3 className="text-sm font-bold text-foreground">
        S{s} : E{e}
      </h3>
      {episodeName && (
        <p className="hidden lg:block text-sm text-zinc-400 italic truncate max-w-md">
          — {episodeName}
        </p>
      )}
    </div>
  );
}

export function EpisodeRail({
  seasonData,
  seasons = [],
  onSeasonChange,
}: EpisodeRailProps) {
  const {
    selectedSeason,
    activeEpisode,
    mediaType,
    setActiveEpisode,
    goToNextEpisode,
    goToPrevEpisode,
    minimal,
  } = usePlayer();

  if (mediaType !== "tv" || minimal) return null;

  const currentEpisode = seasonData?.episodes?.find(
    (e) => e.episode_number === activeEpisode,
  );
  const maxEpisode = seasonData?.episodes?.length ?? 99;

  const scroll = useCallback((dir: "left" | "right") => {
    const el = document.getElementById("ep-rail-scroll");
    if (el)
      el.scrollBy({ left: dir === "left" ? -320 : 320, behavior: "smooth" });
  }, []);

  return (
    <div className="space-y-2 mt-0">
      <SeasonSelector
        seasons={seasons}
        selectedSeason={selectedSeason}
        onSeasonChange={onSeasonChange}
      />

      {/* Phone number jump-strip (sm:hidden inside EpisodeJumpStrip-equivalent) */}
      <div className="sm:hidden">
        <EpisodeJumpStrip
          seasonData={seasonData}
          activeEpisode={activeEpisode}
          onSelect={setActiveEpisode}
        />
      </div>

      {/* Horizontal thumbnail rail — phone swipe + tablet/desktop side arrows */}
      {seasonData?.episodes && seasonData.episodes.length > 0 && (
        <div className="relative">
          <button
            onClick={() => scroll("left")}
            className="hidden md:flex absolute -left-4 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-[#0E0E11] border border-[#222226] items-center justify-center text-zinc-500 hover:text-white hover:border-white/20 transition-all shadow-lg"
          >
            <ChevronLeft size={18} />
          </button>

          <div
            id="ep-rail-scroll"
            className="flex gap-3 overflow-x-auto md:overflow-x-hidden scroll-smooth snap-x snap-mandatory pb-2 -mx-1 px-1 [&::-webkit-scrollbar]:hidden"
          >
            {seasonData.episodes.map((ep) => {
              const isActive = ep.episode_number === activeEpisode;
              const imgUrl = ep.still_path;
              return (
                <div
                  key={ep.id}
                  onClick={() => setActiveEpisode(ep.episode_number)}
                  className={`snap-start flex-shrink-0 w-[78vw] sm:w-[260px] md:w-[220px] lg:w-[250px] cursor-pointer group rounded-xl overflow-hidden border transition-all duration-300 bg-[#0E0E11] ${
                    isActive
                      ? "border-[#D4A237]/50 shadow-[0_4px_20px_rgba(212,162,55,0.15)]"
                      : "border-transparent hover:border-white/10 hover:bg-[#16161A]"
                  }`}
                >
                  <div className="relative aspect-video bg-[#070708] overflow-hidden">
                    {imgUrl ? (
                      <img
                        src={`https://image.tmdb.org/t/p/w300${imgUrl}`}
                        alt={ep.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Film size={20} className="text-zinc-700" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                    <div className="absolute bottom-2 left-3 flex items-center gap-1.5">
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${
                          isActive
                            ? "bg-[#D4A237] animate-pulse shadow-[0_0_6px_rgba(212,162,55,0.6)]"
                            : "bg-white/40"
                        }`}
                      />
                      <span className="text-xs font-bold text-white drop-shadow-sm">
                        E
                        {ep.episode_number < 10
                          ? `0${ep.episode_number}`
                          : ep.episode_number}
                      </span>
                    </div>
                  </div>
                  <div className="px-2.5 py-2">
                    <p
                      className={`text-sm font-semibold truncate ${
                        isActive ? "text-[#D4A237]" : "text-zinc-300"
                      }`}
                    >
                      {ep.name || `Episode ${ep.episode_number}`}
                    </p>
                    <p className="text-[11px] text-zinc-600 mt-0.5">
                      Episode {ep.episode_number}
                      {ep.runtime ? ` · ${ep.runtime}m` : ""}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => scroll("right")}
            className="hidden md:flex absolute -right-4 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-[#0E0E11] border border-[#222226] items-center justify-center text-zinc-500 hover:text-white hover:border-white/20 transition-all shadow-lg"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      <NowWatchingBar
        selectedSeason={selectedSeason}
        activeEpisode={activeEpisode}
        episodeName={currentEpisode?.name}
      />

      <div className="flex items-center gap-2">
        <button
          title="Previous Episode"
          disabled={activeEpisode <= 1}
          onClick={goToPrevEpisode}
          className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 h-12 sm:h-11 px-4 rounded-xl bg-[#0E0E11] border border-white/5 text-zinc-500 hover:text-foreground hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
        >
          <ChevronLeft size={16} />
          <span className="text-xs font-semibold">Prev</span>
        </button>
        <button
          title="Next Episode"
          disabled={activeEpisode >= maxEpisode}
          onClick={goToNextEpisode}
          className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 h-12 sm:h-11 px-4 rounded-xl bg-[#D4A237] text-[#070708] font-bold hover:bg-[#B88B2A] disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95 shadow-lg shadow-[#D4A237]/5"
        >
          <span className="text-xs">Next</span>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
