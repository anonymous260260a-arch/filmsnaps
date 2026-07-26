/**
 * Hook: useEpisodeDownloads — TV season batch download management.
 *
 * Tracks all downloads for a given show/season and provides aggregate
 * progress plus batch operations (startAll, pauseAll, cancelAll).
 * Uses the shared enqueue function for deduplication and the manager
 * for pause/cancel/resume operations.
 */

import { useCallback, useMemo } from "react";
import { useSyncExternalStore } from "react";
import { useDownloadInfra } from "./context";
import type { DownloadMeta, DownloadTask, AggregateProgress } from "./types";

export interface UseEpisodeDownloadsReturn {
  episodes: DownloadTask[];
  aggregate: AggregateProgress;
  startEpisode: (meta: DownloadMeta) => string;
  startAll: () => void;
  pauseAll: () => Promise<void>;
  cancelAll: () => Promise<void>;
  resumeAll: () => void;
}

export function useEpisodeDownloads(
  tmdbId: string,
  season?: number,
): UseEpisodeDownloadsReturn {
  const { store, manager, enqueue } = useDownloadInfra();

  const episodes = useSyncExternalStore(
    (cb) => store.subscribe(() => cb()),
    () =>
      store.getBySeason?.(tmdbId, season ?? 0) ??
      store
        .getAll()
        .filter(
          (t) =>
            t.tmdbId === tmdbId &&
            (season === undefined || t.season === season),
        ),
  );

  const aggregate = useMemo<AggregateProgress>(() => {
    let totalBytes = 0;
    let receivedBytes = 0;
    let activeCount = 0;
    let completedCount = 0;
    const totalCount = episodes.length;

    for (const ep of episodes) {
      totalBytes += ep.totalBytes;
      receivedBytes += ep.receivedBytes;
      if (ep.status === "downloading") activeCount++;
      if (ep.status === "completed") completedCount++;
    }

    return {
      totalBytes,
      receivedBytes,
      fraction: totalBytes > 0 ? receivedBytes / totalBytes : 0,
      activeCount,
      totalCount,
      completedCount,
    };
  }, [episodes]);

  // Use shared enqueue for deduplication
  const startEpisode = useCallback(
    (meta: DownloadMeta): string => {
      return enqueue(meta);
    },
    [enqueue],
  );

  // Start all pending/failed/cancelled episodes
  const startAll = useCallback(() => {
    for (const ep of episodes) {
      if (
        ep.status === "completed" ||
        ep.status === "downloading" ||
        ep.status === "pending"
      )
        continue;
      enqueue({
        url: ep.url,
        fileName: ep.fileName,
        server: ep.server,
        mediaType: ep.mediaType,
        tmdbId: ep.tmdbId,
        quality: ep.quality,
        title: ep.title,
        season: ep.season,
        episode: ep.episode,
        extension: ep.extension,
      });
    }
  }, [episodes, enqueue]);

  // Pause all downloading episodes
  const pauseAll = useCallback(async () => {
    for (const ep of episodes) {
      if (ep.status !== "downloading") continue;
      await manager.pause(ep.id);
    }
  }, [episodes, manager]);

  // Cancel all active episodes
  const cancelAll = useCallback(async () => {
    for (const ep of episodes) {
      if (
        ep.status !== "downloading" &&
        ep.status !== "pending" &&
        ep.status !== "paused"
      )
        continue;
      await manager.cancel(ep.id);
    }
  }, [episodes, manager]);

  // Resume all paused episodes
  const resumeAll = useCallback(() => {
    for (const ep of episodes) {
      if (ep.status !== "paused") continue;
      manager.resume(ep.id).catch((err) => {
        console.error("[useEpisodeDownloads] resume failed:", err);
      });
    }
  }, [episodes, manager]);

  return {
    episodes,
    aggregate,
    startEpisode,
    startAll,
    pauseAll,
    cancelAll,
    resumeAll,
  };
}
