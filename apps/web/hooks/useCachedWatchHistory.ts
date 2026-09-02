"use client";

/**
 * useCachedWatchHistory — Module-level cache for watch history.
 *
 * Caches the localStorage read at module level so navigating away and back
 * shows instantly instead of re-reading and flashing "Loading...".
 */

import { useSyncExternalStore } from "react";
import { useWatchHistory, createLocalStorageAdapter } from "@filmsnaps/shared";
import type { WatchProgress } from "@filmsnaps/shared";

const storage = createLocalStorageAdapter();

// Module-level cache — survives route unmounts
let _cachedEntries: WatchProgress[] | null = null;
let _cachedAggregated: any[] | null = null;
let _listeners: Set<() => void> = new Set();
let _lastSnapshot: {
  entries: WatchProgress[] | null;
  aggregated: any[] | null;
} | null = null;

function _subscribe(l: () => void) {
  _listeners.add(l);
  return () => _listeners.delete(l);
}

function _getSnapshot() {
  if (
    !_lastSnapshot ||
    _lastSnapshot.entries !== _cachedEntries ||
    _lastSnapshot.aggregated !== _cachedAggregated
  ) {
    _lastSnapshot = { entries: _cachedEntries, aggregated: _cachedAggregated };
  }
  return _lastSnapshot;
}

function _getServerSnapshot() {
  return { entries: null, aggregated: null };
}

function _notifyListeners() {
  Array.from(_listeners).forEach((l) => l());
}

/**
 * Returns watch history with module-level caching.
 * First render may show loading; subsequent mounts are instant.
 */
export function useCachedWatchHistory() {
  const hook = useWatchHistory(storage);

  // When data arrives from the hook, cache it at module level and notify
  if (!hook.loading) {
    const changed =
      _cachedEntries !== hook.entries || _cachedAggregated !== hook.aggregated;
    _cachedEntries = hook.entries;
    _cachedAggregated = hook.aggregated;
    if (changed) _notifyListeners();
  }

  const cached = useSyncExternalStore(
    _subscribe,
    _getSnapshot,
    _getServerSnapshot,
  );

  return {
    ...hook,
    entries: cached.entries ?? hook.entries,
    aggregated: cached.aggregated ?? hook.aggregated,
    loading: cached.entries ? false : hook.loading,
  };
}
