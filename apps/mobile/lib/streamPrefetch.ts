/**
 * Stream pipeline — the SINGLE source of truth for direct stream links.
 *
 * One pipeline per episode key (`tv:969681:s1:e1:providerId`), started from
 * the page where the user's intent forms (details, CW, watch) and consumed by
 * the watch screen. Concurrent callers for the same key join the same run.
 *
 * Stages (each logs one [Flow] line, in order):
 *   1. FETCH   — provider's on-device fetch (directStreams), timed.
 *   2. RANK    — provider's own selector (registry selection → generic ranker).
 *                The ranked array is FROZEN from here on.
 *   3. HEAD    — probe the champion alone; dead → strike, advance, budget-capped.
 *   4. READY   — consumers mount the head.
 *
 * FIX 2 (Phase 3A): on 0-links or fetch-fail, the pipeline CHAINS across other
 * direct providers (registry order after the preferred id). Each provider keeps
 * its OWN selector — the chain only iterates ids. Empty/fail results are
 * negative-cached (5 min). A successful chain also writes a `:resolved`
 * pointer so the next open hits regardless of which provider id the caller
 * asks for. Embed providers are never chained into. When the caller locks the
 * provider (user manual pick), the chain does not run.
 *
 * FIX 8: MAX_ENTRIES=32, pin the playing key against LRU eviction, empty
 * entries use EMPTY_TTL_MS.
 */

import type { StreamLink } from "../components/player/streamTypes";
import type { ValidationResult } from "./streamValidator";
import { validateStreamUrl } from "./streamValidator";
import { effectiveQuality, type PreferredLanguage } from "./streamSelector";
import {
  getProvider,
  getStreamSelector,
  getEnabledProviders,
  isDirectProvider,
} from "@filmsnaps/shared";
import { fetchDirectStreams } from "./directStreams";
import {
  noteDetailsPrefetch,
  notePipelineSettled,
  notePipelineStart,
} from "./watchPerfMismatch";
import {
  trackProviderFetchResult,
  trackProviderProbe,
} from "./telemetry";
import { bucketQuality } from "./telemetry/types";

/** [watchperf] — how the pipeline that feeds the player was obtained. */
export interface PipelineFeedMeta {
  mode: "hit" | "join" | "start";
  /** Epoch ms the pipeline run began (for ageMs vs watchEntry). */
  startedAt: number;
  cacheKey: string;
  providerId: string;
}

export interface StreamCacheOptions {
  /**
   * Registry direct-provider id the links belong to (e.g. "direct",
   * "spacedom"). Different providers produce different link pools, so the
   * cache is keyed per provider — sharing an entry would rank mixed pools.
   */
  providerId?: string;
  cellularMaxMB?: number;
  maxQuality?: string | null;
  preferredAudioLanguage?: PreferredLanguage;
  /** Who started this pipeline — appears in the [Flow] START line. */
  trigger?: "details" | "home-cw" | "watch" | "next-episode";
  /**
   * When true, never fall through to other direct providers (the user
   * manually picked this server). Empty/fail still negative-caches this id.
   */
  lockProvider?: boolean;
  /** Bypass a fresh cache entry and re-run the pipeline (TTL re-warm). */
  force?: boolean;
  /**
   * B3: real chain-stage events for the watch wait UI (trailing message is
   * null when the pipeline settles / a winner is chosen).
   */
  onStage?: (stage: ChainStage | null) => void;
  /** [watchperf] FIX 1 — mode + start time of the pipeline that answers. */
  onPipelineMeta?: (meta: PipelineFeedMeta) => void;
}

/** B3 — what the chain is doing while the user waits. */
export type ChainStage =
  | { type: "trying"; providerId: string }
  | { type: "fallback"; fromId: string; toId: string };

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
  /** Negative result: this provider returned no playable links (or failed). */
  empty?: boolean;
  /** Epoch ms this run STARTed (pipelineFeed ageMs vs watchEntry). */
  pipelineStartedAt?: number;
  /** Options the entry was ranked with — a change invalidates the ranking. */
  rankOptions: {
    providerId: string;
    cellularMaxMB: number;
    maxQuality: string | null;
    preferredAudioLanguage: PreferredLanguage;
  };
}

