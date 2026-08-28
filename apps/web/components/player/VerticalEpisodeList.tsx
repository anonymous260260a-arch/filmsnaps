"use client";

import React, { useEffect, useRef } from "react";
import { Film, Play } from "lucide-react";
import { getImageUrl } from "@/lib/tmdb";
import { usePlayer } from "./PlayerProvider";

interface EpisodeItem {
  id: number;
  episode_number: number;
  name?: string;
  overview?: string;
  still_path?: string | null;
  runtime?: number;
}

interface VerticalEpisodeListProps {
  seasonData: { episodes?: EpisodeItem[] } | null;
  /** Override click target (defaults to usePlayer().setActiveEpisode). */
  onSelect?: (episode: number) => void;
  /** Whether to auto-scroll the active episode into view on mount/change */
  autoScroll?: boolean;
}

/**
 * YouTube-inspired vertical episode list — thumbnail-left / title+duration-right.
 * Features:
 * - 16:9 thumbnail with episode badge & duration badge
 * - Active playing indicator (equalizer animation & play icon)
 * - Auto-scroll to active episode
 * - Smooth hover and active states
 */
export function VerticalEpisodeList({
  seasonData,
  onSelect,
  autoScroll = true,
}: VerticalEpisodeListProps) {
  const { activeEpisode, setActiveEpisode } = usePlayer();
  const episodes = seasonData?.episodes ?? [];
  const activeItemRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll the active episode into view when list is mounted or activeEpisode changes
  useEffect(() => {
    if (autoScroll && activeItemRef.current) {
      activeItemRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [activeEpisode, autoScroll]);

  if (episodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center text-zinc-500">
        <Film size={24} className="mb-2 opacity-40" />
        <p className="text-xs">No episodes found for this season</p>
      </div>
    );
  }

  const handle = onSelect ?? setActiveEpisode;

  return (
    <div className="space-y-2">
      {episodes.map((ep) => {
        const isActive = ep.episode_number === activeEpisode;
        const imgUrl = ep.still_path
          ? getImageUrl(ep.still_path, "w300")
          : null;

        return (
          <button
            key={ep.id}
            ref={isActive ? activeItemRef : undefined}
            onClick={() => handle(ep.episode_number)}
            className={`group w-full flex items-stretch gap-2 sm:gap-2.5 p-1 sm:p-1.5 text-left rounded-xl transition-all duration-200 border ${
              isActive
                ? "bg-[#D4A237]/[0.08] border-[#D4A237]/40 shadow-[0_4px_20px_rgba(212,162,55,0.12)]"
                : "bg-[#0E0E11]/80 border-white/[0.04] hover:border-white/15 hover:bg-white/[0.04]"
            }`}
          >
            {/* Thumbnail */}
            <div className="relative w-20 sm:w-24 md:w-28 aspect-video rounded-lg bg-[#070708] shrink-0 overflow-hidden ring-1 ring-white/10">
              {imgUrl ? (
                <img
                  src={imgUrl}
                  alt={ep.name || `Episode ${ep.episode_number}`}
                  className={`w-full h-full object-cover transition-transform duration-300 ${
                    isActive ? "scale-105" : "group-hover:scale-105"
                  }`}
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                  <Film size={16} className="text-zinc-700" />
                </div>
              )}

              {/* Gradient overlay on hover / active */}
              <div
                className={`absolute inset-0 transition-opacity duration-200 ${
                  isActive
                    ? "bg-black/30"
                    : "bg-black/20 group-hover:bg-black/10"
                }`}
              />

              {/* Episode Number Badge (Top-left) */}
              <div className="absolute top-0.5 left-0.5 px-1 py-0.5 rounded bg-black/80 backdrop-blur-sm border border-white/10">
                <span className="text-[9px] font-black tracking-wider text-zinc-200 font-mono">
                  E
                  {ep.episode_number < 10
                    ? `0${ep.episode_number}`
                    : ep.episode_number}
                </span>
              </div>

              {/* Duration Badge (Bottom-right) */}
              {ep.runtime ? (
                <div className="absolute bottom-0.5 right-0.5 px-1 py-0.5 rounded bg-black/85 backdrop-blur-sm border border-white/10">
                  <span className="text-[8px] font-bold text-zinc-300">
                    {ep.runtime}m
                  </span>
                </div>
              ) : null}

              {/* Active Playing Equalizer Indicator */}
              {isActive && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <div className="flex items-end gap-0.5 h-3 px-1.5 py-0.5 rounded-full bg-black/80 backdrop-blur-sm border border-[#D4A237]/40 shadow-sm">
                    <span className="w-0.5 bg-[#D4A237] rounded-full animate-pulse h-2" />
                    <span className="w-0.5 bg-[#D4A237] rounded-full animate-pulse h-3" />
                    <span className="w-0.5 bg-[#D4A237] rounded-full animate-pulse h-1.5" />
                  </div>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1 py-0.5 pr-0.5 flex flex-col justify-center">
              <div className="flex items-center gap-1 leading-none">
                {isActive && (
                  <span className="shrink-0 flex items-center gap-0.5 text-[9px] font-black uppercase tracking-wider text-[#D4A237]">
                    <Play size={8} className="fill-[#D4A237]" /> Playing
                  </span>
                )}
              </div>
              <p
                className={`text-xs font-semibold truncate leading-tight mt-0.5 ${
                  isActive
                    ? "text-[#D4A237]"
                    : "text-zinc-200 group-hover:text-white"
                }`}
              >
                {ep.name || `Episode ${ep.episode_number}`}
              </p>
              <p className="text-[10px] text-zinc-500 mt-0.5 truncate leading-tight">
                Episode {ep.episode_number}
                {ep.overview ? ` · ${ep.overview}` : ""}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
