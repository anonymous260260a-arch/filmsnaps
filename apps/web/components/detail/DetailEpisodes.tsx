"use client";

/**
 * DetailEpisodes — season pills + episode list on the TV detail page.
 * Web port of the mobile app's SeasonPicker (apps/mobile/
 * components/SeasonPicker.tsx): "Episodes" heading, scrollable season
 * chips (gold solid when active), then bordered episode cards — 16:9
 * still with the watch-progress bar overlaid on the THUMBNAIL (mobile
 * parity), EPISODE-n + title + runtime hierarchy, collapse at 8 rows.
 * Each card navigates to the watch route for that season/episode.
 *
 * NOTE: mount exactly ONE instance per page. The watch-history cache
 * (useCachedWatchHistory) notifies per render and holds a single module
 * snapshot — two mounted instances ping-pong snapshots against each other
 * and blow React's update-depth limit (observed as a full-page freeze).
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Film, Loader2, Tv } from "lucide-react";
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

/** Collapse the list past this many rows (mobile SeasonPicker parity). */
const COLLAPSE_THRESHOLD = 8;

/** Mobile formatRuntime — "1h 05m" style, empty string for ≤0. */
function formatRuntime(minutes?: number): string {
  if (!minutes || minutes < 1) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
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
  const [expanded, setExpanded] = useState(false);

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

  const displayEpisodes = expanded
    ? episodes
    : episodes.slice(0, COLLAPSE_THRESHOLD);
  const showExpandButton = episodes.length > COLLAPSE_THRESHOLD;

  return (
    <div className="mt-6">
      <h2 className="mb-3 text-[15px] font-semibold text-foreground sm:text-sm sm:font-semibold sm:uppercase sm:tracking-[0.15em] sm:text-muted-foreground/60">
        Episodes
      </h2>

      {/* Season pills — horizontal scroll */}
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0">
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
                  ? "border-primary bg-primary text-background"
                  : "border-white/[0.06] bg-surface/75 text-muted-foreground hover:border-white/[0.14] hover:text-foreground"
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
          <Loader2 size={22} className="animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">
            Loading episodes…
          </span>
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8">
          <Film size={22} className="text-faint" />
          <span className="text-xs text-faint">
            Couldn&apos;t load episodes
          </span>
        </div>
      ) : displayEpisodes.length > 0 ? (
        <div className="space-y-2">
          {displayEpisodes.map((ep) => {
            const epNum = ep.episode_number;
            const prog = progressByEpisode.get(epNum);
            const hasProgress = !!prog && prog.percent > 0;
            const metaLine = formatRuntime(ep.runtime) || ep.air_date || "";

            // Mobile parity: fall back to the show backdrop when an episode
            // has no still of its own.
            const stillUrl = ep.still_path
              ? getImageUrl(ep.still_path, "w300")
              : null;

            const seek =
              prog && prog.percent < 0.95 && prog.currentTime > 0
                ? `&t=${Math.floor(prog.currentTime)}`
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
                className="flex min-h-[66px] w-full items-center rounded-[12px] border border-white/[0.06] bg-surface/45 p-2 text-left transition-colors hover:border-white/[0.14] hover:bg-white/[0.03] active:scale-[0.99] sm:min-h-[106px] sm:p-2.5"
              >
                {/* 16:9 thumb — progress bar overlaid at its bottom edge
                    (mobile parity), show-backdrop fallback */}
                <div className="relative h-[50px] w-[88px] shrink-0 overflow-hidden rounded-lg bg-subtle sm:h-[90px] sm:w-[160px]">
                  {stillUrl ? (
                    <img
                      src={stillUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center">
                      <Tv size={16} className="text-faint" />
                    </span>
                  )}
                  {hasProgress && (
                    <span className="absolute inset-x-0 bottom-0 block h-[3px] bg-black/60">
                      <span
                        className={`block h-full ${
                          prog!.percent >= 0.95 ? "bg-success" : "bg-primary"
                        }`}
                        style={{
                          width: `${Math.min(100, prog!.percent * 100)}%`,
                        }}
                      />
                    </span>
                  )}
                </div>

                {/* Text block — EPISODE n · title · runtime hierarchy */}
                <span className="ml-3 flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="shrink-0 text-[10px] font-semibold tracking-[0.5px] text-primary sm:text-[11px]">
                    EPISODE {epNum}
                  </span>
                  <span className="truncate text-[13px] font-semibold text-foreground">
                    {ep.name || `Episode ${epNum}`}
                  </span>
                  {metaLine && (
                    <span className="text-[11px] leading-tight text-faint">
                      {metaLine}
                    </span>
                  )}
                </span>
              </button>
            );
          })}

          {showExpandButton && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mx-auto flex items-center gap-1.5 py-1 text-xs font-semibold text-primary hover:underline"
            >
              {expanded ? (
                <>
                  Show less
                  <ChevronUp size={13} />
                </>
              ) : (
                <>
                  Show all {episodes.length} episodes
                  <ChevronDown size={13} />
                </>
              )}
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 py-8">
          <Film size={22} className="text-faint" />
          <span className="text-xs text-faint">No episodes found</span>
        </div>
      )}
    </div>
  );
}