const CACHE = new Map<string, CacheEntry>();
const IN_FLIGHT = new Map<string, Promise<StreamCacheResult | null>>();
/** [watchperf] epoch ms each in-flight run STARTed (pipelineFeed ageMs). */
const IN_FLIGHT_STARTED_AT = new Map<string, number>();
/** B3: stage listeners for joiners of an in-flight pipeline run. */
const STAGE_LISTENERS = new Map<
  string,
  Set<(stage: ChainStage | null) => void>
>();
/** D4: joiner counts per running cacheKey — rank delivers early when > 0. */
const WAITERS = new Map<string, number>();
/** D4: early-handoff promise per key — joiners race it against the full run. */
const EARLY = new Map<
  string,
  {
    promise: Promise<StreamCacheResult | null>;
    resolve: (r: StreamCacheResult | null) => void;
  }
>();

/**
 * Startup budget for the head walk. The champion's probe verdict normally
 * lands in well under a second; when it doesn't, we play unverified rather
 * stall the user. Late verdicts are still recorded into the entry.
 */
const HEAD_WALK_BUDGET_MS = 2500;
/** E2: how long a waiter will sit on the head verdict before playing blind. */
const EAGER_VERDICT_GRACE_MS = 350;
/** E2: dead head strikes — at most this many candidates get the grace. */
const EAGER_MAX_CANDIDATES = 2;

const CACHE_TTL_MS = 45 * 60 * 1000; // links are presigned for 8 h
const EMPTY_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 32;

function providerLabel(id: string): string {
  const def = getProvider(id);
  return def?.displayName || def?.name || id;
}

/** B3 UI copy from real chain events (sequential windows only). */
export function chainStageMessage(stage: ChainStage | null): string | null {
  if (!stage) return null;
  if (stage.type === "trying") {
    return `Contacting ${providerLabel(stage.providerId)}…`;
  }
  return `${providerLabel(stage.fromId)} didn't respond — trying ${providerLabel(stage.toId)}…`;
}

/** Playing cache key — never LRU-evicted while pinned (FIX 8). */
let pinnedCacheKey: string | null = null;

function getCacheKey(
  tmdbId: number,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
  providerId?: string,
): string {
  return `${mediaType}:${tmdbId}:s${season ?? 0}:e${episode ?? 0}:${providerId ?? "direct"}`;
}

function getResolvedKey(
  tmdbId: number,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): string {
  return `${mediaType}:${tmdbId}:s${season ?? 0}:e${episode ?? 0}:resolved`;
}

/** Pin the key of the entry currently on screen so LRU cannot drop it. */
export function pinPrefetchKey(key: string | null): void {
  pinnedCacheKey = key;
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
      if (key === pinnedCacheKey) continue;
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
    providerId: options.providerId ?? "direct",
    cellularMaxMB: options.cellularMaxMB ?? 3000,
    maxQuality: options.maxQuality ?? null,
    preferredAudioLanguage: options.preferredAudioLanguage ?? "auto",
  };
}

function rankOptionsMatch(
  cached: CacheEntry,
  rankOptions: CacheEntry["rankOptions"],
): boolean {
  return (
    cached.rankOptions.providerId === rankOptions.providerId &&
    cached.rankOptions.cellularMaxMB === rankOptions.cellularMaxMB &&
    cached.rankOptions.maxQuality === rankOptions.maxQuality &&
    cached.rankOptions.preferredAudioLanguage ===
      rankOptions.preferredAudioLanguage
  );
}

