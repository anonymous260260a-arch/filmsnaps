/**
 * Stream types shared across all platforms and stream sources.
 *
 * These types define the contract between stream source adapters,
 * the stream ranking pipeline, and the player components.
 */

/** A single playable stream link from any source. */
export interface StreamLink {
  /** Quality label, e.g. "1080p", "4K [Web]" */
  quality: string;
  /** Descriptive name (codec, audio info) */
  name: string;
  /** Index-based ID */
  id: string;
  /** Human-readable file size */
  size?: string;
  /** Direct video URL */
  url: string;
  /** "mp4" | "mkv" | "webm" */
  type: string;
  /**
   * Headers the upstream says the playback request needs (e.g. a Referer).
   * The player MUST merge these over its default per-host headers.
   */
  headers?: Record<string, string>;
  _meta?: {
    codec: string;
    audio: string;
    source: string;
    isDownloadOnly: boolean;
    isWebReady: boolean;
    sizeBytes?: number;
  };
}

/** Bundle of streams for a single title. */
export interface StreamBundle {
  tmdb_id: number;
  imdb_id: string;
  media_type: "movie" | "tv";
  links: StreamLink[];
}

/**
 * Configuration for a stream source upstream API.
 * This is the declarative config that lives in the provider registry.
 * Data only — behavior lives in the per-source adapter (see StreamSourceAdapter).
 */
export interface StreamSourceConfig {
  /** Unique source id, e.g. "hdhub", "falix", "spacedom-heron" */
  id: string;
  /** Base URL of the upstream API, no trailing slash. */
  apiBase: string;
  /** What this API serves — "streams" (Stremio-style), "downloads" (file catalog), "m3u8", or "raw". */
  kind: "streams" | "downloads" | "m3u8" | "raw";
  /** Master toggle — false disables this source. */
  enabled: boolean;
  /**
   * Adapter registry key (sources/index.ts). Defaults to the source id —
   * set it when several sources share one adapter (e.g. five spacedom
   * servers with one response shape).
   */
  adapter?: string;
  /**
   * Priority tier — lower is better. Sources sharing a tier are fetched in
   * parallel; tiers resolve in ascending order and later tiers only run
   * when earlier ones come up short. Defaults to 1 (everything in parallel,
   * the legacy behavior).
   */
  priority?: number;
  /** Per-source fetch timeout in ms (the tier escalates after it expires). */
  timeoutMs?: number;
  /**
   * Playable-link count this tier must produce before later tiers are
   * skipped. Only consulted on the LAST source of the tier (the threshold
   * is the max of the tier's minPlayable values).
   */
  minPlayable?: number;
  /**
   * URL builder for APIs keyed by path/query instead of a fixed catalog.
   * Placeholders: {tmdbId} {imdbId} {type} {season} {episode}.
   * `urlTemplate` is used for movies, `urlTemplateTv` for shows (it
   * typically carries the season/episode query).
   */
  urlTemplate?: string;
  urlTemplateTv?: string;
  /** Optional custom headers for API requests. */
  headers?: Record<string, string>;
  /**
   * Extra attempts when a source comes up empty or errors. Some upstreams
   * (spacedom) intermittently return "unavailable"/nothing on the first
   * request and succeed on the next one — a bounded retry recovers those
   * misses without any visible delay. 0 = single attempt (default).
   */
  retries?: number;
  /** Delay between retry attempts in ms. Defaults to 800. */
  retryDelayMs?: number;
}

/**
 * Adapter interface for parsing upstream API responses into StreamLink[].
 *
 * Each upstream API (HDHub, Falix, etc.) gets its own adapter.
 * Adapters are stateless — all state comes from the response parameter.
 * Adding a new upstream API = one adapter file + a registration in
 * sources/index.ts + a streamSources[] entry on the provider.
 */
export interface StreamSourceAdapter {
  /** Source id matching the StreamSourceConfig.id */
  id: string;
  /**
   * Parse a raw API response into StreamLink[].
   * @param response - The parsed JSON response from the upstream API
   * @param params - Context about what we're fetching
   */
  parseResponse(
    response: unknown,
    params: {
      imdbId: string;
      mediaType: "movie" | "tv";
      season?: number;
      episode?: number;
      sourceId?: string;
    },
  ): StreamLink[];
  /** Optional: clean a stream URL (strip download params, etc.) */
  cleanUrl?(url: string): string;
  /** Optional: build a fallback URL for ISP-blocking scenarios */
  fallbackUrl?(id: string): string;
}

/** User settings that affect stream selection. */
export interface StreamSelectionSettings {
  /** Preferred audio language, e.g. "hindi", "english" */
  preferredLanguage?: string;
  /** Maximum allowed quality, e.g. "1080p", "4K" */
  maxQuality?: string;
  /** Whether on cellular data */
  isCellular?: boolean;
  /** Maximum file size on cellular in bytes */
  cellularMaxMB?: number;
  /** Measured network speed in Mbps (from speed test or cached) */
  speedMbps?: number;
}
