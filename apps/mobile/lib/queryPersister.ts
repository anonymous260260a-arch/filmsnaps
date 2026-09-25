import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { QueryKey } from "@tanstack/react-query";

const ASYNC_STORAGE_KEY = "@filmsnaps/tanstack-query-cache";

export { ASYNC_STORAGE_KEY };

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
 * Only home-feed LIST queries are persisted (target blob < 500KB):
 *   - trending movies / trending tv / popular / upcoming
 *   - anime home rails (anilist.home)
 *
 * EXCLUDED (large 200KB–1MB payloads that bloat restore and risk Android
 * AsyncStorage size caps): details, seasons, person, similar, moreLikeThis,
 * filtered discover, search.
 */
export function isPersistableQuery(key: QueryKey): boolean {
  if (!Array.isArray(key) || typeof key[0] !== "string") return false;

  const prefix = key[0];
  const second = key[1];

  // Home feed lists only
  if (prefix === "movies" && second === "trending") return true;
  if (prefix === "movies" && second === "popular") return true;
  if (prefix === "movies" && second === "upcoming") return true;
  if (prefix === "tv" && second === "trending") return true;
  // Anime home feed rails
  if (prefix === "anilist" && second === "home") return true;

  return false;
}

/** Read the raw persisted blob size in bytes (0 if missing). */
export async function readPersistedCacheBytes(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(ASYNC_STORAGE_KEY);
    return raw ? raw.length : 0;
  } catch {
    return 0;
  }
}
