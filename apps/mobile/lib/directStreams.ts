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
import { getImdbId, setImdbId } from "./imdbIdCache";
import {
  buildStreamSourceUrl,
  createHdHubAdapter,
  extractEpisodeFiles,
  getProvider,
  mapFalixFiles,
  resolveStreams,
} from "@filmsnaps/shared";
import type { FalixData } from "@filmsnaps/shared";
import type { StreamLink } from "../components/player/streamTypes";
import { resolveMovie, resolveShowIds } from "./anime/resolve";

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
      apiBase: "https://download-falixm.koyeb.app",
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

// v2: bumped when falix moved hosts (download-falixm.koyeb.app) — any v1
// entry cached on a device is ignored, so the dead dl.falixmovies.com base
// can't linger in AsyncStorage for a full TTL window.
const CONFIG_CACHE_KEY = "@filmsnaps/stream-providers/v2";
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
  // D2: write-through AsyncStorage cache — a re-watch skips the worker
  // roundtrip entirely (log line: `[Flow] imdb cache HIT …`).
  try {
    const cached = await getImdbId(mediaType, tmdbId);
    if (cached) return cached;
  } catch {}
  try {
    // tmdbApi has no built-in timeout — race one so a hung pass-through
    // can't stall stream loading indefinitely.
    const result = await Promise.race([
      tmdbApi.getExternalIds(tmdbId, mediaType),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
    ]);
    const imdb = (result as { imdb_id?: string | null } | null)?.imdb_id;
    if (imdb) {
      void setImdbId(mediaType, tmdbId, imdb);
    }
    return imdb || null;
  } catch {
    return null;
  }
}

/**
 * True when the TMDB id is in the bundled anime twin map — the same
 * per-title detection the watch route applies for `isAnime` (minus the
 * `?isAnime=1` param, which only ever points at mapped titles). Cheap
 * in-memory lookup; a map hard-miss returns false → normal IMDb resolution,
 * so a map gap degrades to the old path instead of failing.
 */
function isAnimeMappedTitle(
  mediaType: "movie" | "tv",
  tmdbId: number,
): boolean {
  try {
    return mediaType === "tv"
      ? resolveShowIds(tmdbId) != null
      : resolveMovie(tmdbId) != null;
  } catch {
    return false;
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
 * Endpoint: `GET {falixBase}/api/id/{id}` (TV scopes to one season via
 * `?season_number=`). Records are TMDB-keyed (verified); some movie records
 * historically used the zero-stripped IMDb numeric key, so that's the
 * fallback on a miss. Stream URLs are
 * `{falixBase}/dl/{encoded_id}/{urlencoded-name}`. Never throws; a slow or
 * dead falix host only costs this background fetch (ranking never waits on
 * it — see onLateLinks in fetchDirectStreams).
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
  } catch {
    return [];
  }

  const startedAt = Date.now();
  let data: FalixData | null = null;

  // TMDB key first (verified for TV), zero-stripped IMDb numeric as fallback.
  const idCandidates = [String(tmdbId)];
  const imdbNum = imdbId.replace(/^tt0*/, "");
  if (imdbNum && imdbNum !== idCandidates[0]) idCandidates.push(imdbNum);

  for (const id of idCandidates) {
    // TV: scope to the requested season so a long-running show doesn't drag
    // its whole episode catalog over the wire (the season-scoped response
    // puts episodes at the top level — extractEpisodeFiles handles both).
    const url =
      mediaType === "tv" && season != null
        ? `${apiBase}/api/id/${id}?season_number=${season}`
        : `${apiBase}/api/id/${id}`;
    try {
      const res = await fetchWithTimeout(url, 8_000, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        data = (await res.json()) as FalixData;
        break;
      }
      console.log(
        `[Flow] falix: HTTP ${res.status} for ${mediaType}:${id} (${Date.now() - startedAt}ms)`,
      );
    } catch (err) {
      console.log(
        `[Flow] falix: fetch failed for ${mediaType}:${id} (${Date.now() - startedAt}ms) — ${err instanceof Error ? err.message : err}`,
      );
      break; // network-level failure — retrying the same host with another id won't help
    }
  }

  if (!data) return [];

  const files = extractEpisodeFiles(data, mediaType, season, episode);
  if (files.length === 0) {
    console.log(
      `[Flow] falix: 0 files for ${mediaType}:${tmdbId}${season != null ? ` s${season}e${episode}` : ""} (${Date.now() - startedAt}ms)`,
    );
    return [];
  }

  // Season-scoped payloads carry no title — derive one from the release name
  // ("Fakes Farzi S01E01 Artist 720p …mkv" → "Fakes Farzi").
  const title = data.title || titleFromReleaseName(files[0]?.name) || "Unknown";
  const links = mapFalixFiles(files, title, `${apiBase}/dl`);
  console.log(
    `[Flow] falix: ${links.length} links in ${Date.now() - startedAt}ms (files=${files.length})`,
  );
  return links;
}

