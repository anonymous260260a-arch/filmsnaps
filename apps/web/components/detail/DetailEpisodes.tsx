"use client";

/**
 * DetailEpisodes — season pills + episode list on the TV detail page
 * (phone). Web port of the mobile app's SeasonPicker (apps/mobile/
 * components/SeasonPicker.tsx): "Episodes" heading, scrollable season
 * chips (gold solid when active), then bordered episode cards with a
 * 16:9 still, E-number + title, meta line and watch-progress bar.
 * Each card navigates to the watch route for that season/episode.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Film, Loader2 } from "lucide-react";
import { tmdbApi, getImageUrl } from "@/lib/tmdb";
import { useCachedWatchHistory } from "@/hooks/useCachedWatchHistory";

interface SeasonOption {
  id?: number;
  season_number: number;
  episode_count?: number;
  name?: string;
}

interface EpisodeItem {
  id: number;
  episode_number: number;
  name?: string;
  still_path?: string | null;
  runtime?: number;
  air_date?: string;
}

interface DetailEpisodesProps {
  tmdbId: string | number;
  seasons: SeasonOption[];
  /** Season to preselect (e.g. the resume point's season) — ignored after the user taps a pill. */
  initialSeason?: number | null;
  /** Extra query string to carry onto watch links (anime mid/aid). */
  extraQuery?: string;
}

export function DetailEpisodes({
  tmdbId,
  seasons,
  initialSeason,
  extraQuery = "",
}: DetailEpisodesProps) {
  const router = useRouter();
  const { entries } = useCachedWatchHistory();

  const options = useMemo(
    () =>
      seasons.filter((s) => s.season_number > 0 && (s.episode_count ?? 0) > 0),
    [seasons],
  );

  const [season, setSeason] = useState<number>(() => {
    const first = options[0]?.season_number ?? 1;
    return initialSeason &&
      options.some((s) => s.season_number === initialSeason)
      ? initialSeason
      : first;
  });
  const touchedRef = useRef(false);

  // Resume resolves async on the detail page — adopt it as the initial
  // season until the user picks one themselves.
  useEffect(() => {
    if (!initialSeason || touchedRef.current) return;
    if (options.some((s) => s.season_number === initialSeason)) {
      setSeason(initialSeason);
    }
  }, [initialSeason, options]);

  const { data, isPending, isError } = useQuery({
    queryKey: ["tv-season", String(tmdbId), season],
    queryFn: () => tmdbApi.getSeason(tmdbId, season),
    staleTime: 1000 * 60 * 60 * 24 * 7,
  });

  const episodes: EpisodeItem[] = data?.episodes ?? [];

  // Per-episode watch progress for the displayed season (mobile parity).
  const progressByEpisode = useMemo(() => {
    const map = new Map<
      number,
      { percent: number; completed: boolean; currentTime: number }
    >();
    const id = String(tmdbId);
    for (const e of entries) {
      if (e.mediaType !== "tv" || e.tmdbId !== id) continue;
      if (e.season !== season || e.episode == null) continue;
      map.set(e.episode, {
        percent: e.percent,
        completed: e.completed,
        currentTime: e.currentTime,
      });
    }
    return map;
  }, [entries, tmdbId, season]);

  if (options.length === 0) return null;

  return (
    <div className="mt-6">
      <h2 className="mb-3 text-[15px] font-semibold text-foreground">
        Episodes
      </h2>

      {/* Season pills — horizontal scroll */}
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {options.map((s) => {
          const active = s.season_number === season;
          return (
            <button
              key={s.id ?? s.season_number}
              type="button"
              onClick={() => {
                touchedRef.current = true;
                setSeason(s.season_number);
              }}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-[7px] text-xs font-bold transition-colors ${
                active
                  ? "border-[#D4A237] bg-[#D4A237] text-[#070708]"
                  : "border-white/[0.06] bg-[#0E0E11]/75 text-zinc-400 hover:border-white/[0.14] hover:text-zinc-200"
              }`}
            >
              {s.name || `Season ${s.season_number}`}
            </button>
          );
        })}
      </div>

      {/* Episode list */}
      {isPending ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8">
          <Loader2 size={22} className="animate-spin text-[#D4A237]" />
          <span className="text-xs text-[#A1A1AA]">Loading episodes…</span>
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8">
          <Film size={22} className="text-[#52525B]" />
          <span className="text-xs text-[#52525B]">
            Couldn&apos;t load episodes
          </span>
        </div>
      ) : episodes.length > 0 ? (
        <div className="space-y-2">
          {episodes.map((ep) => {
            const epNum = ep.episode_number;
            const prog = progressByEpisode.get(epNum);
            const hasProgress =
              !!prog && !prog.completed && prog.percent > 0.05;
            const isCompleted = !!prog?.completed;
            const metaLine = [
              ep.runtime ? `${ep.runtime}m` : null,
              ep.air_date ?? null,
            ]
              .filter(Boolean)
              .join(" · ");

            const seek =
              hasProgress && prog!.currentTime > 0
                ? `&t=${Math.floor(prog!.currentTime)}`
                : "";
            const anime = extraQuery ? `&${extraQuery}` : "";

            return (
              <button
                key={ep.id}
                type="button"
                onClick={() =>
                  router.push(
                    `/watch?type=tv&id=${tmdbId}&season=${season}&episode=${epNum}${seek}${anime}`,
                  )
                }
                className="flex min-h-[76px] w-full items-center rounded-[14px] border border-white/[0.06] bg-[#0E0E11]/45 p-2 text-left transition-colors hover:border-white/[0.14] hover:bg-white/[0.03] active:scale-[0.99]"
              >
                {/* 16:9 thumb */}
                <div className="relative mr-2.5 h-[54px] w-24 shrink-0 overflow-hidden rounded-lg bg-[#222226]">
                  {ep.still_path && (
                    <img
                      src={getImageUrl(ep.still_path, "w300")}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
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
                    <span className="shrink-0 text-[11.5px] font-extrabold tabular-nums tracking-[0.06em] text-[#D4A237]">
                      EPISODE {epNum}
                    </span>
                    {isCompleted && (
                      <span className="ml-auto shrink-0 text-[11px] font-medium text-[#22c55e]">
                        Watched
                      </span>
                    )}
                  </span>
                  <span className="truncate text-[13px] font-semibold text-zinc-100">
                    {ep.name || `Episode ${epNum}`}
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
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 py-8">
          <Film size={22} className="text-[#52525B]" />
          <span className="text-xs text-[#52525B]">No episodes found</span>
        </div>
      )}
    </div>
  );
}