/** Direct providers for the chain: preferred id first, then registry order. */
function buildProviderChain(preferred: string): string[] {
  const directIds = getEnabledProviders()
    .filter((p) => isDirectProvider(p))
    .map((p) => p.id);
  const rest = directIds.filter((id) => id !== preferred);
  return [preferred, ...rest];
}

function writeNegative(
  cacheKey: string,
  rankOptions: CacheEntry["rankOptions"],
): void {
  CACHE.set(cacheKey, {
    links: [],
    bestIndex: 0,
    bestValidated: false,
    validationResults: new Map(),
    allDead: false,
    selectionReason: "empty",
    capBytes: 0,
    prefetchedAt: Date.now(),
    empty: true,
    expiresAt: Date.now() + EMPTY_TTL_MS,
    rankOptions,
  });
}

function storeSuccess(
  cacheKey: string,
  result: StreamCacheResult,
  rankOptions: CacheEntry["rankOptions"],
  pipelineStartedAt?: number,
): void {
  CACHE.set(cacheKey, {
    ...result,
    expiresAt: Date.now() + CACHE_TTL_MS,
    pipelineStartedAt: pipelineStartedAt ?? result.prefetchedAt,
    rankOptions,
  });
}

/**
 * Sync peek for a fresh positive entry — no network. Returns null on miss,
 * expired, rank mismatch, or a negative (empty) entry.
 */
export function peekPrefetchStreams(
  tmdbId: number,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
  options: StreamCacheOptions = {},
): StreamCacheResult | null {
  const rankOptions = normalizeOptions(options);
  purgeExpired();

  const exact = CACHE.get(
    getCacheKey(tmdbId, mediaType, season, episode, rankOptions.providerId),
  );
  if (
    exact &&
    !exact.empty &&
    Date.now() < exact.expiresAt &&
    rankOptionsMatch(exact, rankOptions)
  ) {
    return exact;
  }

  // Resolved pointer: chain won under a different provider than the caller asked for.
  const resolved = CACHE.get(getResolvedKey(tmdbId, mediaType, season, episode));
  if (
    resolved &&
    !resolved.empty &&
    Date.now() < resolved.expiresAt &&
    resolved.rankOptions.cellularMaxMB === rankOptions.cellularMaxMB &&
    resolved.rankOptions.maxQuality === rankOptions.maxQuality &&
    resolved.rankOptions.preferredAudioLanguage ===
      rankOptions.preferredAudioLanguage
  ) {
    return resolved;
  }
  return null;
}

/** Age of a positive cache entry in ms, or null if miss/expired/empty. */
export function getPrefetchAgeMs(
  tmdbId: number,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
  options: StreamCacheOptions = {},
): number | null {
  const snap = peekPrefetchStreams(tmdbId, mediaType, season, episode, options);
  return snap ? Date.now() - snap.prefetchedAt : null;
}

// ── Details → watch handoff (FIX 5) ──────────────────────────────────────────

interface StreamHandoff {
  tmdbId: number;
  mediaType: "movie" | "tv";
  season?: number;
  episode?: number;
  providerId: string;
  result: StreamCacheResult;
  at: number;
}

let streamHandoff: StreamHandoff | null = null;
const HANDOFF_TTL_MS = 90_000;

/**
 * Record the snapshot the details page already has so watch can mount the
 * head without waiting on its own pipeline turn (still runs trigger=watch
 * in the background to confirm / re-validate).
 */
export function setStreamHandoff(
  tmdbId: number,
  mediaType: "movie" | "tv",
  season: number | undefined,
  episode: number | undefined,
  providerId: string,
  result: StreamCacheResult,
): void {
  streamHandoff = {
    tmdbId,
    mediaType,
    season,
    episode,
    providerId,
    result,
    at: Date.now(),
  };
}

