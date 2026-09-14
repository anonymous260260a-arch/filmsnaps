/**
 * Stream pipeline — the SINGLE source of truth for direct stream links.
 *
 * One pipeline per episode key (`tv:969681:s1:e1`), started from the page
 * where the user's intent forms (details screen, continue-watching on home)
 * and consumed by the watch screen. Every caller joins the same run — nobody
 * re-fetches, re-ranks, or replaces a ranked list.
 *
 * Stages (each logs one [Flow] line, in order):
 *   1. FETCH   — both providers on-device (directStreams), timed.
 *   2. RANK    — selectBestStream (language buckets × size cap → CDN).
 *                The ranked array is FROZEN from here on.
 *   3. HEAD    — probe the CHAMPION (selection.bestIndex — NOT picker row 0)
 *                ALONE. valid → done. dead → strike it, badge moves to the
 *                next ranked candidate, probe that one (the "walk").
 *                unknown → good enough, play it (playback is the ground
 *                truth; the switch timeout is the safety net). The whole
 *                walk is budget-capped so a slow probe never delays startup.
 *   4. READY   — consumers mount the head. The player probes the remaining
 *                links itself at play time (for the picker + fallback), so
 *                the pipeline stops here — probing everything on the details
 *                page is wasted work: verdicts expire in 60–90 s anyway.
 *
 * The cache entry is NEVER consumed-away: it stays until TTL/LRU eviction,
 * so re-entering the same title is instant and late head-walk verdicts are
 * recorded for the next reader. Re-ranking with different user options
 * (language / caps) invalidates the entry and reruns the pipeline.
 */

import type { StreamLink } from "../components/player/streamTypes";
import type { ValidationResult } from "./streamValidator";
import { validateStreamUrl } from "./streamValidator";
import {
  selectBestStream,
  effectiveQuality,
  type PreferredLanguage,
} from "./streamSelector";
import { fetchDirectStreams } from "./directStreams";

export interface StreamCacheOptions {
  cellularMaxMB?: number;
  maxQuality?: string | null;
  preferredAudioLanguage?: PreferredLanguage;
  /** Who started this pipeline — appears in the [Flow] START line. */
  trigger?: "details" | "home-cw" | "watch" | "next-episode";
}

export interface StreamCacheResult {
  /** Links in recommendation order — FROZEN once handed out. */
  links: StreamLink[];
  /** Chain head: what will play (and what the "Best" badge mirrors). */
  bestIndex: number;
  /** True when the head's probe returned valid, false = unverified/unknown. */
  bestValidated: boolean;
  /** Per-URL probe outcomes gathered so far (head walk). */
  validationResults: Map<string, ValidationResult>;
  /** True when the walk probed every link and all were dead. */
  allDead: boolean;
  /** Human-readable reason the head was picked. */
  selectionReason: string;
  /** The connection cap (bytes) the chain was ranked against. */
  capBytes: number;
  prefetchedAt: number;
}

interface CacheEntry extends StreamCacheResult {
  expiresAt: number;
  /** Options the entry was ranked with — a change invalidates the ranking. */
  rankOptions: {
    cellularMaxMB: number;
    maxQuality: string | null;
    preferredAudioLanguage: PreferredLanguage;
  };
}

const CACHE = new Map<string, CacheEntry>();
const IN_FLIGHT = new Map<string, Promise<StreamCacheResult | null>>();

/**
 * Startup budget for the head walk. The champion's probe verdict normally
 * lands in well under a second; when it doesn't, we play unverified rather
 * than stall the user. Late verdicts are still recorded into the entry.
 */
const HEAD_WALK_BUDGET_MS = 2500;

const CACHE_TTL_MS = 45 * 60 * 1000; // links are presigned for 8 h
const MAX_ENTRIES = 8;

function getCacheKey(
  tmdbId: number,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): string {
  return `${mediaType}:${tmdbId}:s${season ?? 0}:e${episode ?? 0}`;
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [key, entry] of CACHE) {
    if (now >= entry.expiresAt) CACHE.delete(key);
  }
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

function normalizeOptions(options: StreamCacheOptions) {
  return {
    cellularMaxMB: options.cellularMaxMB ?? 3000,
    maxQuality: options.maxQuality ?? null,
    preferredAudioLanguage: options.preferredAudioLanguage ?? "auto",
  };
}

/**
 * Fetch → rank → probe the champion → ready. Concurrent callers for the same
 * key share one pipeline; a fresh entry with the same rank options returns
 * immediately.
 */
export async function prefetchStreams(
  tmdbId: number,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
  options: StreamCacheOptions = {},
): Promise<StreamCacheResult | null> {
  const cacheKey = getCacheKey(tmdbId, mediaType, season, episode);
  const rankOptions = normalizeOptions(options);

  purgeExpired();
  const cached = CACHE.get(cacheKey);
  if (
    cached &&
    Date.now() < cached.expiresAt &&
    cached.rankOptions.cellularMaxMB === rankOptions.cellularMaxMB &&
    cached.rankOptions.maxQuality === rankOptions.maxQuality &&
    cached.rankOptions.preferredAudioLanguage ===
      rankOptions.preferredAudioLanguage
  ) {
    const head = cached.links[cached.bestIndex];
    console.log(
      `[Flow] pipeline ${cacheKey}: cache HIT — head #${cached.bestIndex} ${head?.quality ?? "?"} verified=${cached.bestValidated}`,
    );
    return cached;
  }

  const existing = IN_FLIGHT.get(cacheKey);
  if (existing) {
    console.log(
      `[Flow] pipeline ${cacheKey}: joining in-flight run (${options.trigger ?? "unknown"})`,
    );
    return existing;
  }

  console.log(
    `[Flow] ▶ pipeline START ${cacheKey} (trigger=${options.trigger ?? "unknown"})`,
  );
  const startedAt = Date.now();
  const pipeline = runPipeline(
    cacheKey,
    tmdbId,
    mediaType,
    season,
    episode,
    rankOptions,
  )
    .finally(() => IN_FLIGHT.delete(cacheKey))
    .then((result) => {
      if (result)
        console.log(
          `[Flow] ■ pipeline DONE ${cacheKey} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — head #${result.bestIndex} verified=${result.bestValidated} allDead=${result.allDead}`,
        );
      return result;
    });
  IN_FLIGHT.set(cacheKey, pipeline);
  return pipeline;
}

