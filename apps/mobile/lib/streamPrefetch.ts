/**
 * Stream cache — the ONE prefetch/validation cache for stream links.
 *
 * Fetches and sorts links on the details screen (while the user reads the
 * description) and probes the top candidates so the watch screen can start
 * playing instantly.
 *
 * Design notes:
 *  - Single module-level cache with ONE key scheme (`movie:969681:s0:e0`).
 *    (The old duplicate streamPrewarm cache was removed — it had a different
 *    key format, different value shape, and zero callers.)
 *  - In-flight dedup: navigating details→watch twice (or a double effect fire)
 *    shares one pipeline instead of racing two fetch+probe runs.
 *  - Validation outcomes are stored per-URL with their own freshness rules
 *    from streamValidator (valid 90 s, dead 60 s, unknown never cached).
 *  - Expired entries are purged on every insert, and the cache is capped —
 *    browsing many titles no longer grows the map without bound.
 *  - Selection options come from the caller (user settings), not hardcoded.
 *  - `bestValidated` distinguishes "best link was probe-verified" from
 *    "deadline hit, first link by ranking" — the watch screen uses this to
 *     decide whether to show a checking stage.
 */

import type { StreamLink } from "../components/player/streamTypes";
import type { ValidationResult } from "./streamValidator";
import { validateStreamUrl } from "./streamValidator";
import { selectBestStream, type PreferredLanguage } from "./streamSelector";
import { fetchDirectStreams } from "./directStreams";

export interface StreamCacheOptions {
  cellularMaxMB?: number;
  maxQuality?: string | null;
  preferredAudioLanguage?: PreferredLanguage;
}

export interface StreamCacheResult {
  /** Links sorted by the selector (best first). */
  links: StreamLink[];
  /** Index into `links` of the recommended source. */
  bestIndex: number;
  /** True when the recommended link was probe-verified, false = ranking only. */
  bestValidated: boolean;
  /** Per-URL probe outcomes gathered during prefetch. */
  validationResults: Map<string, ValidationResult>;
  /** How many links finished probing before the deadline. */
  probedCount: number;
  /** Human-readable reason for the recommendation (may be empty). */
  selectionReason: string;
  prefetchedAt: number;
}

interface CacheEntry extends StreamCacheResult {
  expiresAt: number;
  /** Last time probe outcomes were refreshed (link ranking aside). */
  probedAt: number;
  reprobeCount: number;
}

const CACHE = new Map<string, CacheEntry>();
const IN_FLIGHT = new Map<string, Promise<StreamCacheResult | null>>();
const REPROBE_IN_FLIGHT = new Set<string>();

const MAX_CONCURRENT_PROBES = 4;
const PROBE_DEADLINE_MS = 3000;
const MIN_VALID_LINKS = 3;
/**
 * Two-tier freshness: links are presigned for 8 hours, so the ranked list
 * stays usable far longer than a probe verdict does. The cache keeps links
 * for 45 min (a user reading the details page no longer triggers a re-fetch)
 * while probe outcomes are refreshed lazily in the background on each hit.
 */
const CACHE_TTL_MS = 45 * 60 * 1000;
const PROBE_REFRESH_MS = 90 * 1000;
/** Max background re-probe rounds per entry — bounded work for never-consumed entries. */
const MAX_REPROBE_ROUNDS = 2;
const MAX_ENTRIES = 8;

function getCacheKey(
  tmdbId: number,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): string {
  const key = `${mediaType}:${tmdbId}:s${season ?? 0}:e${episode ?? 0}`;
  console.log(
    `[StreamCache] getCacheKey: tmdbId=${tmdbId}, type=${mediaType}, season=${season}, episode=${episode} → key="${key}"`,
  );
  return key;
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [key, entry] of CACHE) {
    if (now >= entry.expiresAt) CACHE.delete(key);
  }
  // Hard cap: drop the oldest entries beyond MAX_ENTRIES
  while (CACHE.size > MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [key, entry] of CACHE) {
      if (entry.prefetchedAt < oldestAt) {
        oldestAt = entry.prefetchedAt;
        oldestKey = key;
      }
    }
    if (!oldestKey) break;
    CACHE.delete(oldestKey);
  }
}

function entryIsFresh(entry: CacheEntry): boolean {
  return Date.now() < entry.expiresAt;
}

