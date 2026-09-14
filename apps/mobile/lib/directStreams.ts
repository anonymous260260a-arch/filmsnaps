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
          console.log(
            `[DirectStreams] provider config v${parsed.version} from remote (${parsed.providers.length} providers)`,
          );
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
    console.log(
      "[DirectStreams] provider config unavailable — using bundled defaults",
    );
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

// ── HDHub response parsing (ported from apps/web/app/api/player/direct) ──

/** Files ≥ 20GB (or "10Gbps"/"Download Only" entries) are download-only. */
const DOWNLOAD_ONLY_SIZE_THRESHOLD = 20_000_000_000;

interface HdHubStream {
  name?: string;
  description?: string;
  url?: string;
  externalUrl?: string;
  behaviorHints?: { notWebReady?: boolean; videoSize?: number };
}

/**
 * Strip params that force download instead of inline playback. Presigned
 * S3/R2 URLs are left untouched — deleting any query param breaks the SigV4
 * signature (HTTP 403 SignatureDoesNotMatch).
 */
function cleanStreamUrl(url: string): string {
  try {
    if (url.includes("X-Amz-Algorithm") || url.includes("X-Amz-Signature"))
      return url;
    const urlObj = new URL(url);
    urlObj.searchParams.delete("response-content-disposition");
    urlObj.searchParams.delete("response-content-type");
    return urlObj.toString();
  } catch {
    return url;
  }
}

/** Extract source name from the stream name (e.g. "HdHub 1080p" → "HdHub"). */
function extractSource(name: string): string {
  const firstLine = name.split("\n")[0] || "";
  const match = firstLine.match(/^(HdHub|4KHDHub|HdHub VM|VS Sunny)/i);
  return match ? match[1] : "Unknown";
}

function parseStreamEntry(stream: HdHubStream) {
  const name = stream.name || "";
  const desc = stream.description || "";

  let quality = "Unknown";
  if (/2160[pP]|4K|UHD/i.test(desc + name)) quality = "2160p";
  else if (/1080[pP]/i.test(desc + name)) quality = "1080p";
  else if (/720[pP]/i.test(desc + name)) quality = "720p";
  else if (/480[pP]/i.test(desc + name)) quality = "480p";
  else if (/360[pP]/i.test(desc + name)) quality = "360p";

  let codec = "x264"; // default
  if (/HEVC|x265|H\.265/i.test(desc)) codec = "hevc";
  else if (/AV1|av01/i.test(desc)) codec = "av1";
  else if (/VP9|vp09/i.test(desc)) codec = "vp9";
  else if (/H\.264|avc1|x264/i.test(desc)) codec = "h264";

  let audio = "Unknown";
  if (/DTS-HD/i.test(desc)) audio = "DTS-HD";
  else if (/DTS/i.test(desc)) audio = "DTS";
  else if (/DDP5\.1|DDP 5\.1|AAC5\.1/i.test(desc)) audio = "Dolby Digital 5.1";
  else if (/AAC/i.test(desc)) audio = "AAC";

  const isDownloadOnly =
    /10Gbps|Download Only/i.test(name) ||
    (stream.behaviorHints?.videoSize ?? 0) >= DOWNLOAD_ONLY_SIZE_THRESHOLD;

  // Direct MP4s without download/redirect params stream inline; PixelDrain
  // URLs with ?download= and huge remuxes do not.
  const isWebReady =
    !!stream.url &&
    !isDownloadOnly &&
    /\.mp4(\?.*)?$/i.test(stream.url) &&
    !/[?&]download=/.test(stream.url);

  return {
    quality,
    codec,
    audio,
    isDownloadOnly,
    isWebReady,
    size: stream.behaviorHints?.videoSize,
    source: extractSource(name),
  };
}

/**
 * Playback priority (lower = tried first). Unlike the web proxy there is no
 * Windows penalty — Android hardware-decodes HEVC and HevcPlayer exists for it.
 * When the native MKV extractor is absent (v2.1.0), MKV files that need the
 * secondary-SeekHead get a heavy penalty so MP4/WebM alternatives are tried first.
 */
function computePriority(
  p: ReturnType<typeof parseStreamEntry>,
  rawDesc: string,
): number {
  if (p.isDownloadOnly) return 100 + (p.size ?? 0) / 1_000_000_000;
  if (p.isWebReady && p.codec === "h264") return 0;
  if (p.codec === "h264") return 10;
  if (p.codec === "hevc") return 20;
  if (p.codec === "av1" || p.codec === "vp9") return 30;
  // MKV without the native extractor: files with complex seek patterns will
  // fail to seek. Push below download-only so MP4/WebM alternatives win.
  if (!HAS_CUSTOM_MKV_EXTRACTOR && /\.mkv\b/i.test(rawDesc)) return 200;
  return 40;
}

