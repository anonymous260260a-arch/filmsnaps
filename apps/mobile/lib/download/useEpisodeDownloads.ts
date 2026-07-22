/**
 * Hook: useEpisodeDownloads — TV season batch download management.
 *
 * Tracks all downloads for a given show/season and provides aggregate
 * progress plus batch operations (startAll, pauseAll, cancelAll).
 * Like YouTube's "Download Season" feature.
 */

import { useCallback, useMemo } from 'react';
import { useSyncExternalStore } from 'react';
import { useDownloadInfra } from './context';
import type { DownloadMeta, DownloadTask, AggregateProgress } from './types';

export interface UseEpisodeDownloadsReturn {
  episodes: DownloadTask[];
  aggregate: AggregateProgress;
  startEpisode: (meta: DownloadMeta) => Promise<string>;
  startAll: () => Promise<void>;
  pauseAll: () => Promise<void>;
  cancelAll: () => Promise<void>;
  resumeAll: () => Promise<void>;
}

export function useEpisodeDownloads(
  tmdbId: string,
  season?: number,
): UseEpisodeDownloadsReturn {
  const { store, engine } = useDownloadInfra();

  const episodes = useSyncExternalStore(
    (cb) => store.subscribe(() => cb()),
    () => store.getBySeason?.(tmdbId, season ?? 0)
      ?? store.getAll().filter(
          (t) => t.tmdbId === tmdbId && (season === undefined || t.season === season),
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
      if (ep.status === 'downloading') activeCount++;
      if (ep.status === 'completed') completedCount++;
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

  const generateId = useCallback(() => {
    return `dl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }, []);

  const startEpisode = useCallback(async (meta: DownloadMeta): Promise<string> => {
    const id = generateId();
    const task: DownloadTask = {
      ...meta,
      id,
      fileUri: null,
      totalBytes: 0,
      receivedBytes: 0,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await store.upsert(task);
    engine.start(task);
    return id;
  }, [store, engine, generateId]);

  const startAll = useCallback(async () => {
    for (const ep of episodes) {
      if (ep.status === 'completed' || ep.status === 'downloading') continue;
      const reset: DownloadTask = { ...ep, status: 'pending', error: undefined };
      await store.upsert(reset);
      engine.start(reset);
    }
  }, [episodes, store, engine]);

  const pauseAll = useCallback(async () => {
    for (const ep of episodes) {
      if (ep.status !== 'downloading') continue;
      const resumeData = await engine.pause(ep.id);
      if (resumeData) {
        await store.upsert({ ...ep, status: 'paused', resumeData });
      }
    }
  }, [episodes, store, engine]);

  const cancelAll = useCallback(async () => {
    for (const ep of episodes) {
      await store.upsert({ ...ep, status: 'cancelled' });
      await engine.cancel(ep.id);
    }
  }, [episodes, store, engine]);

  const resumeAll = useCallback(async () => {
    for (const ep of episodes) {
      if (ep.status !== 'paused') continue;
      engine.start(ep);
    }
  }, [episodes, engine]);

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
