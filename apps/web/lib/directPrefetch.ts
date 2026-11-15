/**
 * directPrefetch — warm the direct-provider chain BEFORE the watch page
 * mounts.
 *
 * Triggers: detail-page mount (mobile parity — mobile's tv/movie detail
 * screens call prefetchStreams when details settle) and title-card hover
 * (desktop). Runs on EVERY platform now: browser web included — the chain
 * goes through the same /api/player/direct proxy the player would hit, so a
 * warmed chain makes Watch Now instant instead of a cold 3-4 provider walk.
 *
 * The heavy lifting (provider chain walk, negative caching, in-flight joins,
 * probe warming) lives in lib/streamPrefetch.ts — this module is the
 * compatibility shim that keeps the historical call sites working.
 */

import { peekDirectChain, prefetchDirectChain } from "./streamPrefetch";

/**
 * Kick off (or join) the direct-provider chain for a title. Fire-and-forget
 * — safe to call on every mount/hover; failures land in the chain's negative
 * cache and are swallowed (the watch page refetches on mount).
 */
export function prefetchDirectMedia(
  type: "movie" | "tv",
  id: string,
  season?: number,
  episode?: number,
  anime?: boolean,
): void {
  prefetchDirectChain(type, id, season, episode, anime);
}

/**
 * Returns a promise resolving to the chain winner's data (or null when the
 * whole chain is exhausted), if one is warm or already running — else
 * undefined. The consumer falls back to its own fetch when undefined.
 */
export function getPrefetchedDirectMedia(
  type: "movie" | "tv",
  id: string,
  season?: number,
  episode?: number,
): Promise<unknown> | undefined {
  if (typeof window === "undefined") return undefined;
  const peeked = peekDirectChain(type, id, season, episode);
  if (!peeked) return undefined;
  if (peeked instanceof Promise) {
    return peeked.then((w) => w?.data ?? null);
  }
  return Promise.resolve(peeked.data);
}
