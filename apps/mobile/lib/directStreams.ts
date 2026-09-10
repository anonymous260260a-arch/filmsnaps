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
 */
function computePriority(p: ReturnType<typeof parseStreamEntry>): number {
  if (p.isDownloadOnly) return 100 + (p.size ?? 0) / 1_000_000_000;
  if (p.isWebReady && p.codec === "h264") return 0;
  if (p.codec === "h264") return 10;
  if (p.codec === "hevc") return 20;
  if (p.codec === "av1" || p.codec === "vp9") return 30;
  return 40;
}

function mapHdhubStreams(streams: HdHubStream[]): StreamLink[] {
  const parsed = streams
    // Drop donation/discord entries (externalUrl-only)
    .filter((s) => !!s.url)
    .map((s) => ({ raw: s, parsed: parseStreamEntry(s) }));

  parsed.sort((a, b) => computePriority(a.parsed) - computePriority(b.parsed));

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

/**
 * Fetch stream links directly from the upstream provider (no server proxy).
 * Throws on failure so callers can surface their own error state.
 */
export async function fetchDirectStreams(
  tmdbId: number,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): Promise<DirectStreamBundle> {
  const imdbId = await resolveImdbId(mediaType, tmdbId);
  if (!imdbId) {
    throw new Error("Couldn't resolve this title's IMDB id.");
  }

  const apiBase = await getStreamsApiBase();
  const apiUrl =
    season && episode
      ? `${apiBase}/stream/series/${imdbId}:${season}:${episode}.json`
      : `${apiBase}/stream/movie/${imdbId}.json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(apiUrl, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch {
    throw new Error("Couldn't reach the stream provider.");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`Stream provider returned HTTP ${res.status}`);
  }

  const raw = (await res.json()) as { streams?: HdHubStream[] };
  const links = mapHdhubStreams(Array.isArray(raw?.streams) ? raw.streams : []);
  console.log(
    `[DirectStreams] ${mediaType} ${tmdbId} (${imdbId}) → ${links.length} links via ${apiBase}`,
  );
  return { tmdbId, imdbId, mediaType, links };
}
