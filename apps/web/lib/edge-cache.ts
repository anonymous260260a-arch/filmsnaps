/**
 * Worker-native edge cache for upstream fetches (`cf` cache options).
 *
 * Next's data cache (`next: { revalidate }`) is skipped on request-time pages
 * and the OpenNext incremental cache isn't configured, so the only effective
 * cache on the free Workers plan is the colo cache attached to the upstream
 * fetch itself. Works on workers.dev because the cached object lives at the
 * destination host's edge (TMDB etc.), not on our domain.
 */
export function edgeCache(ttlSeconds: number, negativeTtl = 60): RequestInit {
  return {
    cf: {
      cacheEverything: true,
      cacheTtlByStatus: {
        "200-299": ttlSeconds,
        "404": negativeTtl,
        "403": 0,
        "429": 0,
        "500-599": 0,
      },
    },
  } as RequestInit;
}