export function peekStreamHandoff(
  tmdbId: number,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): StreamHandoff | null {
  if (!streamHandoff) return null;
  if (Date.now() - streamHandoff.at > HANDOFF_TTL_MS) {
    streamHandoff = null;
    return null;
  }
  if (
    streamHandoff.tmdbId !== tmdbId ||
    streamHandoff.mediaType !== mediaType ||
    (streamHandoff.season ?? 0) !== (season ?? 0) ||
    (streamHandoff.episode ?? 0) !== (episode ?? 0)
  ) {
    return null;
  }
  return streamHandoff;
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
  const cacheKey = getCacheKey(
    tmdbId,
    mediaType,
    season,
    episode,
    options.providerId,
  );
  const rankOptions = normalizeOptions(options);
  const reportMeta = (mode: PipelineFeedMeta["mode"], startedAt: number) => {
    options.onPipelineMeta?.({
      mode,
      startedAt,
      cacheKey,
      providerId: rankOptions.providerId,
    });
  };
  // [watchperf] FIX 3a — details prefetch declares which provider it warmed.
  if (options.trigger === "details") {
    noteDetailsPrefetch(
      mediaType,
      tmdbId,
      season,
      episode,
      rankOptions.providerId,
    );
  }

  purgeExpired();

  if (!options.force) {
    // Exact key (positive or negative).
    const cached = CACHE.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt && rankOptionsMatch(cached, rankOptions)) {
      if (cached.empty) {
        // Locked/empty hit: still allow chain when not locked.
        if (options.lockProvider) {
          console.log(`[Flow] pipeline ${cacheKey}: cache HIT — empty (negative)`);
          reportMeta("hit", cached.pipelineStartedAt ?? cached.prefetchedAt);
          return null;
        }
      } else {
        const head = cached.links[cached.bestIndex];
        console.log(
          `[Flow] pipeline ${cacheKey}: cache HIT — head #${cached.bestIndex} ${head?.quality ?? "?"} verified=${cached.bestValidated}`,
        );
        reportMeta("hit", cached.pipelineStartedAt ?? cached.prefetchedAt);
        return cached;
      }
    }

    // Resolved pointer covers cross-id hits after a chain win.
    const resolved = CACHE.get(getResolvedKey(tmdbId, mediaType, season, episode));
    if (
      resolved &&
      !resolved.empty &&
      Date.now() < resolved.expiresAt &&
      resolved.rankOptions.cellularMaxMB === rankOptions.cellularMaxMB &&
      resolved.rankOptions.maxQuality === rankOptions.maxQuality &&
      resolved.rankOptions.preferredAudioLanguage ===
        rankOptions.preferredAudioLanguage
    ) {
      console.log(
        `[Flow] pipeline ${cacheKey}: cache HIT via resolved → ${resolved.rankOptions.providerId}`,
      );
      reportMeta("hit", resolved.pipelineStartedAt ?? resolved.prefetchedAt);
      return resolved;
    }
  }

  const existing = IN_FLIGHT.get(cacheKey);
  if (existing) {
    console.log(
      `[Flow] pipeline ${cacheKey}: joining in-flight run (${options.trigger ?? "unknown"})`,
    );
    reportMeta("join", IN_FLIGHT_STARTED_AT.get(cacheKey) ?? Date.now());
    notePipelineStart(
      mediaType,
      tmdbId,
      season,
      episode,
      rankOptions.providerId,
      options.trigger,
      "join",
    );
    // B3: joiners also receive the running pipeline's stage events.
    if (options.onStage) {
      const listeners = STAGE_LISTENERS.get(cacheKey);
      if (listeners) listeners.add(options.onStage);
      else STAGE_LISTENERS.set(cacheKey, new Set([options.onStage]));
      void existing.finally(() => {
        const set = STAGE_LISTENERS.get(cacheKey);
        set?.delete(options.onStage!);
        if (set && set.size === 0) STAGE_LISTENERS.delete(cacheKey);
      });
    }
    // D4: count as a waiter so a rank that lands mid-fetch delivers early
    // (unverified head) instead of holding this joiner for the full probe.
    WAITERS.set(cacheKey, (WAITERS.get(cacheKey) ?? 0) + 1);
    const early = EARLY.get(cacheKey);
    const joinPromise = (async () => {
      try {
        if (early) {
          // Race the early rank handoff against the full run. Early wins only
          // when it yields ≥1 unverified link; a null/empty early settles to
          // the full pipeline result.
          const winner = await Promise.race([
            early.promise.then((r) =>
              r && r.links.length > 0 ? r : null,
            ),
            existing.then(() => null),
          ]);
          if (winner) return winner;
        }
        return await existing;
      } finally {
        const n = (WAITERS.get(cacheKey) ?? 1) - 1;
        if (n <= 0) WAITERS.delete(cacheKey);
        else WAITERS.set(cacheKey, n);
      }
    })();
    return joinPromise;
  }

  console.log(
    `[Flow] ▶ pipeline START ${cacheKey} (trigger=${options.trigger ?? "unknown"}${options.lockProvider ? " lock" : ""}${options.force ? " force" : ""})`,
  );
  const startedAt = Date.now();
  reportMeta("start", startedAt);
  notePipelineStart(
    mediaType,
    tmdbId,
    season,
    episode,
    rankOptions.providerId,
    options.trigger,
    "start",
  );
  const primaryOnStage = options.onStage;
  const emitStage = (s: ChainStage | null) => {
    primaryOnStage?.(s);
    const listeners = STAGE_LISTENERS.get(cacheKey);
    if (!listeners) return;
    for (const fn of listeners) {
      if (fn !== primaryOnStage) fn(s);
    }
  };
  if (primaryOnStage) STAGE_LISTENERS.set(cacheKey, new Set([primaryOnStage]));

  // D4/E2: early-handoff channel for this run — resolved at RANK when a waiter
  // is present. E2 waits ≤350ms for the head verdict (advancing past a DEAD
  // head, max 2 candidates) instead of always delivering unverified; the
  // full pipeline's finally still settles a still-pending race with null.
  let resolveEarly!: (r: StreamCacheResult | null) => void;
  const earlyPromise = new Promise<StreamCacheResult | null>((res) => {
    resolveEarly = res;
  });
  EARLY.set(cacheKey, { promise: earlyPromise, resolve: resolveEarly });
  const onRanked = (early: StreamCacheResult) => {
    const waiters = WAITERS.get(cacheKey) ?? 0;
    if (waiters <= 0) return;
    // Fire-and-forget: probeHeadWalk must not wait on the grace loop (they
    // share inFlightProbes for the same URLs).
    void (async () => {
      try {
        resolveEarly(await graceDeliverHead(early));
      } catch {
        resolveEarly(early);
      }
    })();
  };

  const pipeline = runPipeline(
    cacheKey,
    tmdbId,
    mediaType,
    season,
    episode,
    rankOptions,
    options.lockProvider === true,
    emitStage,
    startedAt,
    onRanked,
  )
    .finally(() => {
      IN_FLIGHT.delete(cacheKey);
      IN_FLIGHT_STARTED_AT.delete(cacheKey);
      STAGE_LISTENERS.delete(cacheKey);
      WAITERS.delete(cacheKey);
      const e = EARLY.get(cacheKey);
      // Full run done — settle any still-pending early race with the final.
      if (e) e.resolve(null);
      EARLY.delete(cacheKey);
    })
    .then((result) => {
      if (result)
        console.log(
          `[Flow] ■ pipeline DONE ${cacheKey} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — head #${result.bestIndex} verified=${result.bestValidated} allDead=${result.allDead}`,
        );
      notePipelineSettled(
        mediaType,
        tmdbId,
        season,
        episode,
        rankOptions.providerId,
        !!result && result.links.length > 0,
      );
      // Settle early waiters that raced the full result (no-op if already
      // resolved at RANK).
      const e = EARLY.get(cacheKey);
      e?.resolve(result);
      return result;
    });
  IN_FLIGHT.set(cacheKey, pipeline);
  IN_FLIGHT_STARTED_AT.set(cacheKey, startedAt);
  return pipeline;
}