function mapHdhubStreams(streams: HdHubStream[]): StreamLink[] {
  const parsed = streams
    // Drop donation/discord entries (externalUrl-only)
    .filter((s) => !!s.url)
    .map((s) => ({ raw: s, parsed: parseStreamEntry(s) }));

  parsed.sort(
    (a, b) =>
      computePriority(a.parsed, a.raw.description || "") -
      computePriority(b.parsed, b.raw.description || ""),
  );

  return parsed.map((s, idx) => {
    const desc = s.raw.description || "";
    return {
      quality: s.parsed.isDownloadOnly
        ? `${s.parsed.quality} [Download Only]`
        : s.parsed.isWebReady
          ? `${s.parsed.quality} [Web]`
          : s.parsed.quality,
      name: desc,
      id: idx.toString(),
      size: s.raw.behaviorHints?.videoSize
        ? `${(s.raw.behaviorHints.videoSize / 1_000_000_000).toFixed(2)}GB`
        : undefined,
      url: cleanStreamUrl(s.raw.url || ""),
      type: desc.includes(".mkv") ? "mkv" : "mp4",
      _meta: {
        codec: s.parsed.codec,
        audio: s.parsed.audio,
        source: s.parsed.source,
        isDownloadOnly: s.parsed.isDownloadOnly,
        isWebReady: s.parsed.isWebReady,
        sizeBytes: s.raw.behaviorHints?.videoSize,
      },
    };
  });
}

// ── Public API ──

export interface DirectStreamBundle {
  tmdbId: number;
  imdbId: string;
  mediaType: "movie" | "tv";
  links: StreamLink[];
}

// ── Falix (second provider, fetched for every title) ───────────────────

interface FalixTelegramFile {
  quality: string;
  id: string;
  name: string;
  size: string;
}

interface FalixTVData {
  tmdb_id: number;
  title: string;
  media_type: "tv";
  seasons: Array<{
    season_number: number;
    episodes: Array<{
      episode_number: number;
      telegram: FalixTelegramFile[];
    }>;
  }>;
}

interface FalixMovieData {
  tmdb_id: number;
  title: string;
  media_type: "movie";
  telegram: FalixTelegramFile[];
}

