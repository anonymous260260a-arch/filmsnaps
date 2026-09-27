/**
 * Anime stream prefetch — a tiny, isolated cache for the JustAnime pipeline.
 *
 * Movie/TV streams use lib/streamPrefetch.ts (fetch → rank → probe → chain);
 * anime deliberately mirrors none of that machinery. One shared entry per
 * `anime:{malId}:e{ep}:{providerId}` holds the RAW (sub+dub) pool from
 * fetchAnimeStreams(); ranking is applied per lookup at peek time so a sub
 * caller and a dub caller share the same fetch. Concurrent callers for one key
 * join the same in-flight run.
 *
 * Eviction mirrors streamPrefetch's small-surface rules: positive TTL 45 min,
 * negative (empty) 5 min, LRU cap 32.
 */
import type { StreamLink } from "../components/player/streamTypes";
import { fetchAnimeStreams, ANIME_PROVIDER_ID } from "./anime/streams";
import { filterByAudio, rankAnimeLinks, type AnimeAudio } from "./anime/rank";

export interface AnimePrefetchOptions {
  providerId?: string;
  /** Who started this run — appears in [Anime] logs. */
  trigger?: "details" | "home-cw" | "watch" | "next-episode";
  /** Bypass a fresh cache entry and re-run the fetch. */
  force?: boolean;
}

export interface AnimeStreamResult {
  /**
   * Ranked links for the requested audio track ONLY — a sub caller gets sub
   * links, a dub caller gets dub links. The raw cache entry still holds the
   * merged sub+dub pool.
   */
  links: StreamLink[];
  bestIndex: number;
  selectionReason: string;
  prefetchedAt: number;
  cacheKey: string;
}

interface Entry {
  links: StreamLink[];
  prefetchedAt: number;
  expiresAt: number;
  empty?: boolean;
}

const CACHE = new Map<string, Entry>();
const IN_FLIGHT = new Map<string, Promise<AnimeStreamResult | null>>();

const TTL_MS = 45 * 60 * 1000;
const EMPTY_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 32;

/** Cache key for the RAW pool (audio-agnostic — ranking happens per peek). */
export function animeCacheKey(
  malId: number,
  episode: number,
  providerId: string = ANIME_PROVIDER_ID,
): string {
  return `anime:${malId}:e${episode}:${providerId}`;
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [key, entry] of CACHE) {
    if (now >= entry.expiresAt) CACHE.delete(key);
  }
  if (CACHE.size <= MAX_ENTRIES) return;
  let oldestKey: string | null = null;
  let oldestAt = Infinity;
  for (const [key, entry] of CACHE) {
    if (entry.prefetchedAt < oldestAt) {
      oldestAt = entry.prefetchedAt;
      oldestKey = key;
    }
  }
  if (oldestKey) CACHE.delete(oldestKey);
}

/**
 * Sync peek: fresh positive entry → ranked links for `audio`. Returns null on
 * miss, expiry, or a negative (empty) entry — no network.
 */
export function peekAnimeStreams(
  malId: number,
  episode: number,
  audio: AnimeAudio,
  providerId: string = ANIME_PROVIDER_ID,
): AnimeStreamResult | null {
  purgeExpired();
  const entry = CACHE.get(animeCacheKey(malId, episode, providerId));
  if (!entry || entry.empty || Date.now() >= entry.expiresAt) return null;
  const byAudio = filterByAudio(entry.links, audio);
  if (byAudio.length === 0) return null;
  const rank = rankAnimeLinks(byAudio, audio);
  return {
    links: rank.sortedLinks,
    bestIndex: rank.bestIndex,
    selectionReason: rank.selectionReason,
    prefetchedAt: entry.prefetchedAt,
    cacheKey: animeCacheKey(malId, episode, providerId),
  };
}

/**
 * Fetch (or join) the anime pool for one MAL-relative episode, then return the
 * audio-ranked result. Concurrent callers with the same key share one run.
 */
