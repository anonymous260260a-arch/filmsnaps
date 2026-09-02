/**
 * History page — list of recently watched items with progress bars and resume buttons.
 */

"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Play, Trash2, ArrowLeft } from "lucide-react";
import { Header } from "@/components/Header";
import { PageShell } from "@/components/PageShell";
import { MediaLink } from "@/components/MediaLink";
import { useCachedWatchHistory } from "@/hooks/useCachedWatchHistory";
import type { WatchProgress } from "@filmsnaps/shared";
import { useAppMode } from "@/lib/useAppMode";
import { getImageUrl, tmdbApi } from "@/lib/tmdb";

/** Minimal TMDB fields the history rows need (mirrors ContinueWatching). */
interface EntryMeta {
  title: string;
  posterPath: string | null;
}

function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export default function HistoryPage() {
  const { aggregated, loading, clearAll, removeEntry, refresh } =
    useCachedWatchHistory();
  const { mode } = useAppMode();
  const [grouped, setGrouped] = useState<WatchProgress[]>([]);
  const [metaMap, setMetaMap] = useState<Record<string, EntryMeta>>({});

  // `aggregated` collapses a show's episodes into ONE card (latest wins), then
  // scope by the Hard Mode Split (anime vs movie_tv). In-progress items (CW)
  // sort first so the history page doubles as the CW surface.
  useEffect(() => {
    const scoped = aggregated
      .map((a) => a.latest)
      .filter((e) => (mode === "anime" ? !!e.isAnime : !e.isAnime));
    scoped.sort((a, b) => {
      const aCw = !a.completed && a.currentTime > 10 ? 0 : 1;
      const bCw = !b.completed && b.currentTime > 10 ? 0 : 1;
      if (aCw !== bCw) return aCw - bCw;
      return b.updatedAt - a.updatedAt;
    });
    setGrouped(scoped);
  }, [aggregated, mode]);

  // Enrich rows with TMDB title + poster (same lookup the CW rail does) —
  // WatchProgress stores only tmdbId, so without this the rows render a
  // placeholder box and "TV Show S1 E2" instead of the real name/poster.
  useEffect(() => {
    let cancelled = false;
    for (const entry of grouped) {
      const key = `${entry.mediaType}:${entry.tmdbId}`;
      if (metaMap[key]) continue;
      const fetchMeta =
        entry.mediaType === "tv"
          ? tmdbApi.getTVDetails(entry.tmdbId)
          : tmdbApi.getMovieDetails(entry.tmdbId);
      fetchMeta
        .then((m: any) => {
          if (cancelled || !m) return;
          setMetaMap((prev) => ({
            ...prev,
            [key]: {
              title: m.name || m.title || "",
              posterPath: m.poster_path ?? null,
            },
          }));
        })
        .catch(() => {
          /* meta is cosmetic — placeholder covers it */
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouped]);

  return (
    <div className="min-h-screen bg-[#070708] text-foreground">
      <Header />
      <PageShell maxWidth="4xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1
              className="text-2xl sm:text-3xl font-bold tracking-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Watch History
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {grouped.length} {grouped.length === 1 ? "entry" : "entries"}
            </p>
          </div>
          {aggregated.length > 0 && (
            <button
              onClick={clearAll}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#E05252]/10 text-[#E05252] hover:bg-[#E05252]/20 text-sm font-medium transition-all"
            >
              <Trash2 size={14} />
              Clear All
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-center py-16 text-muted-foreground">
            Loading...
          </div>
        ) : grouped.length === 0 ? (
          <div className="text-center py-16">
            <Play className="w-12 h-12 mx-auto mb-4 text-faint" />
            <p className="text-lg font-medium text-muted-foreground">
              No watch history yet
            </p>
            <p className="text-sm text-faint mt-1">
              Start watching something to see it here
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 rounded-xl bg-[#D4A237] text-[#070708] text-sm font-semibold hover:bg-[#B88B2A] transition-all"
            >
              Browse Movies
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {grouped.map((entry, i) => {
              const metaKey = `${entry.mediaType}:${entry.tmdbId}`;
              const meta = metaMap[metaKey];
              const posterSrc = meta?.posterPath
                ? getImageUrl(meta.posterPath, "w92")
                : null;
              const title =
                meta?.title ||
                (entry.mediaType === "tv"
                  ? `TV Show ${entry.season ? `S${entry.season}` : ""} ${
                      entry.episode ? `E${entry.episode}` : ""
                    }`.trim()
                  : "Movie");
              return (
                <div
                  key={`${entry.tmdbId}-${i}`}
                  className="flex items-center gap-4 p-4 rounded-xl bg-[#0E0E11] border border-[#222226] hover:border-[#D4A237]/20 transition-all group"
                >
                  {/* Poster */}
                  <div className="w-14 h-20 rounded-lg bg-gradient-to-br from-[#16161A] to-[#0E0E11] flex-shrink-0 overflow-hidden ring-1 ring-white/[0.06]">
                    {posterSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={posterSrc}
                        alt={title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full bg-[#222226]" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {entry.percent > 0
                        ? `${Math.round(entry.percent * 100)}% • ${formatTime(entry.currentTime)} of ${formatTime(entry.duration)}`
                        : "Not started"}
                    </p>
                    <p className="text-[11px] text-faint mt-0.5">
                      {new Date(entry.updatedAt).toLocaleDateString()}
                    </p>
                    {/* Progress bar */}
                    <div className="mt-1.5 h-[3px] bg-[#222226] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#5B9CF6] rounded-full"
                        style={{
                          width: `${Math.min(entry.percent * 100, 100)}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <MediaLink
                      id={entry.tmdbId}
                      type={entry.mediaType === "tv" ? "tv" : "movie"}
                      href={
                        entry.mediaType === "tv"
                          ? `/watch?type=tv&id=${entry.tmdbId}&season=${entry.season ?? 1}&episode=${entry.episode ?? 1}`
                          : `/watch?type=movie&id=${entry.tmdbId}`
                      }
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D4A237]/10 text-[#D4A237] hover:bg-[#D4A237]/20 text-xs font-semibold transition-all"
                    >
                      <Play size={12} />
                      Resume
                    </MediaLink>
                    <button
                      onClick={() =>
                        removeEntry(
                          entry.tmdbId,
                          entry.mediaType,
                          entry.season,
                          entry.episode,
                        )
                      }
                      className="p-1.5 rounded-lg text-faint hover:text-[#E05252] hover:bg-[#E05252]/10 transition-all"
                      aria-label="Remove entry"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PageShell>
    </div>
  );
}