function parseFalixSize(sizeStr: string): number {
  if (!sizeStr) return 0;
  const m = sizeStr.match(/([\d.]+)\s*(GB|MB|KB)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  if (unit === "GB") return Math.round(n * 1024 * 1024 * 1024);
  if (unit === "MB") return Math.round(n * 1024 * 1024);
  return Math.round(n * 1024);
}

function parseFalixCodec(name: string): string {
  if (/x265|HEVC|H\.265|x266/i.test(name)) return "hevc";
  if (/AV1|av01/i.test(name)) return "av1";
  if (/x264|H\.264|AVC/i.test(name)) return "h264";
  return "h264";
}

function parseFalixAudio(name: string): string {
  if (/DTS-HD/i.test(name)) return "DTS-HD";
  if (/DTS/i.test(name)) return "DTS";
  if (/DDP|E-?AC-?3|Dolby Digital Plus/i.test(name)) return "Dolby Digital 5.1";
  if (/DD\b|AC-?3/i.test(name)) return "Dolby Digital 5.1";
  if (/AAC/i.test(name)) return "AAC";
  return "Unknown";
}

function mapFalixFiles(
  files: FalixTelegramFile[],
  title: string,
  dlBase: string,
): StreamLink[] {
  return files
    .filter((f) => !!f.id && !!f.name)
    .map((f, i) => {
      const sizeBytes = parseFalixSize(f.size);
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "mp4";
      return {
        quality: f.quality || "Unknown",
        name: `[Falix] ${title} — ${f.name}`,
        id: `falix-${i}`,
        size: f.size || undefined,
        // dlBase is either the falix host itself or the worker stream proxy
        // (see fetchFalixLinks) — both end in /dl.
        url: `${dlBase}/${f.id}/${encodeURIComponent(f.name)}`,
        type: ext === "mkv" ? "mkv" : "mp4",
        _meta: {
          codec: parseFalixCodec(f.name),
          audio: parseFalixAudio(f.name),
          source: "Falix",
          isDownloadOnly: false,
          isWebReady: false,
          sizeBytes,
        },
      };
    });
}

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
    console.log(
      `[Flow] fetch falix ⚠ provider unavailable: ${err?.message ?? err}`,
    );
    return [];
  }

  const workerBase = getApiBaseUrl().replace(/\/$/, "");
  let directReachable = true;
  let useProxy = false;
  let data: FalixTVData | FalixMovieData | null = null;

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
            data = (await res.json()) as FalixTVData | FalixMovieData;
          } catch (err: any) {
            // Non-JSON body — e.g. an ISP hijack/challenge page returned as 200.
            console.log(
              `[Flow] fetch falix lookup ${id}: HTTP 200 but body is not JSON — ${err?.message ?? err}`,
            );
            continue;
          }
          console.log(`[Flow] fetch falix lookup ${id}: OK (direct)`);
          break;
        }
        // 404 etc. — the server answered, so this id simply isn't in the
        // catalog; try the next id directly.
        console.log(`[Flow] fetch falix lookup ${id}: HTTP ${res.status}`);
        continue;
      } catch (err: any) {
        directReachable = false;
        console.log(
          `[Flow] fetch falix direct unreachable (${err?.name ?? "Error"}: ${err?.message ?? err}) — switching to worker proxy`,
        );
      }
    }
    try {
      const res = await fetchWithTimeout(
        `${workerBase}/api/player/falix?id=${id}`,
        12_000,
      );
      if (res.ok) {
        try {
          data = (await res.json()) as FalixTVData | FalixMovieData;
        } catch (err: any) {
          console.log(
            `[Flow] fetch falix proxy ${id}: HTTP 200 but body is not JSON — ${err?.message ?? err}`,
          );
          continue;
        }
        useProxy = true;
        console.log(`[Flow] fetch falix lookup ${id}: OK (worker proxy)`);
        break;
      }
      console.log(`[Flow] fetch falix proxy ${id}: HTTP ${res.status}`);
    } catch (err: any) {
      console.log(
        `[Flow] fetch falix proxy ${id}: ${err?.name ?? "Error"}: ${err?.message ?? err}`,
      );
    }
  }

  if (!data) {
    console.log(
      `[Flow] fetch falix: no entry for tmdbId=${tmdbId} (imdb ${imdbId}, base ${apiBase})`,
    );
    return [];
  }

  let files: FalixTelegramFile[] = [];
  if (
    mediaType === "tv" &&
    "seasons" in data &&
    season != null &&
    episode != null
  ) {
    const s = data.seasons.find((s) => s.season_number === season);
    const ep = s?.episodes.find((e) => e.episode_number === episode);
    files = ep?.telegram ?? [];
    if (files.length === 0) {
      console.log(
        `[Flow] fetch falix: S${season}E${episode} EMPTY (seasons=${data.seasons?.length ?? 0}, foundSeason=${!!s})`,
      );
    }
  } else if ("telegram" in data) {
    files = data.telegram ?? [];
  }

  if (files.length === 0) return [];

  const links = mapFalixFiles(
    files,
    data.title,
    useProxy ? `${workerBase}/api/player/falix/stream/dl` : `${apiBase}/dl`,
  );
  console.log(
    `[Flow] fetch falix: ${links.length} files for tmdbId=${tmdbId}${useProxy ? " (via worker proxy)" : ""}`,
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
export async function fetchDirectStreams(
  tmdbId: number,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): Promise<DirectStreamBundle> {
  const fetchStartedAt = Date.now();
  const imdbId = await resolveImdbId(mediaType, tmdbId);
  if (!imdbId) {
    throw new Error("Couldn't resolve this title's IMDB id.");
  }
  console.log(
    `[Flow] fetch ${mediaType}:${tmdbId}: imdb=${imdbId} resolved in ${Date.now() - fetchStartedAt}ms — starting hdhub + falix in parallel`,
  );

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
    const raw = (await res.json()) as { streams?: HdHubStream[] };
    return mapHdhubStreams(Array.isArray(raw?.streams) ? raw.streams : []);
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
    console.log(`[Flow] fetch falix: +${falixLinks.length} links`);
    links.push(...falixLinks);
  }

  // Nothing from either side: surface the primary's error if it failed,
  // else return the empty bundle and let callers show "no streams".
  if (links.length === 0 && primaryError) throw primaryError;

  return { tmdbId, imdbId, mediaType, links };
}