/**
 * Strict sequential chain: the preferred provider runs alone to completion.
 * Advance only on hard fetch failure or 0 links (negative-cached results
 * skip without fetching). Never starts a second provider while one is
 * in-flight. Embeds are never chained (unchanged). The legacy "direct"
 * provider still merges hdhub∥falix *inside* fetchDirectStreams — that
 * pre-existing single-provider merge is intentional and stays.
 */
async function runPipeline(
  cacheKey: string,
  tmdbId: number,
  mediaType: "movie" | "tv",
  season: number | undefined,
  episode: number | undefined,
  rankOptions: CacheEntry["rankOptions"],
  lockProvider: boolean,
  onStage?: (stage: ChainStage | null) => void,
  pipelineStartedAt?: number,
  /** D4: fire once when RANK finishes with ≥1 link and a waiter is present. */
  onRanked?: (early: StreamCacheResult) => void,
): Promise<StreamCacheResult | null> {
  const chain = lockProvider
    ? [rankOptions.providerId]
    : buildProviderChain(rankOptions.providerId);

  const providerKeyFor = (providerId: string) =>
    getCacheKey(tmdbId, mediaType, season, episode, providerId);
  const rankFor = (providerId: string): CacheEntry["rankOptions"] => ({
    ...rankOptions,
    providerId,
  });

  const isNegativeFresh = (providerId: string): boolean => {
    const neg = CACHE.get(providerKeyFor(providerId));
    return (
      !!neg?.empty &&
      Date.now() < neg.expiresAt &&
      neg.rankOptions.cellularMaxMB === rankOptions.cellularMaxMB &&
      neg.rankOptions.maxQuality === rankOptions.maxQuality &&
      neg.rankOptions.preferredAudioLanguage ===
        rankOptions.preferredAudioLanguage
    );
  };

  const storeWinner = (
    providerId: string,
    result: StreamCacheResult,
  ): void => {
    const providerKey = providerKeyFor(providerId);
    storeSuccess(providerKey, result, rankFor(providerId), pipelineStartedAt);
    if (providerKey !== cacheKey) {
      storeSuccess(cacheKey, result, rankOptions, pipelineStartedAt);
      storeSuccess(
        getResolvedKey(tmdbId, mediaType, season, episode),
        result,
        { ...rankOptions, providerId },
        pipelineStartedAt,
      );
      console.log(
        `[Flow] chain ${cacheKey}: resolved via ${providerId} — wrote :resolved pointer`,
      );
    }
    purgeExpired();
  };

  // Preferred provider first; remaining direct providers in registry order.
  let startedAny = false;
  let lastAttempted: string | null = null;

  for (let i = 0; i < chain.length; i++) {
    const providerId = chain[i];
    if (isNegativeFresh(providerId)) {
      console.log(
        `[Flow] chain ${cacheKey}: skip ${providerId} (negative cache)`,
      );
      lastAttempted = providerId;
      continue;
    }
    if (!startedAny) {
      onStage?.({ type: "trying", providerId });
      startedAny = true;
    } else {
      onStage?.({
        type: "fallback",
        fromId: lastAttempted ?? chain[i - 1],
        toId: providerId,
      });
      console.log(
        `[Flow] chain ${cacheKey}: falling through → ${providerId} (kept own selector)`,
      );
    }
    lastAttempted = providerId;

    const result = await runSingleProvider(
      providerKeyFor(providerId),
      tmdbId,
      mediaType,
      season,
      episode,
      rankFor(providerId),
      onRanked,
    );

    if (result && result.links.length > 0) {
      onStage?.(null);
      storeWinner(providerId, result);
      return result;
    }
    writeNegative(providerKeyFor(providerId), rankFor(providerId));
    if (providerKeyFor(providerId) !== cacheKey)
      writeNegative(cacheKey, rankOptions);
    console.log(
      `[Flow] chain ${cacheKey}: ${providerId} empty/fail — ${lockProvider ? "locked, stop" : "next provider"}`,
    );
    if (lockProvider) break;
  }

  onStage?.(null);
  purgeExpired();
  return null;
}

