"use client"
/**
 * Watch History hook — unified watch-progress tracking across platforms.
 *
 * Features:
 * - Save progress with dedup (never overwrite with lower progress)
 * - Auto-mark as completed at >= 95%
 * - Resume-point detection for both movies and TV shows
 * - Aggregated history grouped by TMDB id
 * - Cross-tab sync on web via storage events
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { StorageAdapter, WatchProgress, WatchHistoryMap } from './types';

const STORAGE_KEY = '@filmsnaps/watch-history';

export interface WatchHistoryState {
  /** All history entries, newest first */
  entries: WatchProgress[];
  /** Whether history is still loading */
  loading: boolean;
  /** Total number of entries */
  totalCount: number;
}

export interface WatchHistoryActions {
  /** Save or update progress for a single movie / TV episode */
  saveProgress: (progress: WatchProgress) => Promise<void>;
  /** Get saved progress for a specific movie / TV episode */
  getProgress: (
    tmdbId: string,
    mediaType: 'movie' | 'tv',
    season?: number,
    episode?: number,
  ) => Promise<WatchProgress | null>;
  /** Get the best resume point for a movie or TV show */
  getResumePoint: (
    tmdbId: string,
    mediaType: 'movie' | 'tv',
    currentSeason?: number,
    currentEpisode?: number,
  ) => Promise<WatchProgress | null>;
  /** Mark a movie or TV episode as fully watched */
  markCompleted: (
    tmdbId: string,
    mediaType: 'movie' | 'tv',
    season?: number,
    episode?: number,
  ) => Promise<void>;
  /** Remove a single progress entry */
  removeEntry: (
    tmdbId: string,
    mediaType: 'movie' | 'tv',
    season?: number,
    episode?: number,
  ) => Promise<void>;
  /** Clear all watch history */
  clearAll: () => Promise<void>;
  /** Refresh entries from storage */
  refresh: () => Promise<void>;
}

// ── Key helpers ───────────────────────────────────────────────────

export function buildStorageKey(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number,
): string {
  if (mediaType === 'tv' && season != null && episode != null) {
    return `tv:${tmdbId}:season:${season}:episode:${episode}`;
  }
  return `${mediaType}:${tmdbId}`;
}

// ── Hook ──────────────────────────────────────────────────────────

/**
 * Hook into watch history state.
 *
 * @param storage - A StorageAdapter instance
 */