/** Strip the SxxEyy episode token onward from a scene release name. */
function titleFromReleaseName(name?: string): string {
  const m = name?.match(/^(.*?)\s+S\d{1,2}E\d{1,3}\b/i);
  return m?.[1]?.trim() ?? "";
}

/**
 * Fetch stream links on-device from BOTH providers: the HDHub-style stream
 * API (primary) and falix — for every title, no link-count gate. When the
 * primary produces links the bundle returns immediately (falix never blocks
 * ranking); late falix links are delivered via `onLateLinks` for a
 * post-handoff cache merge. A primary failure/empty is still rescued by
 * awaiting falix. Throws only when both providers come up empty-and-broken,
 * so callers can surface their own error state.
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
  /**
   * Non-blocking falix (legacy direct path only): fired at most once with
   * falix links that landed AFTER the primary already had links to hand off.
   * The caller merges them into its pipeline cache; the returned bundle is
   * primary-only. When the primary fails/empties, falix is still awaited as
   * the rescue and this is never called.
   */
  onLateLinks?: (links: StreamLink[]) => void,
): Promise<DirectStreamBundle> {
  const fetchStartedAt = Date.now();
  // Anime-mapped title fetched by a tmdb-scheme provider (MovieBox/PenguPlay):
  // inject the route's TMDB id as `tmdb:{id}` instead of round-tripping TMDB
  // external_ids — the anime surface never resolves IMDb, and PenguPlay accepts
  // both schemes with identical rows (probed). Regular titles and every other
  // provider keep the resolved tt… id (unchanged behavior).
  const idDef = providerId ? getProvider(providerId) : undefined;
  // TMDB-keyed registry providers (spacedom — templates use only {tmdbId})
  // never substitute {imdbId}: skip the resolve round-trip entirely. Saves a
  // cold resolveImdbId network call (up to seconds) on the critical path and
  // lets titles the IMDb resolver can't map still play. The legacy hdhub
  // pipeline and imdb-keyed providers (moviebox, way2movies) are unchanged.
  const usesImdbTemplate =
    !idDef?.streamSources ||
    idDef.streamSources.length === 0 ||
    idDef.streamSources.some((s) =>
      [s.urlTemplate, s.urlTemplateTv, s.bodyTemplate, s.bodyTemplateTv].some(
        (t) => typeof t === "string" && t.includes("{imdbId}"),
      ),
    );
  let imdbId: string;
  if (!usesImdbTemplate) {
    imdbId = "";
  } else {
    const resolved =
      idDef?.idScheme === "tmdb" && isAnimeMappedTitle(mediaType, tmdbId)
        ? `tmdb:${tmdbId}`
        : await resolveImdbId(mediaType, tmdbId);
    if (!resolved) {
      throw new Error("Couldn't resolve this title's IMDB id.");
    }
    imdbId = resolved;
  }
  console.log(
    `[Flow] fetch ${mediaType}:${tmdbId}: imdb=${imdbId || "(not needed)"} resolved in ${Date.now() - fetchStartedAt}ms — provider=${providerId ?? "direct"}`,
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
  const falixStartedAt = Date.now();
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

  // Both fetches start together; the PRIMARY's result is what unblocks
  // ranking. Falix no longer gates it — a slow falix response (20s+ observed
  // on titles it has nothing for) used to stall the whole pipeline while
  // hdhub's ready pool sat idle.
  const hdhubPromise = (async (): Promise<StreamLink[]> => {
    // Same URL the download screen uses — a payload already in memory means
    // neither side needs the network.
    const cached = readHdHubPayload(apiUrl);
    if (cached) {
      console.log(
        `[Flow] fetch hdhub: ${cached.length} links (cache HIT — no upstream call)`,
      );
      return cached;
    }

    let res: Response;
    let httpMs = 0;
    try {
      const httpStartedAt = Date.now();
      res = await fetchWithTimeout(apiUrl, 15_000, {
        headers: { Accept: "application/json" },
      });
      httpMs = Date.now() - httpStartedAt;
    } catch {
      throw new Error("Couldn't reach the stream provider.");
    }
    if (!res.ok) {
      throw new Error(`Stream provider returned HTTP ${res.status}`);
    }
    const jsonStartedAt = Date.now();
    const raw = (await res.json()) as { streams?: unknown[] };
    const jsonMs = Date.now() - jsonStartedAt;
    const parseStartedAt = Date.now();
    const parsed = hdhubAdapter.parseResponse(raw, {
      imdbId,
      mediaType,
      season,
      episode,
    });
    const parseMs = Date.now() - parseStartedAt;
    console.log(
      `[Flow] hdhub: http=${httpMs}ms json=${jsonMs}ms parse=${parseMs}ms ` +
        `streams=${raw.streams?.length ?? 0} → ${parsed.length} links`,
    );
    writeHdHubPayload(apiUrl, parsed);
    return parsed;
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

  // Primary has links — hand back NOW. Falix keeps running in the background
  // and merges into the pipeline cache when it lands (onLateLinks).
  if (links.length > 0) {
    falixPromise
      .then((falixLinks) => {
        console.log(
          `[Flow] falix: ${falixLinks.length} links in ${Date.now() - falixStartedAt}ms (late — post-handoff)`,
        );
        if (falixLinks.length > 0) onLateLinks?.(falixLinks);
      })
      .catch(() => {});
    return { tmdbId, imdbId, mediaType, links };
  }

  // Primary came up empty/failed — falix IS the rescue: wait for it.
  const falixLinks = await falixPromise;
  console.log(
    `[Flow] falix: ${falixLinks.length} links in ${Date.now() - falixStartedAt}ms (rescue)`,
  );
  if (falixLinks.length > 0) {
    links.push(...falixLinks);
  }

  // Nothing from either side: surface the primary's error if it failed,
  // else return the empty bundle and let callers show "no streams".
  if (links.length === 0 && primaryError) throw primaryError;

  return { tmdbId, imdbId, mediaType, links };
}

// ── HDHub payload reuse ───────────────────────────────────────────

/**
 * HDHub payloads this app already fetched, keyed by the exact API URL.
 *
 * The detail page warms the watch pipeline (`[Flow] fetch hdhub: N links …`)
 * and the download screen asks for the very same URL — so it reads here
 * instead of paying for a second round-trip. Both sides write, both sides
 * read; only a miss (or an entry older than the TTL) ever reaches the network.
 *
 * 45 min is well inside the 3-hour signature window on HDHub's presigned file
 * URLs, and the map is bounded so a browsing session cannot grow it.
 */
const HDHUB_PAYLOAD_TTL_MS = 45 * 60 * 1000;
const HDHUB_PAYLOAD_MAX = 8;
const hdhubPayloads = new Map<string, { links: StreamLink[]; at: number }>();

function readHdHubPayload(apiUrl: string): StreamLink[] | null {
  const hit = hdhubPayloads.get(apiUrl);
  if (!hit) return null;
  if (Date.now() - hit.at > HDHUB_PAYLOAD_TTL_MS) {
    hdhubPayloads.delete(apiUrl);
    return null;
  }
  return [...hit.links];
}

function writeHdHubPayload(apiUrl: string, links: StreamLink[]): void {
  if (links.length === 0) return;
  hdhubPayloads.delete(apiUrl);
  hdhubPayloads.set(apiUrl, { links: [...links], at: Date.now() });
  while (hdhubPayloads.size > HDHUB_PAYLOAD_MAX) {
    const oldest = hdhubPayloads.keys().next().value;
    if (oldest === undefined) break;
    hdhubPayloads.delete(oldest);
  }
}

/**
 * HDHub-only lookup for the download flow.
 *
 * Deliberately separate from fetchDirectStreams(): that one runs hdhub+falix
 * concurrently and merges both pools for playback ranking, so callers can't
 * tell which provider a link came from. The download screen offers providers
 * one at a time, so it must only ever show HDHub's own files.
 *
 * Returns the same StreamLink shape the player sees (incl. `_meta.sizeBytes`,
 * `_meta.isDownloadOnly`) — the caller decides which rows are enqueueable.
 */
export async function fetchHdHubLinks(
  tmdbId: number,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): Promise<StreamLink[]> {
  const imdbId = await resolveImdbId(mediaType, tmdbId);
  if (!imdbId) {
    throw new Error("Couldn't resolve this title's IMDB id.");
  }

  const apiBase = await getProviderApiBase("hdhub");
  const apiUrl =
    season && episode
      ? `${apiBase}/stream/series/${imdbId}:${season}:${episode}.json`
      : `${apiBase}/stream/movie/${imdbId}.json`;

  // The watch pipeline already fetched this exact URL — reuse it.
  const cached = readHdHubPayload(apiUrl);
  if (cached) {
    console.log(
      `[Flow] download hdhub: ${cached.length} links (cache HIT — reused detail-page fetch)`,
    );
    return cached;
  }

  let raw: { streams?: unknown[] };
  try {
    const res = await fetchWithTimeout(apiUrl, 15_000, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`HDHub returned HTTP ${res.status}`);
    }
    raw = (await res.json()) as { streams?: unknown[] };
  } catch (err) {
    throw new Error(
      err instanceof Error && err.message.startsWith("HDHub")
        ? err.message
        : "Couldn't reach HDHub.",
    );
  }

  const links = hdhubAdapter.parseResponse(raw, {
    imdbId,
    mediaType,
    season,
    episode,
  });
  writeHdHubPayload(apiUrl, links);
  return links;
}
