"use client";

/**
 * HubEpisodesPane — the Episodes tab of PlayerHub.
 *
 * Direct port of mobile's PlayerHub episodes pane (apps/mobile/components/
 * player/PlayerHub.tsx): season pills on top when the show has multiple
 * seasons, then clean bordered episode cards — 16:9 thumb, E-number + title,
 * runtime · air date, per-episode progress bar, Playing badge and watched
 * check. No playlist header, no Now-Watching footer: the page scrolls
 * instead of living in a locked viewport.
 */

import React, { useEffect, useMemo, useRef } from "react";
import { CheckCircle2, Film, Loader2, Play } from "lucide-react";
import { getImageUrl } from "@/lib/tmdb";
import { usePlayer } from "./PlayerProvider";
import { useCachedWatchHistory } from "@/hooks/useCachedWatchHistory";

interface EpisodeItem {
  id: number;
  episode_number: number;
  name?: string;
  overview?: string;
  still_path?: string | null;
  runtime?: number;
  air_date?: string;
}

interface HubEpisodesPaneProps {
  seasonData: { episodes?: EpisodeItem[] } | null;
  seasons?: Array<{ id: number; season_number: number; name?: string }>;
  onSeasonChange: (season: number) => void;
  /** TMDB show id — enables per-episode watch-progress bars (mobile parity). */
  tvId?: string | null;
}

export function HubEpisodesPane({
  seasonData,
  seasons = [],
  onSeasonChange,
  tvId,
}: HubEpisodesPaneProps) {
  const { selectedSeason, activeEpisode, setActiveEpisode } = usePlayer();
  const { entries } = useCachedWatchHistory();
  const episodes = seasonData?.episodes ?? [];
  const activeItemRef = useRef<HTMLButtonElement>(null);

  // Keep the playing episode in view (mobile scrolls its FlatList to the
  // current episode on mount / next-episode advance).
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({
      behavior: "auto",
      block: "nearest",
    });
  }, [activeEpisode, episodes.length]);

  // Per-episode watch progress for the displayed season (library/history
  // store — same data mobile's hub reads via getProgress).
  const progressByEpisode = useMemo(() => {
    const map = new Map<number, { percent: number; completed: boolean }>();
    if (!tvId) return map;
    const id = String(tvId);
    for (const e of entries) {
      if (e.mediaType !== "tv" || e.tmdbId !== id) continue;
      if (e.season !== selectedSeason || e.episode == null) continue;
      map.set(e.episode, { percent: e.percent, completed: e.completed });
    }
    return map;
  }, [entries, tvId, selectedSeason]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Season pills (only when the show has more than one season) */}
      {seasons.length > 1 && (
        <div className="flex shrink-0 gap-2 overflow-x-auto px-3 py-2.5">
          {seasons.map((s) => {
            const selected = s.season_number === selectedSeason;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSeasonChange(s.season_number)}
                className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors ${
                  selected
                    ? "border-[#D4A237] bg-[#D4A237] text-[#070708]"
                    : "border-white/[0.06] bg-[#0E0E11] text-zinc-400 hover:border-white/[0.14] hover:text-zinc-200"
                }`}
              >
                Season {s.season_number}
              </button>
            );
          })}
        </div>
      )}

      {/* Episode cards */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {!seasonData ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10">
            <Loader2 size={22} className="animate-spin text-[#D4A237]" />
            <span className="text-xs text-[#A1A1AA]">Loading episodes…</span>
          </div>
        ) : episodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10">
            <Film size={22} className="text-[#52525B]" />
            <span className="text-xs text-[#52525B]">No episodes found</span>
          </div>
        ) : (
          episodes.map((ep) => {
            const epNum = ep.episode_number;
            const isActive = epNum === activeEpisode;
            const prog = progressByEpisode.get(epNum);
            const hasProgress =
              !!prog && !prog.completed && prog.percent > 0.05;
            const isCompleted = !!prog?.completed;
            const imgUrl = ep.still_path
              ? getImageUrl(ep.still_path, "w300")
              : null;
            const metaLine = [
              ep.runtime ? `${ep.runtime}m` : null,
              ep.air_date ?? null,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <button
                key={ep.id}
                type="button"
                ref={isActive ? activeItemRef : undefined}
                onClick={() => {
                  if (!isActive) setActiveEpisode(epNum);
                }}
                className={`mb-2 flex min-h-[76px] w-full items-center rounded-[14px] border p-2 text-left transition-colors ${
                  isActive
                    ? "border-[#D4A237]/40 bg-[#D4A237]/[0.08]"
                    : "border-white/[0.06] bg-[#0E0E11] hover:border-white/[0.14] hover:bg-white/[0.03]"
                }`}
              >
                {/* 16:9 thumb */}
                <div className="relative mr-2.5 h-[54px] w-24 shrink-0 overflow-hidden rounded-lg bg-[#222226]">
                  {imgUrl ? (
                    <img
                      src={imgUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : null}
                  {isActive && (
                    <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-[#D4A237] px-1 py-px">
                      <Play
                        size={9}
                        className="fill-[#070708] text-[#070708]"
                      />
                      <span className="text-[8.5px] font-extrabold leading-none text-[#070708]">
                        Playing
                      </span>
                    </span>
                  )}
                  {hasProgress && (
                    <span className="absolute inset-x-0 bottom-0 block h-[3px] bg-white/25">
                      <span
                        className="block h-full bg-[#D4A237]"
                        style={{
                          width: `${Math.min(100, prog!.percent * 100)}%`,
                        }}
                      />
                    </span>
                  )}
                </div>

                {/* Text block */}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5">
                    <span className="shrink-0 text-[11.5px] font-extrabold tabular-nums text-[#D4A237]">
                      E{String(epNum).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-100">
                      {ep.name || `Episode ${epNum}`}
                    </span>
                    {isCompleted && (
                      <CheckCircle2
                        size={14}
                        className="shrink-0 text-[#D4A237]"
                      />
                    )}
                  </span>
                  {metaLine && (
                    <span className="text-[11px] leading-tight text-[#52525B]">
                      {metaLine}
                    </span>
                  )}
                  {hasProgress && (
                    <span className="block h-[3px] overflow-hidden rounded-sm bg-white/[0.12]">
                      <span
                        className="block h-full rounded-sm bg-[#D4A237]"
                        style={{
                          width: `${Math.min(100, prog!.percent * 100)}%`,
                        }}
                      />
                    </span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
