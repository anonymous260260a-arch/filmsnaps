/**
 * Storage layer types.
 *
 * Defines the StorageAdapter interface that abstracts over
 * localStorage (web) and AsyncStorage (mobile), plus the
 * data types shared across platforms.
 */

// ── Data types ────────────────────────────────────────────────────

/** Per-provider position snapshot (store v2 — expert verdict §8 Q2). */
export interface ProviderPosition {
  currentTime: number;
  duration: number;
  updatedAt: number;
}

export interface WatchProgress {
  /** TMDB id of the movie or TV show */
  tmdbId: string;
  mediaType: "movie" | "tv";
  /** Which provider was used (e.g. nxsha, peachify) */
  providerId?: string;
  /** Last playback position in seconds */
  currentTime: number;
  /** Total duration in seconds */
  duration: number;
  /** Percent complete (0–1) */
  percent: number;
  /** TV-specific — current season number */
  season?: number;
  /** TV-specific — current episode number */
  episode?: number;
  /** Whether this entry belongs to the anime mode (Hard Mode Split scoping) */
  isAnime?: boolean;
  /** Timestamp of last update (ms) */
  updatedAt: number;
  /** Explicitly marked as fully watched */
  completed: boolean;
  /**
   * Position as reported by each provider that played this item (v2).
   * Providers report different durations for the same title, so absolute
   * seconds are only comparable intra-provider; cross-provider resume maps
   * percent × new duration instead of reusing raw seconds.
   */
  perProvider?: Record<string, ProviderPosition>;
  /** Provider whose position is authoritative — the most recent writer. */
  primaryProviderId?: string;
}

// ── Storage adapter interface ─────────────────────────────────────

/**
 * Generic key-value storage adapter.
 *
 * Both localStorage (web) and AsyncStorage (mobile) implement this.
 * The app code calls these methods through `useWatchHistory` instead of
 * directly. (Web watchlist state is intentionally local — see
 * `apps/web/hooks/useWatchlist.ts`; mobile uses `apps/mobile/lib/bookmarks.ts`.)
 */
export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** Register a listener for cross-tab storage changes (web only) */
  addCrossTabListener?(
    callback: (key: string, newValue: string | null) => void,
  ): () => void;
}

// ── Watch history map ─────────────────────────────────────────────

export type WatchHistoryMap = Record<string, WatchProgress>;
