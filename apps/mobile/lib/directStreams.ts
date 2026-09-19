/**
 * Direct stream fetching — on-device, no server proxy.
 *
 * Replaces the old `/api/player/direct` proxy hop: the app resolves the IMDB
 * id (via the /api/tmdb pass-through, so the TMDB key stays server-side) and
 * then calls the upstream stream API directly from the device, parsing and
 * ranking the response locally. The web player keeps using the proxy —
 * browsers need it for CORS.
 *
 * Provider registry
 * -----------------
 * The upstream's API base is NOT hardcoded here. It lives in
 * `apps/web/public/stream-providers.json`, served by the web app / worker
 * (same remote-config channel as announcements.json). When an upstream
 * domain changes, edit that file and redeploy — every installed app version
 * picks it up within the cache TTL, no app update needed. The bundled copy
 * below is the offline / first-launch fallback.
 *
 * The same registry also serves the download provider's API base
 * (`kind: "downloads"`, e.g. Falix) — previously hardcoded on its page.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBaseUrl, tmdbApi } from "./api";
import {
  buildStreamSourceUrl,
  createHdHubAdapter,
  extractEpisodeFiles,
  getProvider,
  mapFalixFiles,
  resolveStreams,
} from "@filmsnaps/shared";
import type { FalixFile } from "@filmsnaps/shared";
import type { StreamLink } from "../components/player/streamTypes";

// ── Native MKV extractor detection ──────────────────────────────────────
// The secondary-SeekHead MKV extractor lives in a native patch on expo-video.
// v2.2.0+ ships it; v2.1.0 does not. Without it, MKV files with complex
// seek patterns fail to seek. Detected once at module load via the same
// property-check pattern as playerConfig.ts applyNativeKnobs().
const HAS_CUSTOM_MKV_EXTRACTOR = (() => {
  try {
    const { requireNativeModule } = require("expo-modules-core");
    const mod = requireNativeModule("ExpoVideo") as Record<string, unknown>;
    return mod != null && mod.mkvExtractorMode !== undefined;
  } catch {
    return false;
  }
})();

/**
 * Shared HDHub adapter instance. Parsing lives in
 * packages/shared/src/providers/sources/hdhub.ts — the MKV-extractor flag is
 * the only platform-specific input (native patch presence on this device).
 */
const hdhubAdapter = createHdHubAdapter({
  hasCustomMkvExtractor: HAS_CUSTOM_MKV_EXTRACTOR,
});

// ── Provider registry (remote-updatable) ──

/** What an entry's API serves. */
export type ProviderKind = "streams" | "downloads";

export interface DirectStreamProvider {
  id: string;
  /** Base URL of the upstream API, no trailing slash. */
  apiBase: string;
  /** What this API serves — defaults to "streams" when absent. */
  kind?: ProviderKind;
  enabled?: boolean;
}

export interface StreamProvidersConfig {
  version: number;
  providers: DirectStreamProvider[];
}

/** Offline / first-launch fallback — keep in sync with apps/web/public/stream-providers.json. */
const BUNDLED_CONFIG: StreamProvidersConfig = {
  version: 3,
  providers: [
    {
      id: "hdhub",
      apiBase: "https://hdhub.thevolecitor.qzz.io",
      kind: "streams",
      enabled: true,
    },
    {
      id: "falix",
      apiBase: "https://dl.falixmovies.com",
      kind: "downloads",
      enabled: true,
    },
    {
      id: "nxsha",
      apiBase: "https://web.nxsha.app",
      kind: "downloads",
      enabled: true,
    },
  ],
};

const CONFIG_CACHE_KEY = "@filmsnaps/stream-providers/v1";
const CONFIG_TTL_MS = 30 * 60 * 1000; // 30 min

function getConfigUrl(): string {
  return `${getApiBaseUrl().replace(/\/$/, "")}/stream-providers.json`;
}

/** Defensive parse — never trust remote data. */
function parseConfig(raw: unknown): StreamProvidersConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const cfg = raw as Record<string, unknown>;
  if (!Array.isArray(cfg.providers)) return null;
  const providers = (cfg.providers as unknown[])
    .filter(
      (p): p is DirectStreamProvider =>
        !!p &&
        typeof p === "object" &&
        typeof (p as DirectStreamProvider).id === "string" &&
        typeof (p as DirectStreamProvider).apiBase === "string" &&
        (p as DirectStreamProvider).apiBase.length > 0,
    )
    .map(
      (p): DirectStreamProvider => ({
        id: p.id,
        apiBase: p.apiBase.replace(/\/$/, ""),
        kind: p.kind === "downloads" ? "downloads" : "streams",
        enabled: p.enabled !== false,
      }),
    );
  if (providers.length === 0) return null;
  return {
    version: typeof cfg.version === "number" ? cfg.version : 0,
    providers,
  };
}

