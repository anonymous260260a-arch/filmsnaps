"use client";
/**
 * Watch History hook — unified watch-progress tracking across platforms.
 *
 * Features:
 * - Save progress with dedup (never overwrite with lower progress)
 * - Auto-mark as completed at >= 95%
 * - Resume-point detection for both movies and TV shows
 * - Aggregated history grouped by TMDB id
 * - Cross-tab sync on web via storage events
 *
 * Storage shape: per-item keys @filmsnaps/watch:<flatKey>
 *   where flatKey = "movie:TMDBID" or "tv:TMDBID:season:S:episode:E"
 * Plus an MRU index @filmsnaps/watch-index capped at 1000 entries.
 *
 * This mirrors mobile's watchHistoryStore model, fixing the desktop "watch history
 * is not working" issue where the old single-blob shape never matched mobile's
 * per-item key lookups (getProgress, getResumePoint, etc.).
 *
 * Migration: on first load, if the old single blob @filmsnaps/watch-history
 * exists, migrateIfNeeded() splits it into per-item keys + rebuilds the index,
 * then deletes the old key — existing history survives the upgrade transparently.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type {
  StorageAdapter,
  WatchProgress,
  WatchHistoryMap,
  ProviderPosition,
} from "./types";

const ITEM_PREFIX = "@filmsnaps/watch:";
const INDEX_KEY = "@filmsnaps/watch-index";
const INDEX_CAP = 1000;
/** Legacy single-blob key — read by migration, then deleted. */
const STORAGE_KEY = "@filmsnaps/watch-history";

let migrateChecked = false;

/** MRU index entry */
interface IndexEntry {
  /** flat key suffix (e.g. "movie:123") */
  k: string;
  /** updatedAt for MRU ordering */
  t: number;
}

export interface AggregatedHistoryEntry {
  /** Most recently updated entry for the group (the card's resume target). */
  latest: WatchProgress;
  /** Number of episodes watched for this TMDB id (TV); 1 for movies. */
  episodeCount: number;
  /** True when every stored episode of the group is marked completed. */
  fullyWatched: boolean;
}

export interface WatchHistoryState {
  /** All history entries, newest first */
  entries: WatchProgress[];
  /** TV episodes collapsed into one show card per TMDB id — mirrors mobile's
   *  getAggregatedHistory so Continue Watching / History show a single card per
   *  series (not one per episode). Movies are passed through unchanged. */
  aggregated: AggregatedHistoryEntry[];
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
    mediaType: "movie" | "tv",
    season?: number,
    episode?: number,
  ) => Promise<WatchProgress | null>;
  /** Get the best resume point for a movie or TV show */
  getResumePoint: (
    tmdbId: string,
    mediaType: "movie" | "tv",
    currentSeason?: number,
    currentEpisode?: number,
  ) => Promise<WatchProgress | null>;
  /** Mark a movie or TV episode as fully watched */
  markCompleted: (
    tmdbId: string,
    mediaType: "movie" | "tv",
    season?: number,
    episode?: number,
  ) => Promise<void>;
  /** Remove a single progress entry */
  removeEntry: (
    tmdbId: string,
    mediaType: "movie" | "tv",
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
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): string {
  if (mediaType === "tv" && season != null && episode != null) {
    return `tv:${tmdbId}:season:${season}:episode:${episode}`;
  }
  return `${mediaType}:${tmdbId}`;
}

/**
 * Collapse per-episode TV entries into ONE card per TMDB id — mirrors mobile's
 * getAggregatedHistory. Movies pass through (episodeCount 1). Keeps anime and
 * movie/TV physically/semantically separate even when they share a twin TMDB id
 * (the `isAnime` flag drives the group key, not the storage key).
 */