export async function prefetchAnimeStreams(
  malId: number,
  episode: number,
  audio: AnimeAudio,
  options: AnimePrefetchOptions = {},
): Promise<AnimeStreamResult | null> {
  const providerId = options.providerId ?? ANIME_PROVIDER_ID;
  const cacheKey = animeCacheKey(malId, episode, providerId);
  purgeExpired();

  if (!options.force) {
    const entry = CACHE.get(cacheKey);
    if (entry && Date.now() < entry.expiresAt) {
      const byAudio = filterByAudio(entry.links, audio);
      const rank = byAudio.length > 0 ? rankAnimeLinks(byAudio, audio) : null;
      console.log(
        `[Anime] prefetch ${cacheKey}: cache ${entry.empty ? "HIT — empty (negative)" : `HIT — ${entry.links.length} links`} (trigger=${options.trigger ?? "unknown"})`,
      );
      if (entry.empty || !rank) return null;
      return {
        links: rank.sortedLinks,
        bestIndex: rank.bestIndex,
        selectionReason: rank.selectionReason,
        prefetchedAt: entry.prefetchedAt,
        cacheKey,
      };
    }
  }

  const existing = IN_FLIGHT.get(cacheKey);
  if (existing) {
    console.log(
      `[Anime] prefetch ${cacheKey}: joining in-flight run (trigger=${options.trigger ?? "unknown"})`,
    );
    return existing;
  }

  console.log(
    `[Anime] ▶ prefetch START ${cacheKey} (trigger=${options.trigger ?? "unknown"})`,
  );
  const run = (async (): Promise<AnimeStreamResult | null> => {
    const links = await fetchAnimeStreams({ malId, episode, providerId });
    if (links.length === 0) {
      CACHE.set(cacheKey, {
        links: [],
        prefetchedAt: Date.now(),
        expiresAt: Date.now() + EMPTY_TTL_MS,
        empty: true,
      });
      purgeExpired();
      console.log(
        `[Anime] ■ prefetch DONE ${cacheKey}: EMPTY (negative-cached)`,
      );
      return null;
    }
    CACHE.set(cacheKey, {
      links,
      prefetchedAt: Date.now(),
      expiresAt: Date.now() + TTL_MS,
    });
    purgeExpired();
    const byAudio = filterByAudio(links, audio);
    const rank = byAudio.length > 0 ? rankAnimeLinks(byAudio, audio) : null;
    console.log(
      `[Anime] ■ prefetch DONE ${cacheKey}: ${links.length} links, head = ${rank?.sortedLinks[0]?.quality ?? "?"} ${rank?.sortedLinks[0]?._meta?.audio ?? ""}`,
    );
    if (!rank) {
      return {
        links: [],
        bestIndex: 0,
        selectionReason: `no ${audio} links`,
        prefetchedAt: Date.now(),
        cacheKey,
      };
    }
    return {
      links: rank.sortedLinks,
      bestIndex: rank.bestIndex,
      selectionReason: rank.selectionReason,
      prefetchedAt: Date.now(),
      cacheKey,
    };
  })();
  IN_FLIGHT.set(cacheKey, run);
  try {
    return await run;
  } finally {
    IN_FLIGHT.delete(cacheKey);
  }
}

/** Drop everything (player close / media change) — never leaves stale anime pools. */
export function clearAnimePrefetchCache(): void {
  CACHE.clear();
  IN_FLIGHT.clear();
}

/**
 * Persist a pool into the cache without network (used by the watch hook once
 * its progressive per-source fetches have all settled). Empty pools prime the
 * short negative entry so a trail of upstream failures isn't re-hit for 5 min.
 */
export function storeAnimeCache(
  malId: number,
  episode: number,
  links: StreamLink[],
  providerId: string = ANIME_PROVIDER_ID,
): string {
  const cacheKey = animeCacheKey(malId, episode, providerId);
  if (links.length === 0) {
    CACHE.set(cacheKey, {
      links: [],
      prefetchedAt: Date.now(),
      expiresAt: Date.now() + EMPTY_TTL_MS,
      empty: true,
    });
  } else {
    CACHE.set(cacheKey, {
      links,
      prefetchedAt: Date.now(),
      expiresAt: Date.now() + TTL_MS,
    });
  }
  purgeExpired();
  console.log(
    `[Anime] ⬤ cached ${cacheKey}: ${links.length} links${links.length === 0 ? " (negative)" : ""}`,
  );
  return cacheKey;
}
