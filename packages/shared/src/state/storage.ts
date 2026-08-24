/**
 * Storage adapter factories.
 *
 * Provides platform-specific storage adapters:
 *   - createLocalStorageAdapter() — for web (browser)
 *   - createAsyncStorageAdapter() — for mobile (React Native)
 */

import type { StorageAdapter, WatchProgress, WatchHistoryMap } from "./types";
import { buildStorageKey } from "./useWatchHistory";

// ── localStorage adapter (web) ────────────────────────────────────
//
// Stores history as per-item keys: @filmsnaps/watch:<flatKey>
// where flatKey is e.g. "movie:123" or "tv:123:season:1:episode:3".
// Also maintains an @filmsnaps/watch-index MRU index capped at 1000 entries,
// mirroring mobile's watchHistoryStore model.
//
// This shape enables: getResumePoint, getProgress, saveProgress, clearProgress,
// removeEntry, clearAll, getAllProgress, getAggregatedHistory — all of which
// expect per-item keys, not a single monolithic blob.

/**
 * Create a storage adapter backed by window.localStorage.
 *
 * Includes cross-tab sync via `window.addEventListener('storage', ...)`:
 * when the user bookmarks or updates history in one tab, all other
 * tabs receive the change immediately.
 */
export function createLocalStorageAdapter(): StorageAdapter {
  const listeners = new Set<(key: string, newValue: string | null) => void>();

  // Cross-tab sync listener
  const handleStorageEvent = (e: StorageEvent) => {
    if (!e.key) return;
    for (const cb of listeners) {
      cb(e.key, e.newValue);
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorageEvent);
  }

  return {
    async getItem(key: string): Promise<string | null> {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },

    async setItem(key: string, value: string): Promise<void> {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Storage full or unavailable — silently fail
      }
    },

    async removeItem(key: string): Promise<void> {
      try {
        localStorage.removeItem(key);
      } catch {
        // Silently fail
      }
    },

    addCrossTabListener(
      callback: (key: string, newValue: string | null) => void,
    ): () => void {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  };
}

// ── AsyncStorage adapter (React Native / mobile) ──────────────────

/**
 * Create a storage adapter backed by @react-native-async-storage/async-storage.
 *
 * On mobile there's no cross-tab sync (single-window app). The
 * `addCrossTabListener` is omitted.
 */
export function createAsyncStorageAdapter(asyncStorage: {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}): StorageAdapter {
  return {
    async getItem(key: string): Promise<string | null> {
      try {
        return await asyncStorage.getItem(key);
      } catch {
        return null;
      }
    },

    async setItem(key: string, value: string): Promise<void> {
      try {
        await asyncStorage.setItem(key, value);
      } catch {
        // Storage unavailable — silently fail
      }
    },

    async removeItem(key: string): Promise<void> {
      try {
        await asyncStorage.removeItem(key);
      } catch {
        // Silently fail
      }
    },
  };
}

// ── In-memory adapter (testing / SSR) ─────────────────────────────

/**
 * Create a storage adapter backed by an in-memory Map.
 * Useful for testing or server-side rendering.
 */
export function createMemoryAdapter(): StorageAdapter {
  const store = new Map<string, string>();

  return {
    async getItem(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async setItem(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async removeItem(key: string): Promise<void> {
      store.delete(key);
    },
  };
}