export function useWatchHistory(storage: StorageAdapter): WatchHistoryState & WatchHistoryActions {
  const [entries, setEntries] = useState<WatchProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const cacheRef = useRef<WatchHistoryMap>({});

  // ── Load helpers ────────────────────────────────────────────────

  const loadMap = useCallback(async (): Promise<WatchHistoryMap> => {
    try {
      const raw = await storage.getItem(STORAGE_KEY);
      if (raw) {
        const map = JSON.parse(raw) as WatchHistoryMap;
        cacheRef.current = map;
        return map;
      }
    } catch {
      // Silently fail
    }
    cacheRef.current = {};
    return {};
  }, [storage]);

  const loadEntries = useCallback(async () => {
    const map = await loadMap();
    const list = Object.values(map)
      .filter((e) => e.currentTime > 0 || e.completed)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    setEntries(list);
    setLoading(false);
  }, [loadMap]);

  const persistMap = useCallback(
    async (map: WatchHistoryMap) => {
      try {
        await storage.setItem(STORAGE_KEY, JSON.stringify(map));
      } catch {
        // Silently fail
      }
    },
    [storage],
  );

  // ── Init ────────────────────────────────────────────────────────

  useEffect(() => {
    loadEntries();

    const unlisten = storage.addCrossTabListener?.((key) => {
      if (key === STORAGE_KEY) {
        loadEntries();
      }
    });

    return () => {
      unlisten?.();
    };
  }, [loadEntries, storage]);

  // ── Save progress ───────────────────────────────────────────────

  const saveProgress = useCallback(
    async (progress: WatchProgress) => {
      const key = buildStorageKey(
        progress.tmdbId,
        progress.mediaType,
        progress.season,
        progress.episode,
      );

      const map = cacheRef.current;

      // Only persist meaningful progress (>5s) or mark completed
      if (progress.currentTime <= 5 && !progress.completed) return;

      const existing = map[key];
      const isFinished = progress.percent >= 0.95 || progress.completed;

      // Don't overwrite with lower progress (e.g. switching providers mid-episode)
      if (existing && !isFinished && progress.percent < existing.percent) {
        return;
      }

      map[key] = {
        ...progress,
        completed: isFinished || (existing?.completed ?? false),
        updatedAt: Date.now(),
      };

      await persistMap(map);
      await loadEntries();
    },
    [persistMap, loadEntries],
  );

  // ── Get progress ────────────────────────────────────────────────

  const getProgress = useCallback(
    async (
      tmdbId: string,
      mediaType: 'movie' | 'tv',
      season?: number,
      episode?: number,
    ): Promise<WatchProgress | null> => {
      const key = buildStorageKey(tmdbId, mediaType, season, episode);
      const map = await loadMap();
      return map[key] ?? null;
    },
    [loadMap],
  );

  // ── Resume point ────────────────────────────────────────────────

  const getResumePoint = useCallback(
    async (
      tmdbId: string,
      mediaType: 'movie' | 'tv',
      currentSeason?: number,
      currentEpisode?: number,
    ): Promise<WatchProgress | null> => {
      const map = await loadMap();

      if (mediaType === 'movie') {
        const key = `movie:${tmdbId}`;
        const entry = map[key];
        if (entry && !entry.completed && entry.percent > 0.01) return entry;
        return null;
      }

      // TV: find the best resume point
      const prefix = `tv:${tmdbId}:`;
      const tvEntries = Object.entries(map)
        .filter(([k]) => k.startsWith(prefix))
        .map(([, v]) => v);

      if (tvEntries.length === 0) return null;

      // If current episode has progress (not completed), resume that
      if (currentSeason != null && currentEpisode != null) {
        const currentKey = buildStorageKey(tmdbId, 'tv', currentSeason, currentEpisode);
        const current = map[currentKey];
        if (current && !current.completed && current.percent > 0.01) return current;
      }

      // Find the last completed episode
      const completedEntries = tvEntries
        .filter((e) => e.completed && e.season != null && e.episode != null)
        .sort((a, b) => {
          if ((a.season ?? 0) !== (b.season ?? 0)) return (a.season ?? 0) - (b.season ?? 0);
          return (a.episode ?? 0) - (b.episode ?? 0);
        });

      if (completedEntries.length > 0) {
        const last = completedEntries[completedEntries.length - 1];
        const nextSeason = last.season!;
        const nextEpisode = (last.episode ?? 0) + 1;

        // Check if next exists and has partial progress
        const nextKey = buildStorageKey(tmdbId, 'tv', nextSeason, nextEpisode);
        const next = map[nextKey];
        if (next && !next.completed) return next;

        // Return a synthetic resume hint
        return {
          tmdbId,
          mediaType: 'tv',
          currentTime: 0,
          duration: 0,
          percent: 0,
          season: nextSeason,
          episode: nextEpisode,
          updatedAt: Date.now(),
          completed: false,
        };
      }

      // No completed entries — return most recent partial progress
      const sortedByTime = tvEntries
        .filter((e) => !e.completed)
        .sort((a, b) => b.updatedAt - a.updatedAt);

      return sortedByTime[0] ?? null;
    },
    [loadMap],
  );

  // ── Mark completed ──────────────────────────────────────────────

  const markCompleted = useCallback(
    async (
      tmdbId: string,
      mediaType: 'movie' | 'tv',
      season?: number,
      episode?: number,
    ) => {
      await saveProgress({
        tmdbId,
        mediaType,
        currentTime: 0,
        duration: 0,
        percent: 1,
        season,
        episode,
        updatedAt: Date.now(),
        completed: true,
      });
    },
    [saveProgress],
  );

  // ── Remove / clear ──────────────────────────────────────────────

  const removeEntry = useCallback(
    async (
      tmdbId: string,
      mediaType: 'movie' | 'tv',
      season?: number,
      episode?: number,
    ) => {
      const key = buildStorageKey(tmdbId, mediaType, season, episode);
      const map = await loadMap();
      delete map[key];
      await persistMap(map);
      await loadEntries();
    },
    [loadMap, persistMap, loadEntries],
  );

  const clearAll = useCallback(async () => {
    try {
      await storage.removeItem(STORAGE_KEY);
      cacheRef.current = {};
      setEntries([]);
    } catch {
      // Silently fail
    }
  }, [storage]);

  return {
    entries,
    loading,
    totalCount: entries.length,
    saveProgress,
    getProgress,
    getResumePoint,
    markCompleted,
    removeEntry,
    clearAll,
    refresh: loadEntries,
  };
}
