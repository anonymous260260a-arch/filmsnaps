import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { QueryKey } from "@tanstack/react-query";

const ASYNC_STORAGE_KEY = "@filmsnaps/tanstack-query-cache";

/**
 * React Query persister backed by AsyncStorage.
 *
 * Event-driven writes (throttled at 1s) replace the old 30s interval-based
 * full-serialize approach. The persister preserves each query's original
 * `dataUpdatedAt` timestamp, so restored data is naturally stale relative
 * to per-query staleTime — no manual invalidation needed.
 */
export const asyncStoragePersister = createAsyncStoragePersister({
  storage: {
    getItem: async (key: string) => {
      const value = await AsyncStorage.getItem(key);
      return value ?? null;
    },
    setItem: async (key: string, value: string) => {
      await AsyncStorage.setItem(key, value);
    },
    removeItem: async (key: string) => {
      await AsyncStorage.removeItem(key);
    },
  },
  key: ASYNC_STORAGE_KEY,
  throttleTime: 1_000,
});

/**
 * Determine whether a query should be persisted to disk.
 *
 * Persists TMDB metadata (static-ish data that survives cold launch).
 * Drops volatile queries that change per-query or per-params.
 */
export function isPersistableQuery(key: QueryKey): boolean {
  if (!Array.isArray(key) || typeof key[0] !== "string") return false;

  const prefix = key[0];

  // Drop volatile — search results change per query, low value to persist
  if (prefix === "search") return false;

  // Drop filtered discover — changes with every param combination
  if (
    (prefix === "movies" && key[1] === "filtered") ||
    (prefix === "tv" && key[1] === "filtered")
  )
    return false;

  // Persist static + semi-static TMDB data
  const persistable = [
    "movie",
    "movies",
    "tv",
    "trending",
    "popular",
    "upcoming",
    "season",
    "person",
    "anilist", // anime home feed — stable content, persists like trending/popular
  ];
  return persistable.includes(prefix);
}
