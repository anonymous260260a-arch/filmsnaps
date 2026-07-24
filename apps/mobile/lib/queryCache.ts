import * as FileSystem from 'expo-file-system/legacy';
import type { QueryClient } from '@tanstack/react-query';

const CACHE_FILE = FileSystem.documentDirectory + 'filmsnaps-query-cache.json';
const PERSIST_INTERVAL = 30_000; // 30s

/**
 * Persist React Query cache to disk for instant cold launch.
 *
 * Designed for TMDB metadata (movies, TV shows, search results)
 * which rarely changes and is safe to serve stale for minutes.
 * Not used for auth or user-specific data.
 */

// ── Restore cache on app start ──
export async function hydrateQueryClient(queryClient: QueryClient): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(CACHE_FILE);
    if (!info.exists) return;

    const raw = await FileSystem.readAsStringAsync(CACHE_FILE);
    const { state, timestamp } = JSON.parse(raw);

    // Discard if cache is older than 2 hours
    if (Date.now() - timestamp > 1000 * 60 * 120) {
      await FileSystem.deleteAsync(CACHE_FILE, { idempotent: true });
      return;
    }

    const queryCache = queryClient.getQueryCache();
    for (const [queryKey, data] of Object.entries(state)) {
      queryCache.build(queryClient, {
        queryKey: JSON.parse(queryKey),
        queryHash: queryKey,
      });
      // Restore cached data directly into the QueryClient store
      // setQueryData marks the query as fresh (not stale) so it won't refetch
      queryClient.setQueryData(JSON.parse(queryKey), data, {
        updatedAt: timestamp,
      });
    }

    console.log(`[QueryCache] Hydrated ${Object.keys(state).length} queries`);
  } catch (e) {
    console.warn('[QueryCache] Hydration failed:', e);
    // Silently fail — app works fine without cache
  }
}

// ── Save cache to disk ──
export async function persistQueryCache(queryClient: QueryClient): Promise<void> {
  try {
    const queries = queryClient.getQueryCache().getAll();
    const state: Record<string, unknown> = {};

    for (const query of queries) {
      const data = query.state.data;
      if (data == null) continue;

      // Only persist TMDB data (keys starting with known prefixes)
      const key = query.queryKey;
      if (
        Array.isArray(key) &&
        typeof key[0] === 'string' &&
        (key[0] === 'movie' ||
          key[0] === 'tv' ||
          key[0] === 'trending' ||
          key[0] === 'popular' ||
          key[0] === 'upcoming' ||
          key[0] === 'search' ||
          key[0] === 'season')
      ) {
        state[JSON.stringify(key)] = data;
      }
    }

    if (Object.keys(state).length === 0) return;

    await FileSystem.writeAsStringAsync(
      CACHE_FILE,
      JSON.stringify({ state, timestamp: Date.now() }),
    );
  } catch (e) {
    // Silent — non-critical
  }
}

// ── Start periodic persistence ──
export function startPersistLoop(queryClient: QueryClient): () => void {
  // Persist immediately (after hydration)
  persistQueryCache(queryClient);

  const id = setInterval(() => {
    persistQueryCache(queryClient);
  }, PERSIST_INTERVAL);

  return () => clearInterval(id);
}
