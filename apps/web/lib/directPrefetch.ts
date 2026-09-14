/**
 * directPrefetch — speculatively fetch /api/player/direct metadata BEFORE the
 * watch page mounts.
 *
 * Triggered on title-card hover (desktop): by the time the user clicks and
 * Next.js finishes the route transition, the metadata request — the first
 * blocking step of Direct playback — is usually already resolved. DirectVideoPlayer
 * consumes the in-flight/resolved promise instead of refetching.
 *
 * Entries live for 3 minutes and are capped, so hovering a wall of cards
 * cannot pile up requests. Desktop-only: the direct provider is desktop's
 * default, and the browser web build has no use for the extra traffic.
 */

import { apiUrl } from "./tmdb";
import { probeUrls } from "./probeCache";
import { selectBestStream, type StreamEntry } from "./streamSelector";

const TTL_MS = 3 * 60 * 1000;
const MAX_ENTRIES = 12;
/** How many top-ranked candidates to background-probe per prefetched title. */
const PROBE_TOP_N = 3;

interface CacheEntry {
  promise: Promise<unknown>;
  createdAt: number;
}

const cache = new Map<string, CacheEntry>();

function isDesktop(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as any).electronAPI?.isDesktop === true
  );
}

function buildUrl(
  type: "movie" | "tv",
  id: string,
  season?: number,
  episode?: number,
): string {
  const params = new URLSearchParams({ id });
  if (type === "tv" && season) params.set("season", String(season));
  if (type === "tv" && episode) params.set("episode", String(episode));
  return apiUrl(`/api/player/direct?${params.toString()}`);
}

function key(
  type: string,
  id: string,
  season?: number,
  episode?: number,
): string {
  return `${type}:${id}:${season ?? ""}:${episode ?? ""}`;
}

/**
 * Resolve the link array for the prefetched title — mirrors the shape logic
 * in DirectVideoPlayer (movies use `links`; TV falls back to per-season/
 * episode buckets when the API didn't pre-resolve).
 */
function extractLinks(
  data: unknown,
  type: "movie" | "tv",
  season?: number,
  episode?: number,
): StreamEntry[] {
  if (!data || typeof data !== "object") return [];
  const d = data as any;
  if (Array.isArray(d.links) && d.links.length > 0)
    return d.links as StreamEntry[];
  if (type === "tv" && Array.isArray(d.seasons)) {
    const s = d.seasons.find((x: any) => x.season_number === (season ?? 1));
    const ep = s?.episodes?.find(
      (x: any) => x.episode_number === (episode ?? 1),
    );
    return (ep?.links ?? []) as StreamEntry[];
  }
  return [];
}

/**
 * Rank the prefetched links and background-probe the top candidates into the
 * shared verdict cache. The watch page's first probe then reads from cache
 * instead of the network — the last blocking step of direct startup gone.
 * Fire-and-forget: ~3 range requests of 2KB each, never blocks playback.
 */
function warmProbes(
  type: "movie" | "tv",
  data: unknown,
  season?: number,
  episode?: number,
): void {
  const links = extractLinks(data, type, season, episode);
  if (links.length === 0) return;
  const selection = selectBestStream(links, {
    runtimeMinutes: type === "tv" ? 45 : 120,
  });
  const rankedUrls = selection.sortedLinks
    .map((l) => l.url)
    .filter(Boolean)
    .slice(0, PROBE_TOP_N);
  if (rankedUrls.length === 0) return;
  probeUrls(rankedUrls, () => {});
}

/**
 * Kick off (or reuse) a metadata fetch. Fire-and-forget — safe to call on
 * every hover; failures are swallowed (the watch page refetches on mount).
 */
export function prefetchDirectMedia(
  type: "movie" | "tv",
  id: string,
  season?: number,
  episode?: number,
): void {
  if (!isDesktop() || !id) return;
  const k = key(type, id, season, episode);

  const existing = cache.get(k);
  if (existing && Date.now() - existing.createdAt < TTL_MS) return;

  // Evict expired/oldest entries to bound memory and request volume
  const now = Date.now();
  cache.forEach((ce, ck) => {
    if (now - ce.createdAt > TTL_MS) cache.delete(ck);
  });
  while (cache.size >= MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    cache.forEach((ce, ck) => {
      if (ce.createdAt < oldestAt) {
        oldestAt = ce.createdAt;
        oldestKey = ck;
      }
    });
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }

  cache.set(k, {
    createdAt: Date.now(),
    promise: fetch(buildUrl(type, id, season, episode))
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(String(res.status))),
      )
      .then((data) => {
        try {
          warmProbes(type, data, season, episode);
        } catch {
          /* probing is best-effort */
        }
        return data;
      })
      .catch(() => {
        cache.delete(k); // allow a clean retry from the watch page
        return null;
      }),
  });
}

/**
 * Returns the prefetched metadata promise if one is fresh, else undefined.
 * The consumer falls back to its own fetch when null/undefined.
 */
export function getPrefetchedDirectMedia(
  type: "movie" | "tv",
  id: string,
  season?: number,
  episode?: number,
): Promise<unknown> | undefined {
  if (typeof window === "undefined") return undefined;
  const entry = cache.get(key(type, id, season, episode));
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(key(type, id, season, episode));
    return undefined;
  }
  return entry.promise;
}