async function runSingleProvider(
  cacheKey: string,
  tmdbId: number,
  mediaType: "movie" | "tv",
  season: number | undefined,
  episode: number | undefined,
  rankOptions: CacheEntry["rankOptions"],
  onRanked?: (early: StreamCacheResult) => void,
): Promise<StreamCacheResult | null> {
  const fetchStartedAt = Date.now();
  try {
    // ── 1. Fetch ──
    let rawLinks: StreamLink[];
    let fetchMs: number;
    try {
      const bundle = await fetchDirectStreams(
        tmdbId,
        mediaType,
        season,
        episode,
        rankOptions.providerId,
      );
      rawLinks = bundle.links;
      fetchMs = Date.now() - fetchStartedAt;
    } catch (err) {
      console.log(
        `[Flow] fetch ${cacheKey}: FAILED — ${err instanceof Error ? err.message : err}`,
      );
      // Phase 4 T2 + E3 — provider_fetch FAILED (capBucket auto-resolved).
      trackProviderFetchResult({
        providerId: rankOptions.providerId,
        tmdbId,
        mediaType,
        linkCount: 0,
        fetchMs: Date.now() - fetchStartedAt,
        failed: true,
      });
      return null;
    }
    if (rawLinks.length === 0) {
      console.log(`[Flow] fetch ${cacheKey}: 0 links — nothing to rank`);
      return null;
    }

    // ── 2. Rank with THIS provider's own selector (chain never mixes pools) ──
    const providerDef = rankOptions.providerId
      ? getProvider(rankOptions.providerId)
      : undefined;
    const selection = await getStreamSelector(providerDef?.selection).select(
      rawLinks,
      {
        cellularMaxMB: rankOptions.cellularMaxMB,
        maxQuality: rankOptions.maxQuality,
        preferredLanguage: rankOptions.preferredAudioLanguage,
        runtimeMinutes: mediaType === "tv" ? 45 : 120,
      },
    );
    const links = selection.sortedLinks;
    const champion = links[0];
    const champGb = (champion?._meta?.sizeBytes ?? 0) / 1e9;
    console.log(
      `[Flow] rank ${cacheKey}: ${rawLinks.length} → ${links.length} playable · ` +
        `head #0 = ${champion ? effectiveQuality(champion) : "?"} ` +
        `${champGb > 0 ? `${champGb.toFixed(2)}GB ` : ""}` +
        `(cap ${Math.round(selection.capBytes / 1e6)}MB) — ${selection.selectionReason}`,
    );

    // Phase 4 T2 + E3 — provider_fetch OK after ranking, so the event can carry
    // the champion's chosen quality bucket (capBucket is auto-resolved).
    trackProviderFetchResult({
      providerId: rankOptions.providerId,
      tmdbId,
      mediaType,
      linkCount: rawLinks.length,
      fetchMs,
      chosenQualityBucket: champion ? bucketQuality(effectiveQuality(champion)) : undefined,
    });

    // D4/E2: hand the SAME validationResults map the head walk will fill —
    // the grace loop and probeHeadWalk share inFlightProbes per URL, so late
    // verdicts land on the object the waiter already holds.
    const probedUrls = new Map<string, ValidationResult>();
    if (onRanked && links.length > 0) {
      onRanked({
        links,
        bestIndex: 0,
        bestValidated: false,
        validationResults: probedUrls,
        allDead: false,
        selectionReason: selection.selectionReason,
        capBytes: selection.capBytes,
        prefetchedAt: Date.now(),
      });
    }

    // ── 3. Head walk ──
    const head = await probeHeadWalk(links, 0, probedUrls);

    // Phase 4 T2 — provider_fetch at head probe (probeMs + verdict).
    {
      const headLink = links[head.index];
      const headResult = headLink ? probedUrls.get(headLink.url) : undefined;
      trackProviderProbe({
        providerId: rankOptions.providerId,
        tmdbId,
        mediaType,
        probeMs: headResult?.probeMs,
        verdict: head.allDead
          ? "dead"
          : head.validated
            ? "valid"
            : "unverified",
      });
    }

    return {
      links,
      bestIndex: head.index,
      bestValidated: head.validated,
      validationResults: probedUrls,
      allDead: head.allDead,
      selectionReason: selection.selectionReason,
      capBytes: selection.capBytes,
      prefetchedAt: Date.now(),
    };
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
 * E2 — grace-deliver the ranked head to waiters.
 *
 * At RANK a waiter should not always play blind: race the head probe against
 * a short grace. DEAD strikes and advances (at most EAGER_MAX_CANDIDATES
 * probes total). A valid verdict delivers verified; timeout / exhausted
 * candidates deliver the best-known head unverified. Shares inFlightProbes
 * with probeHeadWalk (started right after onRanked returns), so the same
 * URL is never double-probed.
 */
async function graceDeliverHead(
  early: StreamCacheResult,
): Promise<StreamCacheResult> {
  const validationResults = early.validationResults;
  let bestIndex = early.bestIndex;
  let bestValidated = false;
  let logged = false;

  for (let attempt = 0; attempt < EAGER_MAX_CANDIDATES; attempt++) {
    const link = early.links[bestIndex];
    if (!link) break;

    const t0 = Date.now();
    const probe = validateStreamUrl(link.url, link.headers);
    const settled = await Promise.race([
      probe,
      sleep(EAGER_VERDICT_GRACE_MS),
    ]);
    const waited = Date.now() - t0;

    if (settled == null) {
      // Grace expired — late verdict still records into the shared map.
      const url = link.url;
      probe
        .then((r) => {
          validationResults.set(url, r);
        })
        .catch(() => {});
      console.log(`[Flow] eager handoff (waiter, grace expired) — unverified`);
      logged = true;
      break;
    }

    validationResults.set(link.url, settled);
    if (settled.outcome !== "dead") {
      bestValidated = settled.outcome === "valid";
      console.log(
        `[Flow] eager handoff (waiter, verdict waited ${waited}ms) — ${
          bestValidated ? "verified" : "unverified"
        }`,
      );
      logged = true;
      break;
    }

    // DEAD — strike and advance (grace repeats for at most 2 candidates).
    console.log(
      `[Flow] eager handoff: candidate #${bestIndex} dead in ${waited}ms — advancing`,
    );
    if (bestIndex + 1 >= early.links.length) break;
    bestIndex += 1;
  }

  if (!logged) {
    console.log(`[Flow] eager handoff (waiter, grace expired) — unverified`);
  }
  return {
    ...early,
    bestIndex,
    bestValidated,
    validationResults,
  };
}

/**
 * Probe the priority chain from `startIndex` (0 = the champion). Only a DEAD
 * verdict strikes a candidate — unknown plays (playback is ground truth).
 * Budget-capped so a slow probe never delays startup.
 */
async function probeHeadWalk(
  links: StreamLink[],
  startIndex: number,
  probedUrls: Map<string, ValidationResult>,
): Promise<HeadVerdict> {
  const deadline = Date.now() + HEAD_WALK_BUDGET_MS;

  for (let idx = startIndex; idx < links.length; idx++) {
    const link = links[idx];
    const probe = validateStreamUrl(link.url, link.headers);
    const remaining = deadline - Date.now();
    const settled =
      remaining > 0 ? await Promise.race([probe, sleep(remaining)]) : null;

    if (!settled) {
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
  streamHandoff = null;
  pinnedCacheKey = null;
  WAITERS.clear();
  for (const e of EARLY.values()) e.resolve(null);
  EARLY.clear();
}
