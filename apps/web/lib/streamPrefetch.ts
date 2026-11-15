/**
 * streamPrefetch — the direct-provider chain (web port of mobile's
 * lib/streamPrefetch.ts + lib/directStreams.ts chain).
 *
 * Mobile's pipeline, which this mirrors:
 *   1. Detail pages warm the chain on mount (prefetch).
 *   2. Hops: the preferred direct provider first, then every other enabled
 *      direct provider available on the platform (registry order, anime-only
 *      excluded). Registry providers resolve their OWN streamSources through
 *      the shared tiered pipeline — server-side here via the /api/player/
 *      direct proxy's `provider=` branch; the legacy "direct" hop is the
 *      hdhub+falix parallel pipeline.
 *   3. A hop that fails or yields zero links hands off to the next one. The
 *      chain surfaces an error only when EVERY hop is exhausted (negative
 *      cache prevents re-hammering dead providers on every keystroke).
 *   4. The winner's top links are background-probed into the shared verdict
 *      cache so the watch page's first probe reads from cache.
 *
 * The player (DirectVideoPlayer) joins the in-flight run or reads the cached
 * winner instead of refetching — same contract as mobile's
 * prefetchStreams/peekPrefetchStreams pair.
 */

import {
  getEnabledProviders,
  getProvider,
  isDirectProvider,
  isProviderAvailableOn,
  resolveInitialProviderId,
} from "@filmsnaps/shared";
import { apiUrl } from "./tmdb";
import { isElectronNow } from "./platform";
import { getSettings } from "@/hooks/useSettings";
import { probeUrls } from "./probeCache";
import { selectBestStream, type StreamEntry } from "./streamSelector";

const WINNER_TTL_MS = 5 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000;
/** How many top-ranked candidates to background-probe per chain winner. */
const PROBE_TOP_N = 3;

export interface DirectChainData {
  tmdb_id?: number;
  imdb_id?: string;
  media_type?: string;
  links?: StreamEntry[];
  seasons?: unknown[];
}

export interface DirectChainWinner {
  /** The provider whose pool won the chain — may differ from the preferred one. */
  providerId: string;
  data: DirectChainData;
}

interface ChainKeyArgs {
  type: "movie" | "tv";
  id: string;
  season?: number;
  episode?: number;
}

const chainKey = ({ type, id, season, episode }: ChainKeyArgs) =>
  `${type}:${id}:${season ?? ""}:${episode ?? ""}`;

const winners = new Map<string, DirectChainWinner & { at: number }>();
const negatives = new Map<string, number>();
const inFlight = new Map<string, Promise<DirectChainWinner | null>>();

function purgeExpired(): void {
  const now = Date.now();
  winners.forEach((w, k) => {
    if (now - w.at > WINNER_TTL_MS) winners.delete(k);
  });
  negatives.forEach((at, k) => {
    if (now - at > NEGATIVE_TTL_MS) negatives.delete(k);
  });
}

/**
 * Direct providers for the chain, in walk order (mobile parity):
 * the preferred id first (when it is itself a direct provider available
 * here), then every other enabled direct provider in registry order.
 * anime-only providers never enter the generic chain (no MAL context).
 * The legacy "direct" hop (hdhub+falix) is included when it is the preferred
 * provider (the desktop app's default) or on Electron — Electron ignores the
 * registry's platform field, and its player's primary fetch IS that route.
 */
export function buildDirectProviderChain(preferred?: string | null): string[] {
  const electron = isElectronNow();
  const available = (id: string): boolean => {
    const def = getProvider(id);
    if (!def || !isDirectProvider(def) || def.animeOnly) return false;
    if (id === "direct") return electron || preferred === "direct";
    return isProviderAvailableOn(def, "web");
  };

  const directIds = getEnabledProviders()
    .filter((p) => available(p.id))
    .map((p) => p.id);

  const head = preferred && directIds.includes(preferred) ? [preferred] : [];
  const rest = directIds.filter((id) => id !== preferred);
  return [...head, ...rest];
}

/** One hop: fetch the route for a single provider (null = legacy pipeline). */
async function fetchHop(
  providerId: string | null,
  { type, id, season, episode }: ChainKeyArgs,
): Promise<DirectChainData | null> {
  const params = new URLSearchParams({ id });
  if (providerId && providerId !== "direct") params.set("provider", providerId);
  if (type === "tv" && season) params.set("season", String(season));
  if (type === "tv" && episode) params.set("episode", String(episode));

  try {
    const res = await fetch(apiUrl(`/api/player/direct?${params.toString()}`));
    if (!res.ok) return null;
    const data = (await res.json()) as DirectChainData | null;
    if (!data || typeof data !== "object") return null;
    // A hop with zero links counts as a failure — the chain moves on.
    if (!Array.isArray(data.links) || data.links.length === 0) return null;
    return data;
  } catch {
    return null;
  }
}

