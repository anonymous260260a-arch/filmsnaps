/**
 * Storage layer types.
 *
 * Defines the StorageAdapter interface that abstracts over
 * localStorage (web) and AsyncStorage (mobile), plus the
 * data types shared across platforms.
 */

// ── Data types ────────────────────────────────────────────────────

export interface WatchProgress {
  /** TMDB id of the movie or TV show */
  tmdbId: string;
  mediaType: 'movie' | 'tv';
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
  /** Timestamp of last update (ms) */
  updatedAt: number;
  /** Explicitly marked as fully watched */
  completed: boolean;
}

export interface Bookmark {
  tmdbId: string;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string | null;
  year: string;
  addedAt: number;
}

// ── Storage adapter interface ─────────────────────────────────────

/**
 * Generic key-value storage adapter.
 *
 * Both localStorage (web) and AsyncStorage (mobile) implement this.
 * The app code calls these methods through `useWatchlist` / `useWatchHistory`
 * hooks instead of directly.
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
export type BookmarkMap = Record<string, Bookmark>;