export function aggregateHistory(
  entries: WatchProgress[],
): AggregatedHistoryEntry[] {
  const groups = new Map<string, WatchProgress[]>();
  for (const entry of entries) {
    const key = `${entry.isAnime === true ? "anime:" : ""}${entry.mediaType}:${entry.tmdbId}`;
    const existing = groups.get(key) ?? [];
    existing.push(entry);
    groups.set(key, existing);
  }
  return Array.from(groups.values())
    .map((entries) => {
      entries.sort((a, b) => b.updatedAt - a.updatedAt);
      return {
        latest: entries[0],
        episodeCount: entries.length,
        fullyWatched: entries.every((e) => e.completed),
      };
    })
    .sort((a, b) => b.latest.updatedAt - a.latest.updatedAt);
}

// ── Migration ─────────────────────────────────────────────────────

/**
 * One-time split of the legacy single-map blob into per-item keys + index.
 * Uses window.localStorage directly (the blob only ever lived there); safe
 * to call repeatedly — runs at most once per session.
 */
async function migrateIfNeeded(): Promise<void> {
  if (migrateChecked) return;
  migrateChecked = true;
  try {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const map = JSON.parse(raw) as WatchHistoryMap;
    const index: IndexEntry[] = [];
    for (const [flatKey, prog] of Object.entries(map)) {
      window.localStorage.setItem(ITEM_PREFIX + flatKey, JSON.stringify(prog));
      index.push({ k: flatKey, t: prog.updatedAt || 0 });
    }
    index.sort((a, b) => b.t - a.t);
    window.localStorage.setItem(
      INDEX_KEY,
      JSON.stringify(index.slice(0, INDEX_CAP)),
    );
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // If migration fails, leave the old blob in place; reads degrade to it.
  }
}

// ── Hook ──────────────────────────────────────────────────────────

/**
 * Hook into watch history state.
 *
 * @param storage - A StorageAdapter instance
 */
