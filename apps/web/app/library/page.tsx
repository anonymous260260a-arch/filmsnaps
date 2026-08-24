/**
 * Library — aggregated personal-content surface.
 *
 * Desktop parity with mobile's `library.tsx`: one screen that combines
 * Continue Watching + Saved + Watch History + Downloads.
 *
 * Reuses the existing web building blocks rather than rebuilding them:
 *  - `useWatchHistory` (packages/shared) for progress + history
 *  - `useWatchlist` (apps/web/hooks) for saved items
 *  - `ContinueWatching` rail and `MovieCard` (variant="saved")
 *
 * The Downloads section is a placeholder until Phase 2 (media Download
 * Manager) lands — it shows an empty state so the section exists and
 * can be wired up without further layout changes.
 */

"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bookmark,
  Clock,
  Download,
  Film,
  Library as LibraryIcon,
  Play,
  RefreshCw,
} from "lucide-react";
import { createLocalStorageAdapter } from "@filmsnaps/shared";
import { useWatchHistory, type WatchProgress } from "@filmsnaps/shared";
import { useWatchlist } from "@/hooks/useWatchlist";
import { Header } from "@/components/Header";
import { PageShell } from "@/components/PageShell";
import { ContinueWatching } from "@/components/ContinueWatching";
import { MovieCard } from "@/components/MovieCard";
import { SectionHeader as SharedSectionHeader } from "@/components/ui/SectionHeader";

const storage = createLocalStorageAdapter();

function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return "<1m";
}