let configCache: { config: StreamProvidersConfig; fetchedAt: number } | null =
  null;
let configInFlight: Promise<StreamProvidersConfig> | null = null;

/**
 * Provider list with layered fallbacks: memory → AsyncStorage (fresh) →
 * remote JSON → stale AsyncStorage → bundled defaults. Never throws.
 */
async function loadProvidersConfig(): Promise<StreamProvidersConfig> {
  if (configCache && Date.now() - configCache.fetchedAt < CONFIG_TTL_MS) {
    return configCache.config;
  }
  if (configInFlight) return configInFlight;

  configInFlight = (async () => {
    // 1. Fresh-enough cached copy
    try {
      const raw = await AsyncStorage.getItem(CONFIG_CACHE_KEY);
      if (raw) {
        const entry = JSON.parse(raw) as {
          config: StreamProvidersConfig;
          fetchedAt: number;
        };
        const parsed = parseConfig(entry?.config);
        if (parsed && Date.now() - entry.fetchedAt < CONFIG_TTL_MS) {
          configCache = { config: parsed, fetchedAt: entry.fetchedAt };
          return parsed;
        }
      }
    } catch {}

    // 2. Remote fetch
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(getConfigUrl(), { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const parsed = parseConfig(await res.json());
        if (parsed) {
          configCache = { config: parsed, fetchedAt: Date.now() };
          AsyncStorage.setItem(
            CONFIG_CACHE_KEY,
            JSON.stringify(configCache),
          ).catch(() => {});
          return parsed;
        }
      }
    } catch {}

    // 3. Stale cache, then bundled defaults
    try {
      const raw = await AsyncStorage.getItem(CONFIG_CACHE_KEY);
      if (raw) {
        const entry = JSON.parse(raw) as { config: StreamProvidersConfig };
        const parsed = parseConfig(entry?.config);
        if (parsed) return parsed;
      }
    } catch {}

    return BUNDLED_CONFIG;
  })();

  try {
    return await configInFlight;
  } finally {
    configInFlight = null;
  }
}

/**
 * Resolve the API base for a kind. A remote config that lists any entry of
 * the kind is authoritative (including marking them all disabled); when the
 * config has no entry of the kind, fall back to the bundled defaults.
 */
async function getApiBaseFor(kind: ProviderKind): Promise<string> {
  const config = await loadProvidersConfig();
  const entries = config.providers.filter((p) => p.kind === kind);
  if (entries.length > 0) {
    const pick = entries.find((p) => p.enabled !== false);
    if (!pick) throw new Error(`The ${kind} provider is disabled`);
    return pick.apiBase;
  }
  const bundled = BUNDLED_CONFIG.providers.find((p) => p.kind === kind);
  if (!bundled) throw new Error(`No ${kind} provider configured`);
  return bundled.apiBase;
}

/** Streaming catalog API base (HDHub-style). */
export function getStreamsApiBase(): Promise<string> {
  return getApiBaseFor("streams");
}

/**
 * Resolve the API base for a specific provider id (e.g. "falix", "nxsha").
 * A remote config that lists the id is authoritative (including disabling
 * it); when absent, fall back to the bundled entry.
 */
export async function getProviderApiBase(id: string): Promise<string> {
  const config = await loadProvidersConfig();
  const entries = config.providers.filter((p) => p.id === id);
  if (entries.length > 0) {
    const pick = entries.find((p) => p.enabled !== false);
    if (!pick) throw new Error(`Provider ${id} is disabled`);
    return pick.apiBase;
  }
  const bundled = BUNDLED_CONFIG.providers.find((p) => p.id === id);
  if (!bundled) throw new Error(`Unknown provider: ${id}`);
  return bundled.apiBase;
}

/**
 * Fire-and-forget startup warmup — populates the in-memory config so the
 * first stream/download fetch doesn't wait on the remote config lookup.
 */
export function warmProviderConfig(): void {
  loadProvidersConfig().catch(() => {});
}

// ── TMDB → IMDB resolution (key stays server-side via the /api/tmdb pass-through) ──

async function resolveImdbId(
  mediaType: "movie" | "tv",
  tmdbId: number,
): Promise<string | null> {
  const idStr = String(tmdbId);
  if (/^tt\d+$/i.test(idStr)) return idStr;
  try {
    // tmdbApi has no built-in timeout — race one so a hung pass-through
    // can't stall stream loading indefinitely.
    const result = await Promise.race([
      tmdbApi.getExternalIds(tmdbId, mediaType),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
    ]);
    const imdb = (result as { imdb_id?: string | null } | null)?.imdb_id;
    return imdb || null;
  } catch {
    return null;
  }
}