export function useWatchHistory(
  storage: StorageAdapter,
): WatchHistoryState & WatchHistoryActions {
  const [entries, setEntries] = useState<WatchProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const cacheRef = useRef<WatchHistoryMap>({});
  /** Cached parsed MRU index — avoids a localStorage re-read on every save. */
  const indexRef = useRef<IndexEntry[] | null>(null);
  /** Coalesces debounced index writes during playback. */
  const indexTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load helpers ────────────────────────────────────────────────

  /**
   * Read the per-item map via the index (post-migration format). Falls back
   * to the legacy single blob when no index exists yet (migration failed or
   * pre-migration data being read before migrateIfNeeded ran).
   */
  const loadMap = useCallback(async (): Promise<WatchHistoryMap> => {
    try {
      const indexRaw = await storage.getItem(INDEX_KEY);
      if (indexRaw) {
        const index = JSON.parse(indexRaw) as IndexEntry[];
        const map: WatchHistoryMap = {};
        for (const entry of index) {
          const itemRaw = await storage.getItem(ITEM_PREFIX + entry.k);
          if (itemRaw) {
            try {
              map[entry.k] = JSON.parse(itemRaw) as WatchProgress;
            } catch {
              // Skip corrupt item
            }
          }
        }
        cacheRef.current = map;
        return map;
      }
    } catch {
      // Fall through to legacy blob below
    }

    // Legacy single-blob fallback
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

  // Collapse TV episodes into one card per show (mobile parity), recomputed
  // whenever the raw entries change.
  const aggregated = useMemo(() => aggregateHistory(entries), [entries]);

  /**
   * Persist the map as per-item keys + rebuild the MRU index.
   * Each entry is written individually; removed keys are deleted so the
   * store never accumulates orphans.
   */
  const persistPerItemMap = useCallback(
    async (map: WatchHistoryMap) => {
      try {
        const nextKeys = new Set(Object.keys(map));
        // Delete per-item keys that are no longer in the map
        const indexRaw = await storage.getItem(INDEX_KEY);
        if (indexRaw) {
          try {
            const prevIndex = JSON.parse(indexRaw) as IndexEntry[];
            for (const entry of prevIndex) {
              if (!nextKeys.has(entry.k)) {
                await storage.removeItem(ITEM_PREFIX + entry.k);
              }
            }
          } catch {
            // Ignore corrupt previous index
          }
        }
        const index: IndexEntry[] = [];
        for (const [flatKey, prog] of Object.entries(map)) {
          await storage.setItem(ITEM_PREFIX + flatKey, JSON.stringify(prog));
          index.push({ k: flatKey, t: prog.updatedAt || 0 });
        }
        index.sort((a, b) => b.t - a.t);
        await storage.setItem(
          INDEX_KEY,
          JSON.stringify(index.slice(0, INDEX_CAP)),
        );
      } catch {
        // Storage full or unavailable — silently fail
      }
    },
    [storage],
  );

  // ── Init ────────────────────────────────────────────────────────

  useEffect(() => {
    let active = true;

    (async () => {
      await migrateIfNeeded();
      if (active) await loadEntries();
    })();

    const unlisten = storage.addCrossTabListener?.((key) => {
      if (key === INDEX_KEY) {
        // Index changed in another tab — reload so all tabs stay in sync
        loadEntries();
      }
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, [loadEntries, storage]);

  // ── Per-item writes (perf: avoid full-store serialization per save) ──

  const persistItem = useCallback(
    async (key: string, prog: WatchProgress) => {
      cacheRef.current[key] = prog;
      try {
        await storage.setItem(ITEM_PREFIX + key, JSON.stringify(prog));
      } catch {
        // Storage full or unavailable — silently fail
      }
    },
    [storage],
  );

  /**
   * Move the item to the front of the MRU index without rewriting every key.
   * Fast path: if it's already rank 0, do nothing (covers the common case —
   * the user is actively watching the most recent item). Otherwise coalesce
   * the index write (debounced) so rapid saves during playback cost at most
   * one localStorage write per idle window (verdict Q10 / F10).
   */
  const touchIndex = useCallback(
    async (key: string) => {
      let index = indexRef.current;
      if (!index) {
        try {
          const raw = await storage.getItem(INDEX_KEY);
          index = raw ? (JSON.parse(raw) as IndexEntry[]) : [];
        } catch {
          index = [];
        }
        indexRef.current = index;
      }
      if (index.length > 0 && index[0].k === key) return; // already MRU

      index = [{ k: key, t: Date.now() }, ...index.filter((e) => e.k !== key)];
      indexRef.current = index;

      if (indexTimer.current != null) return; // a write is already scheduled
      indexTimer.current = setTimeout(() => {
        indexTimer.current = null;
        const snapshot = indexRef.current ?? [];
        void storage
          .setItem(INDEX_KEY, JSON.stringify(snapshot.slice(0, INDEX_CAP)))
          .catch(() => {});
      }, 2000);
    },
    [storage],
  );

  /** Merge a single saved entry into `entries` state without a full re-read. */
  const applySaveToState = useCallback((prog: WatchProgress) => {
    const key = buildStorageKey(
      prog.tmdbId,
      prog.mediaType,
      prog.season,
      prog.episode,
    );
    setEntries((prev) => {
      const next = prev.filter(
        (e) =>
          buildStorageKey(e.tmdbId, e.mediaType, e.season, e.episode) !== key,
      );
      next.push(prog);
      next.sort((a, b) => b.updatedAt - a.updatedAt);
      return next;
    });
  }, []);

  // ── Save progress ───────────────────────────────────────────────

  const saveProgress = useCallback(
    async (progress: WatchProgress) => {
      // Only persist meaningful progress (>5s) or mark completed
      if (progress.currentTime <= 5 && !progress.completed) return;

      const key = buildStorageKey(
        progress.tmdbId,
        progress.mediaType,
        progress.season,
        progress.episode,
      );

      const map = cacheRef.current;
      const existing = map[key];
      const pid = progress.providerId || "unknown";
      const isFinished = progress.percent >= 0.95 || progress.completed;

      // Completed-undo (verdict Q9): >60s of continuous playback below 90%
      // contradicts a stored completion — clear it (ad-element duration noise
      // can otherwise false-complete a title).
      const undoCompleted =
        !!existing?.completed &&
        !isFinished &&
        progress.percent < 0.9 &&
        progress.currentTime > 60;

      // Seed per-provider history from a v1 entry so the advancement gate has
      // a baseline for this provider (store v2 — verdict Q2).
      const perProvider: Record<string, ProviderPosition> = {
        ...(existing?.perProvider ?? {}),
      };
      if (
        existing &&
        !perProvider[pid] &&
        existing.providerId === pid &&
        !existing.completed
      ) {
        perProvider[pid] = {
          currentTime: existing.currentTime,
          duration: existing.duration,
          updatedAt: existing.updatedAt,
        };
      }

      // Advancement gate: finish always wins; otherwise accept only if this
      // provider has no stored position yet or its position has advanced
      // (>0.5s tolerance). Replaces the old flat percent-monotonic guard that
      // froze forward progress whenever providers reported different durations.
      const prevP = perProvider[pid];
      if (
        !isFinished &&
        prevP &&
        progress.currentTime <= prevP.currentTime + 0.5
      ) {
        return;
      }

      perProvider[pid] = {
        currentTime: progress.currentTime,
        duration: progress.duration,
        updatedAt: Date.now(),
      };

      const merged: WatchProgress = {
        ...progress,
        perProvider,
        primaryProviderId: pid,
        completed:
          isFinished || undoCompleted || (existing?.completed ?? false),
        updatedAt: Date.now(),
      };

      await persistItem(key, merged);
      void touchIndex(key);
      applySaveToState(merged);
    },
    [persistItem, touchIndex, applySaveToState],
  );

  // ── Get progress ────────────────────────────────────────────────

  const getProgress = useCallback(
    async (
      tmdbId: string,
      mediaType: "movie" | "tv",
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
      mediaType: "movie" | "tv",
      currentSeason?: number,
      currentEpisode?: number,
    ): Promise<WatchProgress | null> => {
      const map = await loadMap();

      if (mediaType === "movie") {
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
        const currentKey = buildStorageKey(
          tmdbId,
          "tv",
          currentSeason,
          currentEpisode,
        );
        const current = map[currentKey];
        if (current && !current.completed && current.percent > 0.01)
          return current;
      }

      // Find the last completed episode
      const completedEntries = tvEntries
        .filter((e) => e.completed && e.season != null && e.episode != null)
        .sort((a, b) => {
          if ((a.season ?? 0) !== (b.season ?? 0))
            return (a.season ?? 0) - (b.season ?? 0);
          return (a.episode ?? 0) - (b.episode ?? 0);
        });

      if (completedEntries.length > 0) {
        const last = completedEntries[completedEntries.length - 1];
        const nextSeason = last.season!;
        const nextEpisode = (last.episode ?? 0) + 1;

        // Check if next exists and has partial progress
        const nextKey = buildStorageKey(tmdbId, "tv", nextSeason, nextEpisode);
        const next = map[nextKey];
        if (next && !next.completed) return next;

        // Return a synthetic resume hint
        return {
          tmdbId,
          mediaType: "tv",
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
      mediaType: "movie" | "tv",
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
      mediaType: "movie" | "tv",
      season?: number,
      episode?: number,
    ) => {
      const key = buildStorageKey(tmdbId, mediaType, season, episode);
      const map = await loadMap();
      delete map[key];
      await persistPerItemMap(map);
      indexRef.current = null; // index rewritten wholesale — drop cache
      await loadEntries();
    },
    [loadMap, persistPerItemMap, loadEntries],
  );

  const clearAll = useCallback(async () => {
    try {
      // Remove all per-item keys listed in the index
      const indexRaw = await storage.getItem(INDEX_KEY);
      if (indexRaw) {
        try {
          const index = JSON.parse(indexRaw) as IndexEntry[];
          for (const entry of index) {
            await storage.removeItem(ITEM_PREFIX + entry.k);
          }
        } catch {
          // Ignore corrupt index — still remove the index itself below
        }
      }
      await storage.removeItem(INDEX_KEY);
      // Also remove the legacy blob if it still exists
      await storage.removeItem(STORAGE_KEY);
      cacheRef.current = {};
      setEntries([]);
    } catch {
      // Silently fail
    }
  }, [storage]);

  return {
    entries,
    aggregated,
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