async function runPipeline(
  cacheKey: string,
  tmdbId: number,
  mediaType: "movie" | "tv",
  season: number | undefined,
  episode: number | undefined,
  rankOptions: CacheEntry["rankOptions"],
): Promise<StreamCacheResult | null> {
  try {
    // ── 1. Fetch ──
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
      console.log(
        `[Flow] fetch ${cacheKey}: FAILED — ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
    if (rawLinks.length === 0) {
      console.log(`[Flow] fetch ${cacheKey}: 0 links — nothing to rank`);
      return null;
    }

    // ── 2. Rank (the array is frozen from here on) ──
    const selection = await selectBestStream(rawLinks, {
      cellularMaxMB: rankOptions.cellularMaxMB,
      maxQuality: rankOptions.maxQuality,
      preferredLanguage: rankOptions.preferredAudioLanguage,
      runtimeMinutes: mediaType === "tv" ? 45 : 120,
    });
    const links = selection.sortedLinks;
    const champion = links[0]; // chain head — bestIndex is always 0
    const champGb = (champion?._meta?.sizeBytes ?? 0) / 1e9;
    console.log(
      `[Flow] rank ${cacheKey}: ${rawLinks.length} → ${links.length} playable · ` +
        `head #0 = ${champion ? effectiveQuality(champion) : "?"} ` +
        `${champGb > 0 ? `${champGb.toFixed(2)}GB ` : ""}` +
        `(cap ${Math.round(selection.capBytes / 1e6)}MB) — ${selection.selectionReason}`,
    );

    // ── 3. Head walk — probe chain[0]; strike dead, advance, repeat ──
    const probedUrls = new Map<string, ValidationResult>();
    const head = await probeHeadWalk(links, 0, probedUrls);

    const result: StreamCacheResult = {
      links,
      bestIndex: head.index,
      bestValidated: head.validated,
      validationResults: probedUrls,
      allDead: head.allDead,
      selectionReason: selection.selectionReason,
      capBytes: selection.capBytes,
      prefetchedAt: Date.now(),
    };

    CACHE.set(cacheKey, {
      ...result,
      expiresAt: Date.now() + CACHE_TTL_MS,
      rankOptions,
    });
    purgeExpired();
    return result;
  } catch (error) {
    console.log(
      `[Flow] pipeline ${cacheKey}: crashed — ${error instanceof Error ? error.message : error}`,
    );
    return null;
  }
}

interface HeadVerdict {
  index: number;
  validated: boolean;
  allDead: boolean;
}

const sleep = (ms: number) => new Promise<null>((r) => setTimeout(r, ms, null));

/**
 * Probe the priority chain from `startIndex` (0 = the champion). The array
 * IS the chain — index 0 is what should play, index 1 is the next fallback,
 * so the walk simply advances through it. Only a DEAD verdict strikes a
 * candidate — unknown plays (playback is ground truth). The whole walk is
 * capped at HEAD_WALK_BUDGET_MS: when the budget runs out the current
 * candidate plays unverified and its in-flight probe keeps running, its
 * verdict recorded into `probedUrls` for the next reader.
 */
async function probeHeadWalk(
  links: StreamLink[],
  startIndex: number,
  probedUrls: Map<string, ValidationResult>,
): Promise<HeadVerdict> {
  const deadline = Date.now() + HEAD_WALK_BUDGET_MS;

  for (let idx = startIndex; idx < links.length; idx++) {
    const link = links[idx];
    const probe = validateStreamUrl(link.url);
    const remaining = deadline - Date.now();
    const settled =
      remaining > 0 ? await Promise.race([probe, sleep(remaining)]) : null;

    if (!settled) {
      // Budget spent — play this candidate unverified; record the late verdict.
      console.log(
        `[Flow] probe #${idx} (${effectiveQuality(link)}): budget ${HEAD_WALK_BUDGET_MS}ms hit — playing unverified`,
      );
      probe
        .then((r) => {
          probedUrls.set(link.url, r);
          console.log(
            `[Flow] probe #${idx}: late verdict ${r.outcome}${r.error ? ` (${r.error})` : ""}`,
          );
        })
        .catch(() => {});
      return { index: idx, validated: false, allDead: false };
    }

    probedUrls.set(link.url, settled);
    if (settled.outcome !== "dead") {
      console.log(
        `[Flow] probe #${idx} (${effectiveQuality(link)}) → ${settled.outcome} in ${settled.probeMs ?? "?"}ms`,
      );
      return {
        index: idx,
        validated: settled.outcome === "valid",
        allDead: false,
      };
    }
    console.log(
      `[Flow] probe #${idx} (${effectiveQuality(link)}) → DEAD (${settled.error ?? "?"}, ${settled.probeMs ?? "?"}ms) — strike, badge moves to #${idx + 1}`,
    );
  }

  console.log(
    `[Flow] head walk: every candidate from #${startIndex} probed dead — handing off to embed`,
  );
  return { index: startIndex, validated: false, allDead: true };
}

/** Drop the whole cache (player close, media change, "re-check all" flow). */
export function clearPrefetchCache(): void {
  CACHE.clear();
  IN_FLIGHT.clear();
}
