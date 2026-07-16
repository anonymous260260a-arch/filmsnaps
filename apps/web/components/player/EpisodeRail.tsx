/**
 * EpisodeRail — TV show season/episode selector with thumbnail cards.
 *
 * Redesigned from dual <select> dropdowns to:
 * - Season accordion popover
 * - Horizontal scrollable episode cards with still_path thumbnails
 * - Prev/Next navigation buttons below
 */

'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Film, Check } from 'lucide-react';
import { usePlayer } from './PlayerProvider';

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
  /** Season data from TMDB (episodes list) */
  seasonData: SeasonData | null;
  /** Available seasons from TMDB */
  seasons?: Array<{ id: number; season_number: number; name?: string }>;
  /** Called when season changes */
  onSeasonChange: (season: number) => void;
}

export function EpisodeRail({ seasonData, seasons = [], onSeasonChange }: EpisodeRailProps) {
  const {
    selectedSeason,
    activeEpisode,
    mediaType,
    setActiveEpisode,
    goToNextEpisode,
    goToPrevEpisode,
    minimal,
  } = usePlayer();

  const [showSeasons, setShowSeasons] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seasonsRef = useRef<HTMLDivElement>(null);

  if (mediaType !== 'tv' || minimal) return null;

  const currentEpisode = seasonData?.episodes?.find(
    (e) => e.episode_number === activeEpisode,
  );
  const maxEpisode = seasonData?.episodes?.length ?? 99;

  // Filter out Season 0 (Specials) from the season list
  const filteredSeasons = seasons.filter((s) => s.season_number > 0);

  // Close seasons popover on click outside
  useEffect(() => {
    if (!showSeasons) return;
    const handleClick = (e: MouseEvent) => {
      if (seasonsRef.current && !seasonsRef.current.contains(e.target as Node)) {
        setShowSeasons(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showSeasons]);

  const scroll = useCallback((dir: 'left' | 'right') => {
    if (scrollRef.current) {
      const amount = dir === 'left' ? -320 : 320;
      scrollRef.current.scrollBy({ left: amount, behavior: 'smooth' });
    }
  }, []);

  const handleSeasonSelect = useCallback(
    (seasonNum: number) => {
      onSeasonChange(seasonNum);
      setShowSeasons(false);
    },
    [onSeasonChange],
  );

  return (
    <div className="space-y-3 mt-3 sm:mt-4">
      {/* ── Season Selector ── */}
      {filteredSeasons.length > 0 && (
        <div className="relative" ref={seasonsRef}>
          <button
            onClick={() => setShowSeasons(!showSeasons)}
            className="flex items-center gap-2 px-3 py-2 bg-[#0E0E11]
              border border-[#222226] rounded-xl text-sm font-bold text-[#F4F4F5]
              hover:border-white/20 transition-colors"
          >
            <span
              className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500"
            >
              Season
            </span>
            <span className="text-sm">
              {selectedSeason < 10 ? `0${selectedSeason}` : selectedSeason}
            </span>
            <ChevronRight
              size={14}
              className={`text-zinc-500 transition-transform duration-200 ${
                showSeasons ? 'rotate-90' : ''
              }`}
            />
          </button>

          {/* Popover dropdown */}
          {showSeasons && (
            <div
              className="absolute top-full mt-2 left-0 z-50 w-44 max-h-60 overflow-y-auto
                bg-[#16161A] border border-[#222226] rounded-xl p-1.5 shadow-xl
                animate-scale-in origin-top-left"
            >
              {filteredSeasons.map((s) => {
                const isActive = s.season_number === selectedSeason;
                return (
                  <button
                    key={s.id}
                    onClick={() => handleSeasonSelect(s.season_number)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors
                      ${isActive
                        ? 'bg-[#D4A237]/10 text-[#D4A237]'
                        : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-300'
                      }`}
                  >
                    <span className="flex-1 text-left">
                      Season {s.season_number < 10 ? `0${s.season_number}` : s.season_number}
                    </span>
                    {isActive && <Check size={14} className="text-[#D4A237]" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Episode Carousel ── */}
      {seasonData?.episodes && seasonData.episodes.length > 0 && (
        <div className="relative">
          {/* Scroll Left (desktop only) */}
          <button
            onClick={() => scroll('left')}
            className="hidden md:flex absolute -left-4 top-1/2 -translate-y-1/2 z-20
              w-9 h-9 rounded-full bg-[#0E0E11] border border-[#222226]
              items-center justify-center text-zinc-500 hover:text-white
              hover:border-white/20 transition-all shadow-lg"
          >
            <ChevronLeft size={18} />
          </button>

          {/* Scrollable track */}
          <div
            ref={scrollRef}
            className="flex gap-3 overflow-x-auto md:overflow-x-hidden
              scroll-smooth snap-x snap-mandatory pb-2 -mx-1 px-1
              [&::-webkit-scrollbar]:hidden"
          >
            {seasonData.episodes.map((ep) => {
              const isActive = ep.episode_number === activeEpisode;
              const imgUrl = ep.still_path;

              return (
                <div
                  key={ep.id}
                  onClick={() => setActiveEpisode(ep.episode_number)}
                  className={`snap-start flex-shrink-0 w-[260px] md:w-[220px] lg:w-[250px]
                    cursor-pointer group rounded-xl overflow-hidden border
                    transition-all duration-300 bg-[#0E0E11]
                    ${isActive
                      ? 'border-[#D4A237]/50 shadow-[0_4px_20px_rgba(212,162,55,0.15)]'
                      : 'border-transparent hover:border-white/10 hover:bg-[#16161A]'
                    }`}
                >
                  {/* Thumbnail */}
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
                    {/* Gradient overlay at bottom for text legibility */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

                    {/* Episode badge */}
                    <div className="absolute bottom-2 left-3 flex items-center gap-1.5">
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${
                          isActive
                            ? 'bg-[#D4A237] animate-pulse shadow-[0_0_6px_rgba(212,162,55,0.6)]'
                            : 'bg-white/40'
                        }`}
                      />
                      <span className="text-xs font-bold text-white drop-shadow-sm">
                        E{ep.episode_number < 10 ? `0${ep.episode_number}` : ep.episode_number}
                      </span>
                    </div>
                  </div>

                  {/* Episode info */}
                  <div className="px-2.5 py-2">
                    <p
                      className={`text-sm font-semibold truncate ${
                        isActive ? 'text-[#D4A237]' : 'text-zinc-300'
                      }`}
                    >
                      {ep.name || `Episode ${ep.episode_number}`}
                    </p>
                    <p className="text-[11px] text-zinc-600 mt-0.5">
                      Episode {ep.episode_number}
                      {ep.runtime ? ` · ${ep.runtime}m` : ''}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Scroll Right (desktop only) */}
          <button
            onClick={() => scroll('right')}
            className="hidden md:flex absolute -right-4 top-1/2 -translate-y-1/2 z-20
              w-9 h-9 rounded-full bg-[#0E0E11] border border-[#222226]
              items-center justify-center text-zinc-500 hover:text-white
              hover:border-white/20 transition-all shadow-lg"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      {/* ── Now Watching Metadata ── */}
      {currentEpisode && (
        <div className="flex items-center gap-3 pt-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#D4A237] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#D4A237]" />
          </span>
          <p className="text-[9px] font-black uppercase text-zinc-500 tracking-[0.2em]">
            Now Watching
          </p>
          <h3 className="text-sm font-bold text-[#F4F4F5]">
            S{selectedSeason < 10 ? `0${selectedSeason}` : selectedSeason} : E{activeEpisode < 10 ? `0${activeEpisode}` : activeEpisode}
          </h3>
          <p className="hidden lg:block text-sm text-zinc-400 italic truncate max-w-md">
            — {currentEpisode.name}
          </p>
        </div>
      )}

      {/* ── Prev / Next Navigation ── */}
      <div className="flex items-center gap-2">
        <button
          title="Previous Episode"
          disabled={activeEpisode <= 1}
          onClick={goToPrevEpisode}
          className="flex-1 sm:flex-none flex items-center justify-center gap-1.5
            h-11 px-4 rounded-xl bg-[#0E0E11] border border-white/5
            text-zinc-500 hover:text-[#F4F4F5] hover:border-white/20
            disabled:opacity-30 disabled:cursor-not-allowed
            transition-all active:scale-95"
        >
          <ChevronLeft size={16} />
          <span className="text-xs font-semibold">Prev</span>
        </button>
        <button
          title="Next Episode"
          disabled={activeEpisode >= maxEpisode}
          onClick={goToNextEpisode}
          className="flex-1 sm:flex-none flex items-center justify-center gap-1.5
            h-11 px-4 rounded-xl bg-[#D4A237] text-[#070708]
            font-bold hover:bg-[#B88B2A]
            disabled:opacity-30 disabled:cursor-not-allowed
            transition-all active:scale-95 shadow-lg shadow-[#D4A237]/5"
        >
          <span className="text-xs">Next</span>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
