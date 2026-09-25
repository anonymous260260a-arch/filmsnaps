/**
 * Generic multi-source stream resolution pipeline.
 *
 * Reads the stream source config from a ProviderDefinition's streamSources[],
 * fetches each source via its adapter, and merges all streams into one pool.
 *
 * Resolution is TIERED by each source's `priority` (lower = better):
 *   - Sources sharing a tier are fetched in parallel.
 *   - Tiers resolve in ascending order; once a tier has produced at least
 *     `minPlayable` playable links, later tiers are skipped entirely.
 *   - A tier that settles (or times out) short of its threshold escalates to
 *     the next tier.
 *   - A source that misses its per-source `timeoutMs` deadline is not
 *     discarded: if its fetch lands during the grace window its links still
 *     join the pool (slow ≠ dead).
 * With no priorities (the default tier 1) every source fetches in parallel —
 * exactly the legacy behavior.
 *
 * This eliminates the per-platform duplication of HDHub/Falix fetching logic.
 * Platforms only need to:
 *   1. Resolve the IMDB id (platform-specific: server proxy vs on-device)
 *   2. Call resolveStreams() with the provider config
 *   3. Use selectBestStream() to pick the champion
 */
import { getStreamSourceAdapter } from "./sources/index";
import type { StreamLink, StreamSourceConfig } from "./sources/types";

export interface ResolveStreamsParams {
  /** The provider's stream source configurations */
  streamSources: StreamSourceConfig[];
  /** IMDB id of the title (empty string when the upstream keys by TMDB) */
  imdbId: string;
  /** TMDB id — used by urlTemplate-based upstreams (e.g. spacedom) */
  tmdbId?: number;
  /** Media type */
  mediaType: "movie" | "tv";
  /** Season number (TV only) */
  season?: number;
  /** Episode number (TV only) */
  episode?: number;
  /** How to merge streams from multiple sources */
  mergeStrategy?: "concat" | "interleave";
  /**
   * Platform playability predicate — links failing it count as 0 playable
   * (so tier escalation still kicks in) and are dropped from the pool.
   * Example: the web cannot attach a Referer to media requests, so it
   * filters out header-gated links. Unset = keep everything.
   */
  linkFilter?: (link: StreamLink) => boolean;
}

export interface ResolveStreamsResult {
  /** All streams from all sources, merged */
  links: StreamLink[];
  /** Which sources were successfully fetched */
  fetchedSources: string[];
  /** Which sources failed, timed out, or came up empty */
  failedSources: Array<{
    id: string;
    error: string;
  }>;
}

/**
 * How long a source the tier loop stopped waiting on may still land and
 * join the pool. Covers escalated-past tiers and per-source timeouts.
 */
const GRACE_WINDOW_MS = 2_500;
const POLL_MS = 150;

/**
 * Build a source's request URL from its urlTemplate / urlTemplateTv.
 * Placeholders: {tmdbId} {imdbId} {type} {season} {episode}. For movies the
 * trailing query (which only carried season/episode) is stripped. Returns
 * null when the source has no template — the platform fetcher owns URL
 * building for catalog-style APIs.
 */
export function buildStreamSourceUrl(
  source: StreamSourceConfig,
  params: Pick<
    ResolveStreamsParams,
    "imdbId" | "tmdbId" | "mediaType" | "season" | "episode"
  >,
): string | null {
  const template =
    params.mediaType === "tv"
      ? (source.urlTemplateTv ?? source.urlTemplate)
      : (source.urlTemplate ?? source.urlTemplateTv);
  if (!template) return null;
  let url = template
    .replace(/\{tmdbId\}/g, String(params.tmdbId ?? ""))
    .replace(/\{imdbId\}/g, params.imdbId ?? "")
    .replace(/\{type\}/g, params.mediaType);
  if (params.mediaType === "tv") {
    url = url
      .replace(/\{season\}/g, String(params.season ?? 1))
      .replace(/\{episode\}/g, String(params.episode ?? 1));
  } else {
    // Strip trailing query if it was only carrying season/episode
    // placeholders (the Spacedom pattern). Keep query params that have
    // other real values (Way2Movies uses ?imdb_id=…&title=…).
    const qIdx = url.indexOf("?");
    if (qIdx > 0) {
      const qs = url.slice(qIdx);
      // Only strip if the query has no real key=value pairs — just
      // leftover placeholders or empty params.
      const hasRealParams =
        /[?&][^={]+=[^}&]+/.test(qs) && !/\{[^}]+\}/.test(qs);
      if (!hasRealParams) url = url.slice(0, qIdx);
    }
  }
  return url;
}