// ── HDHub response parsing — moved to packages/shared/src/providers/sources/hdhub.ts ──

// ── Public API ──

export interface DirectStreamBundle {
  tmdbId: number;
  imdbId: string;
  mediaType: "movie" | "tv";
  links: StreamLink[];
}

// ── Falix (second provider, fetched for every title) ───────────────────

/**
 * fetch() with a hard timeout. RN's AbortSignal polyfill (abort-controller)
 * has NO static .timeout() — calling it throws "not a function" on device,
 * which used to make every falix lookup fail silently inside its try/catch.
 * Manual AbortController + setTimeout works on all RN versions.
 */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch streamable links from falix. Runs for EVERY title in parallel with
 * the primary provider — there is no link-count gate — and its links join
 * the same pool, ranked together with the primary's by the stream pipeline
 * (lib/streamPrefetch → selectBestStream).
 *
 * Falix keys titles inconsistently (some by zero-stripped IMDB numeric id,
 * some by their real TMDB id — its "tmdb_id" field stores whichever), so
 * both ids are tried.
 *
 * Some ISPs intermittently block dl.falixmovies.com at the connection level
 * ("Network request failed" — metadata API and /dl/ streams share the host).
 * When a direct lookup fails that way, the remaining lookups AND the stream
 * URLs go through the web app's worker proxy (/api/player/falix*), the same
 * Cloudflare channel as the TMDB pass-through. Never throws.
 */
async function fetchFalixLinks(
  tmdbId: number,
  imdbId: string,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): Promise<StreamLink[]> {
  let apiBase: string;
  try {
    apiBase = await getProviderApiBase("falix");
  } catch (err: any) {
    return [];
  }

  const workerBase = getApiBaseUrl().replace(/\/$/, "");
  let directReachable = true;
  let useProxy = false;
  let data: Record<string, unknown> | null = null;

  const imdbNum = imdbId.replace(/^tt0*/, "");
  for (const id of [imdbNum, String(tmdbId)]) {
    if (!id) continue;
    if (directReachable) {
      try {
        // 4s — an ISP-blocked host won't answer within this anyway, and a
        // hung direct attempt must not gate the whole pipeline (the worker
        // proxy picks up immediately after).
        const res = await fetchWithTimeout(`${apiBase}/api/id/${id}`, 4_000);
        if (res.ok) {
          try {
            data = (await res.json()) as Record<string, unknown>;
          } catch (err: any) {
            // Non-JSON body — e.g. an ISP hijack/challenge page returned as 200.
            continue;
          }
          break;
        }
        continue;
      } catch (err: any) {
        directReachable = false;
      }
    }
    try {
      const res = await fetchWithTimeout(
        `${workerBase}/api/player/falix?id=${id}`,
        12_000,
      );
      if (res.ok) {
        try {
          data = (await res.json()) as Record<string, unknown>;
        } catch (err: any) {
          continue;
        }
        useProxy = true;
        break;
      }
    } catch (err: any) {}
  }

  if (!data) {
    return [];
  }

  const files: FalixFile[] = extractEpisodeFiles(
    data,
    mediaType,
    season,
    episode,
  );
  if (mediaType === "tv" && files.length === 0) {
    const seasons = (data as { seasons?: unknown[] }).seasons?.length ?? 0;
  }

  if (files.length === 0) return [];

  const title = (data as { title?: string }).title || "Unknown";
  const links = mapFalixFiles(
    files,
    title,
    useProxy ? `${workerBase}/api/player/falix/stream/dl` : `${apiBase}/dl`,
  );

  return links;
}

/**
 * Fetch stream links on-device from BOTH providers: the HDHub-style stream
 * API (primary) and falix — for every title, no link-count gate. The merged
 * pool is ranked once by the stream pipeline (lib/streamPrefetch →
 * selectBestStream). Falix problems never fail the load; a primary failure
 * is rescued by falix links when it has any.
 * Throws only when both providers come up empty-and-broken, so callers can
 * surface their own error state.
 */
/** Track whether the legacy hdhub+falix pipeline warned about a provider. */
const warnedProviders = new Set<string>();

/**
 * Fetch links for a registry-driven direct provider (streamSources[] on its
 * ProviderDefinition — e.g. spacedom). Resolution is tiered: sources sharing
 * a `priority` fetch in parallel, higher tiers only run when lower ones come
 * up short. Returns null when the provider isn't registry-driven (no
 * streamSources) so the caller can fall back to the legacy pipeline.
 */
