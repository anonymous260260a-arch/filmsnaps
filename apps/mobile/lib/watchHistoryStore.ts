/**
 * WatchHistoryStore — Local-First Singleton for watch-history UI state.
 *
 * This replaces the previous "fetch-on-mount" pattern where Home, Library, and
 * the /history screen each independently called getAggregatedHistory() +
 * per-item TMDB metadata fetches. That caused three problems:
 *   1. The /history route unmounts on back-nav, throwing away resolved state and
 *      flashing a skeleton on every re-open.
 *   2. Library re-fetched TMDB metadata from scratch on every mount.
 *   3. The home CW section popped in after Trending (DeferredContent gap),
 *      reading as a flicker.
 *
 * New model (per expert consultation 2026-08-17): a module-level singleton that
 * lives OUTSIDE the React tree. It owns the fully-resolved history entries
 * (local progress merged with remote TMDB metadata), survives route unmounts /
 * tab switches / backgrounding, and enriches missing/stale metadata in a single
 * background batch. Screens subscribe via useSyncExternalStore and just render
 * what the store currently holds — they never "load" history themselves.
 *
 * React Query is intentionally NOT used to hold merged history: history is
 * primarily local device state that merely needs remote enrichment, so a plain
 * store is a better fit than remote-server-state tooling.
 */

import { useMemo, useSyncExternalStore } from "react";
import { tmdbApi } from "./api";
import {
  getAggregatedHistory,
  clearMediaProgress,
  type WatchProgress,
} from "./watchHistory";
import {
  readHistoryMetaCache,
  writeHistoryMetaCache,
  type CachedHistoryMeta,
} from "./historyMetaCache";
import type { Movie } from "@filmsnaps/shared";

const META_TTL_MS = 24 * 60 * 60 * 1000; // 24h — industry-standard for TMDB

export interface ResolvedHistoryEntry {
  latest: WatchProgress;
  episodeCount: number;
  fullyWatched: boolean;
  /** TMDB metadata (title/poster). null until enriched or if fetch failed. */
  meta: Movie | null;
  /** Timestamp of `meta` (0 when meta is null). Drives the 24h TTL. */
  metaTs: number;
}

export interface WatchHistorySnapshot {
  entries: ResolvedHistoryEntry[];
  /** True once local AsyncStorage reads + merge have completed (even if a
   *  background TMDB enrichment is still pending). Screens use this to decide
   *  whether to show a skeleton (absolute first launch) vs. render instantly. */
  isHydrated: boolean;
  /** True during a forceRefresh() (pull-to-refresh) pass. */
  isRefreshing: boolean;
}

/**
 * History filter consumed by the store selector. `all` returns every entry
 * (the /history master archive); `movie_tv` / `anime` scope to the active mode.
 * Filtering lives in the data layer (not the UI) so MRU caps and re-renders
 * apply after the filter.
 */
export type HistoryMode = "all" | "movie_tv" | "anime";

function filterByMode(
  entries: ResolvedHistoryEntry[],
  mode: HistoryMode,
): ResolvedHistoryEntry[] {
  if (mode === "all") return entries;
  const out = entries.filter((e) =>
    mode === "anime" ? e.latest.isAnime === true : e.latest.isAnime !== true,
  );
  if (__DEV__)
    console.log(
      `[FS-WH] filterByMode mode=${mode} total=${entries.length} shown=${out.length} flags=${JSON.stringify(
        entries.map((e) => e.latest.isAnime),
      )}`,
    );
  return out;
}

class WatchHistoryStore {
  private entries: ResolvedHistoryEntry[] = [];
  private isHydrated = false;
  private isRefreshing = false;
  private listeners = new Set<() => void>();
  private snapshot: WatchHistorySnapshot = {
    entries: [],
    isHydrated: false,
    isRefreshing: false,
  };
  private initStarted = false;
  private initPromise: Promise<void> | null = null;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getSnapshot = (): WatchHistorySnapshot => this.snapshot;

  private emit() {
    this.snapshot = {
      entries: this.entries,
      isHydrated: this.isHydrated,
      isRefreshing: this.isRefreshing,
    };
    this.listeners.forEach((l) => l());
  }

  /** Idempotent. Kicks off hydration at most once. Safe to call repeatedly. */
  init(): Promise<void> {
    if (this.initStarted) return this.initPromise ?? Promise.resolve();
    this.initStarted = true;
    this.initPromise = this.hydrate(false).catch((e) => {
      console.warn("[WatchHistoryStore] hydrate failed:", e);
    });
    return this.initPromise;
  }

  /**
   * Read local progress + cached metadata in parallel, merge into resolved
   * entries, then fire a single background batch to TMDB for anything missing
   * or older than the TTL. `force` bypasses the TTL (used by pull-to-refresh).
   */
  private async hydrate(force: boolean): Promise<void> {
    const [agg, cached] = await Promise.all([
      getAggregatedHistory(),
      readHistoryMetaCache(),
    ]);
    this.isHydrated = true;

    this.entries = agg.map((e) => {
      const c: CachedHistoryMeta | undefined = cached?.[e.latest.tmdbId];
      const fresh = c != null && !force && Date.now() - c.ts <= META_TTL_MS;
      return {
        latest: e.latest,
        episodeCount: e.episodeCount,
        fullyWatched: e.fullyWatched,
        meta: fresh ? c.meta : null,
        metaTs: fresh ? c.ts : 0,
      };
    });
    this.emit();

    const needsFetch = this.entries
      .filter(
        (e) => force || e.meta === null || Date.now() - e.metaTs > META_TTL_MS,
      )
      .map((e) => e.latest.tmdbId);

    if (needsFetch.length > 0) {
      await this.enrich(needsFetch);
    }
  }

