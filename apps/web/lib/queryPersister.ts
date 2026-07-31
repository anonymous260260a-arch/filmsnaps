/**
 * Web React Query persister — port of the mobile caching philosophy to
 * the browser/Electron renderer.
 *
 * Mirrors `apps/mobile/lib/queryPersister.ts`: a sync localStorage-backed
 * persister with a whitelist (`isPersistableQuery`) that preserves each
 * query's original `dataUpdatedAt`, so restored data is naturally stale
 * relative to per-query staleTime — stale-while-revalidate across cold
 * launches is free.
 *
 * Security: persists APP DATA only (TMDB metadata). It never persists
 * provider state — the provider <webview> partition stays `cache: false`
 * by design, and `provider-health` is excluded below.
 */

import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { QueryKey } from "@tanstack/react-query";

const STORAGE_KEY = "@filmsnaps/tanstack-query-cache";

export function createWebPersister() {
  return createSyncStoragePersister({
    storage: window.localStorage,
    key: STORAGE_KEY,
    throttleTime: 1_000, // 1s batched writes
  });
}

/**
 * Decide whether a query should be persisted to disk.
 *
 * The web app's keyset is small: movie/tv/movies search, header search,
 * palette search, movie details, and filtered movie/tv discover lists.
 *
 * Persists static-ish TMDB metadata (movie details, unfiltered list rows).
 * Drops volatile queries that change per-query or per-params:
 *   - search (any prefix containing "search" — includes header-search, palette-search)
 *   - filtered discover (['movies'|'tv', genres, ...] where key[1] is a non-empty array)
 *   - provider-health (fast-changing, in-memory only by design)
 */
export function isPersistableQuery(key: QueryKey): boolean {
  if (!Array.isArray(key) || typeof key[0] !== "string") return false;

  const prefix = key[0];

  // Never persist provider state or fast-changing health
  if (prefix === "provider-health") return false;

  // Drop search of any flavor
  if (prefix.includes("search")) return false;

  // Drop filtered discover — changes with every genre/sort/rating combination.
  // The web keys are ['movies', genres[], sortBy, year, rating, lang] and
  // ['tv', ...]. A non-empty second element means filters are applied.
  if (
    (prefix === "movies" || prefix === "tv") &&
    Array.isArray(key[1]) &&
    key[1].length > 0
  ) {
    return false;
  }

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
  ];
  return persistable.includes(prefix);
}
