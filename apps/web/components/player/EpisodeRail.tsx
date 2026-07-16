/**
 * EpisodeRail — TV show season/episode selector with navigation.
 */

'use client';

import React from 'react';
import { ChevronDown, SkipBack, SkipForward } from 'lucide-react';
import { usePlayer } from './PlayerProvider';

interface SeasonData {
  episodes?: Array<{
    id: number;
    episode_number: number;
    name: string;
  }>;
}

interface EpisodeRailProps {
  /** Season data from TMDB (episodes list) */
  seasonData: SeasonData | null;
  /** Available seasons from TMDB */
  seasons?: Array<{ id: number; season_number: number }>;
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

  if (mediaType !== 'tv' || minimal) return null;

  const currentEpisode = seasonData?.episodes?.find(
    (e) => e.episode_number === activeEpisode,
  );
  const maxEpisode = seasonData?.episodes?.length ?? 99;

  return (
    <>
      {/* Season & Episode Selectors */}
      <div className="mt-6 sm:mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
        {/* Season Selector */}
        {seasons.length > 0 && (
          <div className="relative group">
            <div className="absolute -top-2.5 left-4 px-2 bg-[#070708] text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 z-10 group-focus-within:text-[#D4A237] transition-colors">
              Season
            </div>
            <div className="relative flex items-center">
              <select
                value={selectedSeason}
                onChange={(e) => onSeasonChange(Number(e.target.value))}
                aria-label="Select Season"
                className="w-full bg-[#0E0E11]/80 backdrop-blur hover:bg-[#16161A] focus:bg-[#16161A] transition-all border border-[#222226] focus:border-[#D4A237]/30 text-[#F4F4F5] text-sm font-bold py-4 px-5 rounded-2xl outline-none appearance-none cursor-pointer shadow-[0_8px_30px_rgba(0,0,0,0.4)] focus-visible:ring-2 focus-visible:ring-[#D4A237]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070708] min-h-[56px]"
              >
                {seasons.map((s) => (
                  <option
                    key={s.id}
                    value={s.season_number}
                    className="bg-[#0E0E11] text-[#F4F4F5] py-4"
                  >
                    Season {s.season_number < 10 ? `0${s.season_number}` : s.season_number}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="absolute right-5 text-zinc-500 group-hover:text-[#F4F4F5] transition-colors pointer-events-none"
                size={18}
              />
            </div>
          </div>
        )}

        {/* Episode Selector */}
        <div className="relative group">
          <div className="absolute -top-2.5 left-4 px-2 bg-[#070708] text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 z-10 group-focus-within:text-[#D4A237] transition-colors">
            Episode
          </div>
          <div className="relative flex items-center">
            <select
              value={activeEpisode}
              onChange={(e) => setActiveEpisode(Number(e.target.value))}
              aria-label="Select Episode"
              className="w-full bg-[#0E0E11]/80 backdrop-blur hover:bg-[#16161A] focus:bg-[#16161A] transition-all border border-[#222226] focus:border-[#D4A237]/30 text-[#F4F4F5] text-sm font-bold py-5 px-6 rounded-2xl outline-none appearance-none cursor-pointer truncate pr-14 shadow-[0_8px_30px_rgba(0,0,0,0.4)] focus-visible:ring-2 focus-visible:ring-[#D4A237]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070708] min-h-[56px]"
            >
              {seasonData?.episodes?.map((ep) => (
                <option
                  key={ep.id}
                  value={ep.episode_number}
                  className="bg-[#0E0E11] text-[#F4F4F5] py-4"
                >
                  {ep.episode_number < 10 ? `0${ep.episode_number}` : ep.episode_number}
                  {' — '}{ep.name.slice(0, 40)}
                </option>
              ))}
            </select>
            <div className="absolute right-5 flex items-center gap-2 border-l border-[#222226] pl-4">
              <ChevronDown
                className="text-zinc-500 group-hover:text-[#F4F4F5] transition-colors pointer-events-none"
                size={18}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Now Watching & Navigation */}
      <div className="mt-8 sm:mt-12 flex flex-col sm:flex-row items-start sm:items-center justify-between border-t border-white/5 pt-6 sm:pt-10 gap-5 sm:gap-6">
        <div className="flex flex-row items-center gap-4 sm:gap-8 w-full sm:w-auto">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <p className="text-[9px] font-black uppercase text-zinc-600 tracking-widest">
              Now Watching
            </p>
          </div>
          <h2 className="text-sm font-bold text-[#F4F4F5] tracking-tight">
            S{selectedSeason < 10 ? `0${selectedSeason}` : selectedSeason}
            {' : '}
            E{activeEpisode < 10 ? `0${activeEpisode}` : activeEpisode}
          </h2>
          {currentEpisode && (
            <div className="hidden lg:block max-w-[250px]">
              <p className="text-[9px] font-black uppercase text-zinc-600 tracking-widest">
                Chapter Title
              </p>
              <h2 className="text-sm font-medium text-zinc-400 italic truncate">
                {currentEpisode.name}
              </h2>
            </div>
          )}
        </div>

        {/* Episode Navigation Buttons */}
        <div className="flex items-center gap-3 sm:gap-3 w-full sm:w-auto">
          <button
            title="Previous Episode"
            disabled={activeEpisode <= 1}
            onClick={goToPrevEpisode}
            className="flex-1 sm:flex-initial h-12 sm:w-12 flex items-center justify-center gap-2 sm:gap-0 rounded-2xl bg-[#0E0E11] border border-white/5 text-zinc-500 hover:text-[#F4F4F5] hover:border-white/20 disabled:opacity-20 transition-all active:scale-90 px-4 sm:px-0"
          >
            <SkipBack size={18} fill="currentColor" />
            <span className="text-xs text-zinc-500 sm:hidden">Previous</span>
          </button>
          <button
            title="Next Episode"
            disabled={activeEpisode >= maxEpisode}
            onClick={goToNextEpisode}
            className="flex-1 sm:flex-initial h-12 sm:w-12 flex items-center justify-center gap-2 sm:gap-0 rounded-2xl bg-[#D4A237] text-[#070708] hover:bg-[#B88B2A] disabled:opacity-20 transition-all active:scale-90 shadow-xl shadow-[#D4A237]/5 px-4 sm:px-0"
          >
            <span className="text-xs text-[#070708] sm:hidden">Next</span>
            <SkipForward size={18} fill="currentColor" />
          </button>
        </div>
      </div>
    </>
  );
}