export default function LibraryPage() {
  const {
    entries,
    loading: historyLoading,
    refresh,
  } = useWatchHistory(storage);
  const { savedMovies, loading: savedLoading, removeMovie } = useWatchlist();

  const [inProgress, setInProgress] = useState<WatchProgress[]>([]);
  const [recentHistory, setRecentHistory] = useState<WatchProgress[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Percent map: tmdbId → latest non-completed progress (movie or TV best effort).
  const progressByTmdb = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      if (e.completed) continue;
      const existing = map.get(e.tmdbId);
      if (existing === undefined || e.percent > existing) {
        map.set(e.tmdbId, e.percent);
      }
    }
    return map;
  }, [entries]);

  // Continue Watching = in-progress, non-completed items with real progress.
  useEffect(() => {
    const filtered = entries.filter((e) => !e.completed && e.currentTime > 10);
    setInProgress(filtered);
  }, [entries]);

  // Recent history = latest entry per TMDB id (+ season for TV).
  useEffect(() => {
    const seen = new Set<string>();
    const result: WatchProgress[] = [];
    for (const entry of entries) {
      const key =
        entry.mediaType === "tv"
          ? `${entry.tmdbId}-s${entry.season}`
          : `movie-${entry.tmdbId}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(entry);
      }
    }
    setRecentHistory(result.slice(0, 5));
  }, [entries]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
      // useWatchlist re-reads from localStorage on the cross-tab storage
      // event; nudge it so a manual refresh also updates saved items.
      if (typeof StorageEvent !== "undefined") {
        window.dispatchEvent(
          new StorageEvent("storage", { key: "filmsnaps-watchlist" }),
        );
      }
    } finally {
      setTimeout(() => setRefreshing(false), 400);
    }
  }, [refresh]);

  // Refocus refresh: re-read history + watchlist when the tab regains focus so
  // progress saved from another window (or a resumed playback session) paints
  // without a manual click.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") handleRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [handleRefresh]);

  const loading = historyLoading || savedLoading;

  return (
    <div className="min-h-screen bg-[#070708] text-foreground">
      <Header />
      <PageShell maxWidth="5xl">
        {/* Page header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#D4A237]/10 flex items-center justify-center">
              <LibraryIcon size={20} className="text-[#D4A237]" />
            </div>
            <div>
              <h1
                className="text-2xl sm:text-3xl font-bold tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Library
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Your watchlist, progress and downloads in one place
              </p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh library"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06] text-muted-foreground hover:text-foreground hover:bg-white/[0.07] text-sm font-medium transition-all disabled:opacity-60"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="space-y-8">
            {[0, 1, 2].map((s) => (
              <div key={s} className="space-y-3">
                <div className="h-5 w-40 rounded bg-[#16161A] animate-pulse" />
                <div className="flex gap-3 overflow-hidden">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="w-28 aspect-[2/3] rounded-xl bg-[#16161A] animate-pulse shrink-0"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-10">
            {/* ── Continue Watching ── */}
            {inProgress.length > 0 && <ContinueWatching entries={inProgress} />}

            {/* ── Saved ── */}
            <section>
              <SharedSectionHeader
                icon={<Bookmark size={18} className="text-[#D4A237]" />}
                title="Saved"
                count={savedMovies.length}
                seeAllHref="/saved"
              />
              {savedMovies.length === 0 ? (
                <EmptySection
                  icon={<Bookmark className="h-8 w-8 text-faint" />}
                  title="Nothing saved yet"
                  body="Save movies and shows to build your watchlist."
                  ctaHref="/movie"
                  ctaLabel="Browse Movies"
                />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-5 lg:gap-6">
                  {savedMovies.map((movie) => (
                    <MovieCard
                      key={movie.id}
                      item={movie}
                      variant="saved"
                      onRemove={removeMovie}
                      progress={progressByTmdb.get(String(movie.id))}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* ── Watch History ── */}
            <section>
              <SharedSectionHeader
                icon={<Clock size={18} className="text-[#D4A237]" />}
                title="Watch History"
                count={recentHistory.length}
                seeAllHref="/history"
              />
              {recentHistory.length === 0 ? (
                <EmptySection
                  icon={<Clock className="h-8 w-8 text-faint" />}
                  title="No watch history yet"
                  body="Start watching something to see it here."
                  ctaHref="/"
                  ctaLabel="Browse Movies"
                />
              ) : (
                <div className="space-y-2">
                  {recentHistory.map((entry, i) => (
                    <HistoryRow key={`${entry.tmdbId}-${i}`} entry={entry} />
                  ))}
                </div>
              )}
            </section>

            {/* ── Downloads (placeholder until Phase 2) ── */}
            <section>
              <SharedSectionHeader
                icon={<Download size={18} className="text-[#D4A237]" />}
                title="Downloads"
                count={0}
                seeAllHref="/downloads"
              />
              <EmptySection
                icon={<Download className="h-8 w-8 text-faint" />}
                title="No downloads yet"
                body="Download movies and episodes to watch offline."
                ctaHref="/movie"
                ctaLabel="Find something to watch"
              />
            </section>
          </div>
        )}
      </PageShell>
    </div>
  );
}

/* ── Section helpers ───────────────────────────────────────────── */

function EmptySection({
  icon,
  title,
  body,
  ctaHref,
  ctaLabel,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0E0E11] px-6 py-10 text-center">
      <div className="w-16 h-16 rounded-full bg-[#16161A] flex items-center justify-center mx-auto mb-4">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-5 max-w-sm mx-auto">
        {body}
      </p>
      <Link
        href={ctaHref}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#D4A237] text-[#070708] text-sm font-semibold hover:bg-[#B88B2A] transition-all"
      >
        <Film size={14} />
        {ctaLabel}
      </Link>
    </div>
  );
}

function HistoryRow({ entry }: { entry: WatchProgress }) {
  const title =
    entry.mediaType === "tv"
      ? `TV Show ${entry.season ? `S${entry.season}` : ""} ${
          entry.episode ? `E${entry.episode}` : ""
        }`.trim()
      : "Movie";
  const pct = Math.min(entry.percent * 100, 100);

  return (
    <Link
      href={
        entry.mediaType === "tv"
          ? `/watch/tv/${entry.tmdbId}?season=${entry.season ?? 1}&episode=${
              entry.episode ?? 1
            }`
          : `/watch/movie/${entry.tmdbId}`
      }
      className="flex items-center gap-4 p-4 rounded-xl bg-[#0E0E11] border border-[#222226] hover:border-[#D4A237]/20 transition-all group"
    >
      <div className="w-12 h-[72px] rounded-lg bg-gradient-to-br from-[#16161A] to-[#0E0E11] flex-shrink-0 overflow-hidden ring-1 ring-white/[0.06] flex items-center justify-center">
        <Play className="w-5 h-5 text-[#D4A237]/40" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {entry.percent > 0
            ? `${Math.round(pct)}% • ${formatTime(entry.currentTime)} watched`
            : "Not started"}
        </p>
        <div className="mt-1.5 h-[3px] bg-[#222226] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#5B9CF6] rounded-full"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span className="text-xs text-faint shrink-0 hidden sm:block">
        {new Date(entry.updatedAt).toLocaleDateString()}
      </span>
    </Link>
  );
}