/**
 * Fetch, sort, and probe the stream links for a title.
 * Concurrent calls for the same key share one pipeline.
 */
export async function prefetchStreams(
  tmdbId: number,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
  options: StreamCacheOptions = {},
): Promise<StreamCacheResult | null> {
  const cacheKey = getCacheKey(tmdbId, mediaType, season, episode);

  purgeExpired();
  const cached = CACHE.get(cacheKey);
  if (cached && entryIsFresh(cached)) {
    console.log(`[StreamCache] prefetchStreams: cache HIT (${cacheKey})`);
    refreshProbesInBackground(cacheKey, cached);
    return cached;
  }

  const existing = IN_FLIGHT.get(cacheKey);
  if (existing) {
    console.log(
      `[StreamCache] prefetchStreams: joining in-flight pipeline (${cacheKey})`,
    );
    return existing;
  }

  const pipeline = runPrefetchPipeline(
    cacheKey,
    tmdbId,
    mediaType,
    season,
    episode,
    options,
  ).finally(() => {
    IN_FLIGHT.delete(cacheKey);
  });

  IN_FLIGHT.set(cacheKey, pipeline);
  return pipeline;
}

async function runPrefetchPipeline(
  cacheKey: string,
  tmdbId: number,
  mediaType: "movie" | "tv",
  season: number | undefined,
  episode: number | undefined,
  options: StreamCacheOptions,
): Promise<StreamCacheResult | null> {
  try {
    // 1. Fetch links directly from the upstream provider (on-device, no proxy)
    let rawLinks: StreamLink[];
    try {
      const bundle = await fetchDirectStreams(
        tmdbId,
        mediaType,
        season,
        episode,
      );
      rawLinks = bundle.links;
    } catch (err) {
      console.warn(`[StreamCache] direct fetch failed for ${cacheKey}:`, err);
      return null;
    }
    if (rawLinks.length === 0) return null;

    // 2. Rank via the selector with the caller's settings
    const selection = await selectBestStream(rawLinks, {
      cellularMaxMB: options.cellularMaxMB ?? 3000,
      maxQuality: options.maxQuality ?? null,
      preferredLanguage: options.preferredAudioLanguage ?? "auto",
      // Bitrate cap needs an assumed duration (selector default = movie)
      runtimeMinutes: mediaType === "tv" ? 45 : 120,
    });
    const { sortedLinks } = selection;

    // 3. Probe the top candidates (concurrency-limited, deadline-bounded).
    //    The list is already in recommendation order, so probe in that order.
    const validationResults = new Map<string, ValidationResult>();
    let validCount = 0;
    let probedCount = 0;

    const startTime = Date.now();

    outer: for (let i = 0; i < sortedLinks.length; i += MAX_CONCURRENT_PROBES) {
      if (Date.now() - startTime > PROBE_DEADLINE_MS) {
        console.log("[StreamCache] Probe deadline reached, stopping");
        break;
      }

      const batch = sortedLinks.slice(i, i + MAX_CONCURRENT_PROBES);
      await Promise.allSettled(
        batch.map(async (link) => {
          const result = await validateStreamUrl(link.url);
          validationResults.set(link.url, result);
          probedCount++;
          if (result.outcome === "valid") validCount++;
        }),
      );

      if (validCount >= MIN_VALID_LINKS) {
        console.log(
          `[StreamCache] Found ${validCount} valid links, stopping early`,
        );
        break outer;
      }
    }

    // 4. Best index: first link in ranking order with a verified outcome.
    //    "unknown" outcomes do not block — they just don't count as verified.
    let bestIndex = selection.bestIndex;
    let bestValidated = false;
    if (
      validationResults.get(sortedLinks[bestIndex]?.url)?.outcome === "valid"
    ) {
      bestValidated = true;
    } else {
      for (let i = 0; i < sortedLinks.length; i++) {
        if (validationResults.get(sortedLinks[i].url)?.outcome === "valid") {
          bestIndex = i;
          bestValidated = true;
          break;
        }
      }
    }

    // 5. Cache and return
    const result: StreamCacheResult = {
      links: sortedLinks,
      bestIndex,
      bestValidated,
      validationResults,
      probedCount,
      selectionReason: selection.selectionReason,
      prefetchedAt: Date.now(),
    };

    CACHE.set(cacheKey, {
      ...result,
      expiresAt: Date.now() + CACHE_TTL_MS,
      probedAt: Date.now(),
      reprobeCount: 0,
    });
    purgeExpired();

    console.log(
      `[StreamCache] Completed: ${validCount} valid / ${probedCount} probed of ${sortedLinks.length} links, bestIndex=${bestIndex} (validated=${bestValidated})`,
    );
    return result;
  } catch (error) {
    console.warn("[StreamCache] Prefetch failed:", error);
    return null;
  }
}

