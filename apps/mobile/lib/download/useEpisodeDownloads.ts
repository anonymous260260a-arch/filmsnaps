/**
 * Hook: useEpisodeDownloads — TV season batch download management.
 *
 * Tracks all downloads for a given show/season and provides aggregate
 * progress plus batch operations (startAll, pauseAll, cancelAll).
 * Uses the shared enqueue function for deduplication and the manager
 * for pause/cancel/resume operations.
 */

import { useMemo, useCallback } from "react";
import { useDownloadInfra } from "./context";
import type { DownloadTask, AggregateProgress } from "./types";

export interface UseEpisodeDownloadsReturn {
  episodes: DownloadTask[];
  progress: AggregateProgress;
  allCompleted: boolean;
  anyActive: boolean;
  anyPaused: boolean;
  anyFailed: boolean;
  // Batch actions
  pauseAll: () => Promise<void>;
  resumeAll: () => Promise<void>;
  cancelAll: () => Promise<void>;
  retryFailed: () => Promise<void>;
  removeAll: () => Promise<void>;
}

export function useEpisodeDownloads(
  tmdbId: string,
  season: number,
): UseEpisodeDownloadsReturn {
  const { store, manager, control } = useDownloadInfra();

  const episodes = useMemo(() => {
    return store.getBySeason(tmdbId, season).sort((a, b) => {
      return (a.episode ?? 0) - (b.episode ?? 0);
    });
  }, [store, tmdbId, season]);

  const progress = useMemo<AggregateProgress>(() => {
    const totalBytes = episodes.reduce(
      (sum, e) => sum + (e.totalBytes || 0),
      0,
    );
    const receivedBytes = episodes.reduce(
      (sum, e) => sum + (e.receivedBytes || 0),
      0,
    );
    const activeCount = episodes.filter(
      (e) => e.status === "downloading" || e.status === "retrying",
    ).length;
    const completedCount = episodes.filter(
      (e) => e.status === "completed",
    ).length;

    return {
      totalBytes,
      receivedBytes,
      fraction: totalBytes > 0 ? receivedBytes / totalBytes : 0,
      activeCount,
      totalCount: episodes.length,
      completedCount,
    };
  }, [episodes]);

  const allCompleted =
    episodes.length > 0 && episodes.every((e) => e.status === "completed");
  const anyActive = episodes.some(
    (e) => e.status === "downloading" || e.status === "retrying",
  );
  const anyPaused = episodes.some((e) => e.status === "paused");
  const anyFailed = episodes.some((e) => e.status === "failed");

  const ids = useMemo(() => episodes.map((e) => e.id), [episodes]);

  const pauseAll = useCallback(() => control("pause", ids), [control, ids]);
  const resumeAll = useCallback(() => control("resume", ids), [control, ids]);
  const cancelAll = useCallback(() => control("cancel", ids), [control, ids]);
  const removeAll = useCallback(() => control("remove", ids), [control, ids]);

  const retryFailed = useCallback(async () => {
    const failed = episodes.filter((e) => e.status === "failed");
    for (const ep of failed) {
      await manager.retry(ep.id);
    }
  }, [episodes, manager]);

  return {
    episodes,
    progress,
    allCompleted,
    anyActive,
    anyPaused,
    anyFailed,
    pauseAll,
    resumeAll,
    cancelAll,
    retryFailed,
    removeAll,
  };
}
