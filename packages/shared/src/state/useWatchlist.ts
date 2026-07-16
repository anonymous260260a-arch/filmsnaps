/**
 * Watchlist hook — unified bookmark/watchlist state across platforms.
 *
 * Uses the StorageAdapter interface so it works with both
 * localStorage (web) and AsyncStorage (mobile).
 *
 * Web also registers a cross-tab storage listener so bookmarks
 * added in one tab appear instantly in another.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { StorageAdapter, Bookmark } from './types';

const STORAGE_KEY = '@filmsnaps/bookmarks';

export interface WatchlistState {
  /** All bookmarked items, newest first */
  items: Bookmark[];
  /** Whether bookmarks are still loading from storage */
  loading: boolean;
  /** Total count of bookmarks */
  count: number;
}

export interface WatchlistActions {
  /** Add a bookmark (idempotent — overwrites if same tmdbId exists) */
  addItem: (item: Bookmark) => Promise<void>;
  /** Remove a bookmark by TMDB id */
  removeItem: (tmdbId: string) => Promise<void>;
  /** Check if a TMDB id is bookmarked */
  isSaved: (tmdbId: string) => boolean;
  /** Clear all bookmarks */
  clearAll: () => Promise<void>;
  /** Refresh from storage */
  refresh: () => Promise<void>;
}

/**
 * Hook into the watchlist state.
 *
 * @param storage - A StorageAdapter instance (localStorage or AsyncStorage)
 */
export function useWatchlist(storage: StorageAdapter): WatchlistState & WatchlistActions {
  const [items, setItems] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const itemsRef = useRef<Bookmark[]>([]);

  // Keep ref in sync for isSaved checks
  itemsRef.current = items;

  const load = useCallback(async () => {
    try {
      const raw = await storage.getItem(STORAGE_KEY);
      if (raw) {
        const map: Record<string, Bookmark> = JSON.parse(raw);
        const list = Object.values(map).sort((a, b) => b.addedAt - a.addedAt);
        setItems(list);
      } else {
        setItems([]);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [storage]);

  useEffect(() => {
    load();

    // Cross-tab sync (web only — noop on mobile)
    const unlisten = storage.addCrossTabListener?.((key, newValue) => {
      if (key === STORAGE_KEY) {
        load();
      }
    });

    return () => {
      unlisten?.();
    };
  }, [load, storage]);

  const addItem = useCallback(
    async (item: Bookmark) => {
      try {
        const raw = await storage.getItem(STORAGE_KEY);
        const map: Record<string, Bookmark> = raw ? JSON.parse(raw) : {};
        map[item.tmdbId] = item;
        await storage.setItem(STORAGE_KEY, JSON.stringify(map));
        await load();
      } catch {
        // Silently fail
      }
    },
    [storage, load],
  );

  const removeItem = useCallback(
    async (tmdbId: string) => {
      try {
        const raw = await storage.getItem(STORAGE_KEY);
        if (!raw) return;
        const map: Record<string, Bookmark> = JSON.parse(raw);
        delete map[tmdbId];
        await storage.setItem(STORAGE_KEY, JSON.stringify(map));
        await load();
      } catch {
        // Silently fail
      }
    },
    [storage, load],
  );

  const isSaved = useCallback((tmdbId: string): boolean => {
    return itemsRef.current.some((b) => b.tmdbId === tmdbId);
  }, []);

  const clearAll = useCallback(async () => {
    try {
      await storage.removeItem(STORAGE_KEY);
      setItems([]);
    } catch {
      // Silently fail
    }
  }, [storage]);

  return {
    items,
    loading,
    count: items.length,
    addItem,
    removeItem,
    isSaved,
    clearAll,
    refresh: load,
  };
}