async function fetchRegistryProviderLinks(
  providerId: string,
  tmdbId: number,
  imdbId: string,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): Promise<StreamLink[] | null> {
  const def = getProvider(providerId);
  if (!def?.streamSources || def.streamSources.length === 0) return null;

  const result = await resolveStreams(
    {
      streamSources: def.streamSources,
      imdbId,
      tmdbId,
      mediaType,
      season,
      episode,
    },
    async (source, ctx) => {
      const url = buildStreamSourceUrl(source, ctx);
      if (!url) throw new Error(`source ${source.id} has no urlTemplate`);
      const res = await fetchWithTimeout(url, source.timeoutMs ?? 8_000, {
        headers: { Accept: "application/json", ...(source.headers ?? {}) },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  );
  for (const f of result.failedSources) {
    console.log(`[Flow] fetch ${sourceLogName(providerId, f.id)}: ${f.error}`);
  }
  console.log(
    `[Flow] fetch ${providerId}: ${result.links.length} links from [${result.fetchedSources.join(", ") || "none"}]`,
  );
  // Tag every link with its provider so the player can detect cross-provider fallbacks.
  return result.links.map((l) => {
    const m = l._meta;
    return {
      ...l,
      _meta: m
        ? { ...m, providerId }
        : {
            codec: "unknown",
            audio: "unknown",
            source: "",
            isDownloadOnly: false,
            isWebReady: true,
            providerId,
          },
    };
  });
}

function sourceLogName(providerId: string, sourceId: string): string {
  return sourceId.startsWith(`${providerId}-`)
    ? sourceId.slice(providerId.length + 1)
    : sourceId;
}

export async function fetchDirectStreams(
  tmdbId: number,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
  /** Registry provider id — set for non-legacy direct providers (spacedom…). */
  providerId?: string,
): Promise<DirectStreamBundle> {
  const fetchStartedAt = Date.now();
  const imdbId = await resolveImdbId(mediaType, tmdbId);
  if (!imdbId) {
    throw new Error("Couldn't resolve this title's IMDB id.");
  }
  console.log(
    `[Flow] fetch ${mediaType}:${tmdbId}: imdb=${imdbId} resolved in ${Date.now() - fetchStartedAt}ms — provider=${providerId ?? "direct"}`,
  );

  // Registry-driven direct provider (e.g. spacedom): tiered resolution over
  // its streamSources — the legacy hdhub+falix pipeline doesn't run at all.
  if (providerId && providerId !== "direct") {
    const registryLinks = await fetchRegistryProviderLinks(
      providerId,
      tmdbId,
      imdbId,
      mediaType,
      season,
      episode,
    );
    if (registryLinks !== null) {
      return { tmdbId, imdbId, mediaType, links: registryLinks };
    }
    if (!warnedProviders.has(providerId)) {
      warnedProviders.add(providerId);
      console.warn(
        `[DirectStreams] provider ${providerId} has no streamSources — falling back to the legacy hdhub+falix pipeline`,
      );
    }
  }

  // Falix starts regardless of what the primary provider does — even a
  // disabled/unreachable primary doesn't stop it.
  const falixPromise = fetchFalixLinks(
    tmdbId,
    imdbId,
    mediaType,
    season,
    episode,
  ).catch(() => [] as StreamLink[]);

  const apiBase = await getStreamsApiBase();
  const apiUrl =
    season && episode
      ? `${apiBase}/stream/series/${imdbId}:${season}:${episode}.json`
      : `${apiBase}/stream/movie/${imdbId}.json`;

  // Both fetches run concurrently; results are collected sequentially so a
  // slow primary never delays an already-finished falix response.
  const hdhubPromise = (async (): Promise<StreamLink[]> => {
    let res: Response;
    try {
      res = await fetchWithTimeout(apiUrl, 15_000, {
        headers: { Accept: "application/json" },
      });
    } catch {
      throw new Error("Couldn't reach the stream provider.");
    }
    if (!res.ok) {
      throw new Error(`Stream provider returned HTTP ${res.status}`);
    }
    const raw = (await res.json()) as { streams?: unknown[] };
    return hdhubAdapter.parseResponse(raw, {
      imdbId,
      mediaType,
      season,
      episode,
    });
  })();

  let links: StreamLink[] = [];
  let primaryError: unknown = null;
  try {
    links = await hdhubPromise;
    console.log(
      `[Flow] fetch hdhub: ${links.length} links via ${apiBase} (total ${Date.now() - fetchStartedAt}ms)`,
    );
  } catch (err) {
    primaryError = err;
    console.warn(
      `[DirectStreams] primary provider failed for ${mediaType} ${tmdbId}:`,
      err,
    );
  }

  const falixLinks = await falixPromise;
  if (falixLinks.length > 0) {
    links.push(...falixLinks);
  }

  // Nothing from either side: surface the primary's error if it failed,
  // else return the empty bundle and let callers show "no streams".
  if (links.length === 0 && primaryError) throw primaryError;

  return { tmdbId, imdbId, mediaType, links };
}