  /** Fetch TMDB metadata for the given tmdbIds, merge into the in-memory
   *  entries and the persisted cache. */
  private async enrich(ids: string[]): Promise<void> {
    const cached = (await readHistoryMetaCache()) ?? {};
    const fetched: Record<string, CachedHistoryMeta> = {};

    await Promise.all(
      ids.map(async (id) => {
        const entry = this.entries.find((e) => e.latest.tmdbId === id);
        if (!entry) return;
        try {
          const m: Movie =
            entry.latest.mediaType === "tv"
              ? ((await tmdbApi.getTVDetails(Number(id))) as unknown as Movie)
              : ((await tmdbApi.getMovieDetails(Number(id))) as Movie);
          fetched[id] = { meta: m, ts: Date.now() };
        } catch {
          // Keep a negative-cache timestamp so we don't hammer a dead ID.
          fetched[id] = { meta: null, ts: Date.now() };
        }
      }),
    );

    const merged: Record<string, CachedHistoryMeta> = { ...cached, ...fetched };
    await writeHistoryMetaCache(merged);

    this.entries = this.entries.map((e) => {
      const up = fetched[e.latest.tmdbId];
      if (!up) return e;
      return { ...e, meta: up.meta, metaTs: up.ts };
    });
    this.emit();
  }

  /**
   * Re-read local progress (after a watch session saved new progress) and merge
   * with the existing in-memory metadata so we don't re-fetch posters we
   * already have. New items (meta missing) get enriched in the background.
   */
  async syncProgress(): Promise<void> {
    const agg = await getAggregatedHistory();
    const existingById = new Map(
      this.entries.map((e) => [e.latest.tmdbId, e] as const),
    );

    this.entries = agg.map((e) => {
      const existing = existingById.get(e.latest.tmdbId);
      if (
        existing &&
        existing.meta &&
        Date.now() - existing.metaTs <= META_TTL_MS
      ) {
        // Keep cached metadata, update progress fields.
        return {
          ...existing,
          latest: e.latest,
          episodeCount: e.episodeCount,
          fullyWatched: e.fullyWatched,
        };
      }
      return {
        latest: e.latest,
        episodeCount: e.episodeCount,
        fullyWatched: e.fullyWatched,
        meta: existing?.meta ?? null,
        metaTs: existing?.metaTs ?? 0,
      };
    });
    this.emit();

    const needsFetch = this.entries
      .filter((e) => e.meta === null || Date.now() - e.metaTs > META_TTL_MS)
      .map((e) => e.latest.tmdbId);
    if (needsFetch.length > 0) await this.enrich(needsFetch);
  }

  /** Pull-to-refresh: bypass the TTL, re-read everything, fetch fresh TMDB. */
  async forceRefresh(): Promise<void> {
    this.isRefreshing = true;
    this.emit();
    try {
      await this.hydrate(true);
    } catch (e) {
      console.warn("[WatchHistoryStore] forceRefresh failed:", e);
    } finally {
      this.isRefreshing = false;
      this.emit();
    }
  }

  /**
   * Remove a single media item from history. Deletes all per-item keys for the
   * tmdbId, drops it from the in-memory entries, and prunes the cache. All
   * subscribed screens re-render instantly via useSyncExternalStore.
   */
  async removeItem(
    tmdbId: string | number,
    mediaType: "movie" | "tv",
    isAnime?: boolean,
  ): Promise<void> {
    const idStr = String(tmdbId);
    try {
      await clearMediaProgress(tmdbId, mediaType, isAnime);
    } catch {
      // ignore storage errors — still remove from in-memory view
    }

    this.entries = this.entries.filter(
      (e) =>
        !(
          e.latest.tmdbId === idStr &&
          e.latest.mediaType === mediaType &&
          (e.latest.isAnime ?? false) === (isAnime ?? false)
        ),
    );

    const cached = await readHistoryMetaCache();
    if (cached && idStr in cached) {
      delete cached[idStr];
      await writeHistoryMetaCache(cached);
    }
    this.emit();
  }
}

export const watchHistoryStore = new WatchHistoryStore();

/**
 * Subscribe a component to the resolved watch-history store. The component
 * renders whatever the store currently holds — no local loading state. On
 * absolute first launch (before hydration completes) `isHydrated` is false so
 * the screen can show a one-time skeleton; afterwards it renders instantly,
 * including after route unmounts.
 */
export function useWatchHistory(
  mode: HistoryMode = "all",
): WatchHistorySnapshot {
  const raw = useSyncExternalStore(
    watchHistoryStore.subscribe,
    watchHistoryStore.getSnapshot,
    watchHistoryStore.getSnapshot,
  );
  // Filter at the data layer. Memoized on the raw snapshot + mode so the
  // filtered array reference is stable across renders unless either changes.
  const entries = useMemo(
    () => filterByMode(raw.entries, mode),
    [raw.entries, mode],
  );
  return { ...raw, entries };
}

// Start hydration as soon as this module is first imported (the home screen
// imports useWatchHistory, so this effectively runs at app launch — warming the
// cache without blocking the splash screen). Idempotent.
watchHistoryStore.init();