/** Rank the winner's links and probe the top candidates (cache warming). */
function warmProbes({ type }: ChainKeyArgs, data: DirectChainData): void {
  try {
    const links = (data.links ?? []) as StreamEntry[];
    if (links.length === 0) return;
    const selection = selectBestStream(links, {
      runtimeMinutes: type === "tv" ? 45 : 120,
    });
    const rankedUrls = selection.sortedLinks
      .map((l) => l.url)
      .filter(Boolean)
      .slice(0, PROBE_TOP_N);
    if (rankedUrls.length > 0) probeUrls(rankedUrls, () => {});
  } catch {
    /* probing is best-effort */
  }
}

/**
 * Resolve the preferred direct provider for a detail/watch session
 * (mobile resolvePlaybackProviderId parity, tiers 3+5: saved server then
 * platform default — the detail page has no route param or session pick).
 * Returns null when the winner is an embed: no direct pool to prefetch.
 */
export function resolvePreferredDirectProvider(anime?: boolean): string | null {
  const platform = isElectronNow() ? "desktop" : "web";
  const id = resolveInitialProviderId({
    platform,
    savedServer: getSettings().defaultServer || null,
    anime,
  });
  const def = getProvider(id);
  return def && isDirectProvider(def) ? def.id : null;
}

/**
 * Run (or join) the chain for a title. Resolves with the winning hop's
 * provider + data, or null when every provider is exhausted (negative-cached
 * for a minute so retries don't re-walk dead upstreams).
 */
export function runDirectChain(
  type: "movie" | "tv",
  id: string,
  season?: number,
  episode?: number,
  preferred?: string | null,
): Promise<DirectChainWinner | null> {
  const args: ChainKeyArgs = { type, id, season, episode };
  const k = chainKey(args);
  purgeExpired();

  const cachedWinner = winners.get(k);
  if (cachedWinner) return Promise.resolve(cachedWinner);
  if (negatives.has(k)) return Promise.resolve(null);

  const existing = inFlight.get(k);
  if (existing) return existing;

  const chain = buildDirectProviderChain(preferred);
  if (chain.length === 0) return Promise.resolve(null);

  const run = (async (): Promise<DirectChainWinner | null> => {
    for (const providerId of chain) {
      const data = await fetchHop(
        providerId === "direct" ? null : providerId,
        args,
      );
      if (data) {
        const winner = { providerId, data, at: Date.now() };
        winners.set(k, winner);
        negatives.delete(k);
        warmProbes(args, data);
        return winner;
      }
    }
    negatives.set(k, Date.now());
    return null;
  })();

  inFlight.set(k, run);
  void run.finally(() => {
    if (inFlight.get(k) === run) inFlight.delete(k);
  });
  return run;
}

/**
 * Fire-and-forget chain warmup — safe to call on every detail mount / card
 * hover; failures land in the negative cache and are swallowed.
 */
export function prefetchDirectChain(
  type: "movie" | "tv",
  id: string,
  season?: number,
  episode?: number,
  anime?: boolean,
): void {
  if (!id) return;
  const preferred = resolvePreferredDirectProvider(anime);
  // Mobile parity: an embed default means there is no direct pool to prefetch.
  if (!preferred && !isElectronNow()) return;
  void runDirectChain(type, id, season, episode, preferred);
}

/**
 * Peek a chain result without starting one — resolved winner, in-flight
 * promise, or undefined. The player uses this to reuse warm work.
 */
export function peekDirectChain(
  type: "movie" | "tv",
  id: string,
  season?: number,
  episode?: number,
): Promise<DirectChainWinner | null> | DirectChainWinner | undefined {
  const k = chainKey({ type, id, season, episode });
  purgeExpired();
  const cachedWinner = winners.get(k);
  if (cachedWinner) return cachedWinner;
  if (negatives.has(k)) return undefined;
  return inFlight.get(k);
}

/**
 * Drop the cached winner for a title — called when the player has exhausted
 * a provider's pool and hands off to the next one, so the stale (just-died)
 * pool can't be handed back by a later chainFallback run.
 *
 * The NEGATIVE cache is only cleared when a winner actually existed: the
 * link-exhaustion handoff must not resurrect a dead pool (a successful run
 * clears negatives itself, so there are none to keep), but the metadata
 * exhaustion handoff walks the remaining providers one fresh fetch at a
 * time — wiping negatives here would make every hop re-walk the whole chain
 * (O(N²) upstream calls for a title nobody has).
 */
export function invalidateDirectChain(
  type: "movie" | "tv",
  id: string,
  season?: number,
  episode?: number,
): void {
  const k = chainKey({ type, id, season, episode });
  const hadWinner = winners.delete(k);
  if (hadWinner) negatives.delete(k);
}