/**
 * Resolve streams from all configured sources for a provider.
 *
 * Each source is fetched independently — a failure or timeout in one source
 * never blocks the others. See the module doc for the tiering rules.
 *
 * @param params - Resolution parameters
 * @param fetchFn - Platform-specific fetch function (web uses server-side
 *   fetch, mobile uses direct on-device fetch). Implementations may use
 *   buildStreamSourceUrl() for template-based sources.
 */
export async function resolveStreams(
  params: ResolveStreamsParams,
  fetchFn: (
    source: StreamSourceConfig,
    context: {
      imdbId: string;
      tmdbId?: number;
      mediaType: "movie" | "tv";
      season?: number;
      episode?: number;
    },
  ) => Promise<unknown>,
): Promise<ResolveStreamsResult> {
  const { streamSources, imdbId, mediaType, mergeStrategy = "concat" } = params;

  const enabledSources = streamSources.filter((s) => s.enabled);
  if (enabledSources.length === 0) {
    return { links: [], fetchedSources: [], failedSources: [] };
  }

  // ── Group into priority tiers (ascending; missing priority = tier 1) ──
  const tiers = new Map<number, StreamSourceConfig[]>();
  for (const source of enabledSources) {
    const tier = source.priority ?? 1;
    const arr = tiers.get(tier) ?? [];
    arr.push(source);
    tiers.set(tier, arr);
  }
  const tierKeys = [...tiers.keys()].sort((a, b) => a - b);

  const allLinks: StreamLink[] = [];
  const fetchedSources: string[] = [];
  const failedSources: Array<{ id: string; error: string }> = [];
  const recorded = new Set<string>();
  /** Sources whose fetch actually started (skipped tiers never launch). */
  const launched = new Set<string>();
  /** Once closed, late fetch results are dropped — the pool is final. */
  let closed = false;

  /** Record one settled source (idempotent — records at most once). */
  function record(
    source: StreamSourceConfig,
    outcome: { links?: StreamLink[]; error?: string },
  ): void {
    if (closed || recorded.has(source.id)) return;
    recorded.add(source.id);
    if (outcome.links && outcome.links.length > 0) {
      allLinks.push(...outcome.links);
      fetchedSources.push(source.id);
    } else {
      failedSources.push({
        id: source.id,
        error: outcome.error ?? "no streams for this title",
      });
    }
  }

  /** True when the last examined tier met its playable threshold. */
  let satisfied = false;

  fetchLoop: for (const tierKey of tierKeys) {
    const tierSources = tiers.get(tierKey)!;
    const tierThreshold = Math.max(
      0,
      ...tierSources.map((s) => s.minPlayable ?? 1),
    );

    // Playable-link count per source of this tier — the satisfaction check.
    const linkCounts = new Map<string, number>(
      tierSources.map((s) => [s.id, 0]),
    );
    const tierLinks = () =>
      tierSources.reduce((n, s) => n + (linkCounts.get(s.id) ?? 0), 0);

    // Launch every source of the tier in parallel. record() fires inside the
    // task, so a source that lands after the tier moved on (escalation or a
    // rival source hit the threshold) still joins the pool during the grace
    // window at the end.
    const tasks = tierSources.map(async (source) => {
      launched.add(source.id);
      const attempts = 1 + Math.max(0, source.retries ?? 0);
      const retryDelay = source.retryDelayMs ?? 800;
      const context = {
        imdbId,
        tmdbId: params.tmdbId,
        mediaType,
        season: params.season,
        episode: params.episode,
      };
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const raw = await fetchFn(source, context);
          const adapter = getStreamSourceAdapter(source.adapter ?? source.id);
          const parsed = adapter.parseResponse(raw, {
            imdbId,
            mediaType,
            season: params.season,
            episode: params.episode,
            sourceId: source.id,
          });
          const links = params.linkFilter
            ? parsed.filter(params.linkFilter)
            : parsed;
          // An empty pool is only final on the last attempt — some upstreams
          // flake on the first request and answer on the retry.
          if (links.length > 0 || attempt === attempts) {
            record(source, { links });
            linkCounts.set(source.id, links.length);
            return;
          }
        } catch (err) {
          if (attempt === attempts) {
            record(source, {
              error: err instanceof Error ? err.message : String(err),
            });
            return;
          }
        }
        await sleep(retryDelay);
      }
    });

    // Each task raced against its own timeout. On timeout the tier stops
    // WAITING for that source, but the underlying fetch keeps running — if
    // it lands within the grace window its record() still counts.
    const waits = tasks.map((task, i) =>
      Promise.race([
        task,
        sleep(tierSources[i].timeoutMs ?? 0).then(() => undefined),
      ]),
    );

    satisfied = false;
    while (true) {
      if (tierThreshold > 0 && tierLinks() >= tierThreshold) {
        satisfied = true;
        break;
      }
      const allSettled = await Promise.race([
        Promise.all(waits).then(() => true),
        sleep(POLL_MS).then(() => false),
      ]);
      if (allSettled) {
        // The tier finished settling — the last response may itself have
        // crossed the threshold, so re-check before escalating.
        satisfied = tierThreshold > 0 && tierLinks() >= tierThreshold;
        break;
      }
    }
    if (satisfied) break fetchLoop;
    // Tier short or timed out — escalate to the next tier. Tasks keep
    // running; late results still record (and count) after escalation.
  }

  // Grace window: give escalated-past / timed-out fetches a final chance to
  // land before the pool is handed to the ranker.
  // FIX 10: when the threshold was already satisfied, skip the full grace —
  // we have enough playable links; late landers during a short tail still
  // merge via record() until closed. Escalation paths keep the full window.
  const graceMs = satisfied ? 400 : GRACE_WINDOW_MS;
  const graceDeadline = Date.now() + graceMs;
  const stillPending = () =>
    enabledSources.filter((s) => launched.has(s.id) && !recorded.has(s.id))
      .length;
  while (stillPending() > 0 && Date.now() < graceDeadline) {
    await sleep(POLL_MS);
  }
  closed = true;
  for (const source of enabledSources) {
    if (launched.has(source.id) && !recorded.has(source.id)) {
      failedSources.push({ id: source.id, error: "timed out" });
    }
  }

  // Merge strategy
  if (mergeStrategy === "interleave" && enabledSources.length > 1) {
    return {
      links: interleaveLinks(allLinks, enabledSources),
      fetchedSources,
      failedSources,
    };
  }

  // Default: concat (tier order → declaration order within a tier, so the
  // array handed to the ranker still reflects source priority).
  return { links: allLinks, fetchedSources, failedSources };
}

const sleep = (ms: number) =>
  new Promise<undefined>((r) => setTimeout(r, ms, undefined));

/**
 * Interleave streams from multiple sources round-robin.
 * Ensures variety in the initial ranking.
 */
function interleaveLinks(
  links: StreamLink[],
  sources: StreamSourceConfig[],
): StreamLink[] {
  const bySource = new Map<string, StreamLink[]>();
  for (const link of links) {
    const source = link._meta?.source ?? "unknown";
    const arr = bySource.get(source) ?? [];
    arr.push(link);
    bySource.set(source, arr);
  }

  const result: StreamLink[] = [];
  const sourceKeys = sources.map((s) => s.id);
  let added = true;
  while (added) {
    added = false;
    for (const key of sourceKeys) {
      const arr = bySource.get(key);
      if (arr && arr.length > 0) {
        result.push(arr.shift()!);
        added = true;
      }
    }
  }
  return result;
}