/**
 * Refresh stale probe outcomes for a cached entry without blocking the caller.
 * The consumer starts playing immediately on the existing ranking; this keeps
 * the picker statuses and bestIndex honest while the user is still reading.
 * Mutates the cached entry in place (statuses are advisory everywhere).
 */
async function refreshProbesInBackground(
  cacheKey: string,
  entry: CacheEntry,
): Promise<void> {
  if (REPROBE_IN_FLIGHT.has(cacheKey)) return;
  if (Date.now() - entry.probedAt < PROBE_REFRESH_MS) return;
  if (entry.reprobeCount >= MAX_REPROBE_ROUNDS) return;

  REPROBE_IN_FLIGHT.add(cacheKey);
  try {
    const results = new Map(entry.validationResults);
    let validCount = 0;
    let probedCount = 0;
    const startTime = Date.now();

    outer: for (let i = 0; i < entry.links.length; i += MAX_CONCURRENT_PROBES) {
      if (Date.now() - startTime > PROBE_DEADLINE_MS) break;
      const batch = entry.links.slice(i, i + MAX_CONCURRENT_PROBES);
      await Promise.allSettled(
        batch.map(async (link) => {
          // validateStreamUrl's own cache (valid 90s / dead 60s) naturally
          // skips outcomes that are still fresh.
          const result = await validateStreamUrl(link.url);
          results.set(link.url, result);
          probedCount++;
          if (result.outcome === "valid") validCount++;
        }),
      );
      if (validCount >= MIN_VALID_LINKS) break outer;
    }

    // Recompute the recommendation: prefer the ranked best if verified, else
    // the first probe-verified link (mirrors runPrefetchPipeline step 4).
    let bestIndex = entry.bestIndex;
    let bestValidated = false;
    if (results.get(entry.links[bestIndex]?.url)?.outcome === "valid") {
      bestValidated = true;
    } else {
      for (let i = 0; i < entry.links.length; i++) {
        if (results.get(entry.links[i].url)?.outcome === "valid") {
          bestIndex = i;
          bestValidated = true;
          break;
        }
      }
    }

    entry.validationResults = results;
    entry.probedCount = probedCount;
    entry.bestIndex = bestIndex;
    entry.bestValidated = bestValidated;
    entry.probedAt = Date.now();
    entry.reprobeCount += 1;

    console.log(
      `[StreamCache] Background re-probe (${cacheKey}): ${validCount} valid / ${probedCount} probed, bestIndex=${bestIndex}`,
    );
  } catch (e) {
    console.warn("[StreamCache] Background re-probe failed:", e);
  } finally {
    REPROBE_IN_FLIGHT.delete(cacheKey);
  }
}

/**
 * Take the prefetched result on the watch screen (one-shot per entry).
 * Returns null when nothing was cached or the entry expired.
 */
export function consumePrefetch(
  tmdbId: number,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): StreamCacheResult | null {
  const cacheKey = getCacheKey(tmdbId, mediaType, season, episode);
  const entry = CACHE.get(cacheKey);

  console.log(
    `[StreamCache] consumePrefetch: cacheKey=${cacheKey}, found=${!!entry}, cacheSize=${CACHE.size}`,
  );

  if (entry && entryIsFresh(entry)) {
    CACHE.delete(cacheKey);
    return entry;
  }

  if (entry) CACHE.delete(cacheKey);
  return null;
}

/** Peek without consuming. */
export function hasPrefetch(
  tmdbId: number,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): boolean {
  const cacheKey = getCacheKey(tmdbId, mediaType, season, episode);
  const entry = CACHE.get(cacheKey);
  return !!(entry && entryIsFresh(entry));
}

/** Drop the whole cache (player close, media change, "re-check all" flow). */
export function clearPrefetchCache(): void {
  CACHE.clear();
  IN_FLIGHT.clear();
}
