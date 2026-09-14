/**
 * ContinueWatchingWrapper — client component that reads watch history
 * and renders the ContinueWatching rail.
 */

"use client";

import React, { useEffect, useRef, useState } from "react";
import { createLocalStorageAdapter } from "@filmsnaps/shared";
import { useWatchHistory } from "@filmsnaps/shared";
import { ContinueWatching } from "@/components/ContinueWatching";
import { prefetchDirectMedia } from "@/lib/directPrefetch";
import type { WatchProgress } from "@filmsnaps/shared";
import { useAppMode } from "@/lib/useAppMode";

const storage = createLocalStorageAdapter();

export function ContinueWatchingWrapper() {
  const { aggregated, loading, refresh } = useWatchHistory(storage);
  const { mode } = useAppMode();
  const [inProgress, setInProgress] = useState<WatchProgress[]>([]);

  // Recompute the visible rail whenever the underlying history changes.
  useEffect(() => {
    // `aggregated` already collapses every TV episode of a show into ONE card
    // (latest episode wins, mirroring mobile's getAggregatedHistory). Then scope
    // by the Hard Mode Split: anime mode shows only anime entries, movie_tv mode
    // shows only non-anime entries.
    const filtered = aggregated
      .map((a) => a.latest)
      .filter((e) => !e.completed && e.currentTime > 10)
      .filter((e) => (mode === "anime" ? !!e.isAnime : !e.isAnime))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    setInProgress(filtered);
  }, [aggregated, mode]);

  // Refocus refresh: when the user returns to the tab, re-read history so
  // recently-saved progress (e.g. from a concurrent window) is reflected.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  // ── Home-mount prefetch (mobile parity) ──
  // Once per session, 3s after the rail appears, warm the direct metadata +
  // top-source probes for the first 3 continue-watching titles (TV entries
  // use their stored season/episode — the episode the user will resume).
  const homePrefetchDoneRef = useRef(false);
  useEffect(() => {
    if (homePrefetchDoneRef.current) return;
    if (typeof window === "undefined") return;
    if ((window as any).electronAPI?.isDesktop !== true) return;
    if (inProgress.length === 0) return;
    homePrefetchDoneRef.current = true;
    const timer = setTimeout(() => {
      inProgress
        .slice(0, 3)
        .forEach((e) =>
          prefetchDirectMedia(
            e.mediaType === "tv" ? "tv" : "movie",
            String(e.tmdbId),
            e.season ?? undefined,
            e.episode ?? undefined,
          ),
        );
    }, 3000);
    return () => clearTimeout(timer);
  }, [inProgress]);

  if (loading || inProgress.length === 0) return null;

  return <ContinueWatching entries={inProgress} />;
}
