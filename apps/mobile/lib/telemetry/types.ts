/**
 * Telemetry event types — the ONLY event names the app may emit.
 *
 * Whitelist enforcement:
 * 1. Compile-time: builders below only accept declared dim keys (unknown
 *    keys are TypeScript errors via excess property checks on literals).
 * 2. Runtime: scrub() drops any dim not in EVENT_DIMS[name].
 * 3. Server: /api/telemetry re-validates the same whitelist before insert.
 *
 * Privacy rules baked into these types: no user/device/ad identifiers,
 * no free text, no URLs, no titles — only enumerated outcomes and numbers.
 */

export type TelemetryEventName =
  | "provider_fetch"
  | "watch_end"
  | "provider_switch"
  | "app_launch"
  | "buffer_stall"
  | "player_start"
  | "player_error"
  | "screen_view"
  | "search_performed"
  | "session_end"
  | "download_event"
  | "feature_used"
  | "network_speed"
  | "boundary_error";

export type LinkCountBucket = "<5" | "5-15" | "16-30" | "30+";
export type FetchOutcome = "ok" | "empty" | "fail";
export type ProbeVerdict = "valid" | "dead" | "unverified";
export type SwitchReason = "dead-head" | "manual-pick" | "exhausted" | "auto-fallback";
export type HandoffUsed = "used" | "none";
export type EagerVerdict = "verified" | "unverified" | "none";
export type ColdStartReasonTelemetry = "warm" | "stale" | "no-cache";
export type ConnectionClass = "wifi" | "cellular" | "other" | "unknown";
export type DeviceTier = "low" | "standard" | "high" | "unknown";

/** P1 — how a watch attempt ended, from the player's point of view. */
export type PlayerStartOutcome = "first_frame" | "error" | "gave_up";
/** P1 — coarse classification of a playback error (no raw messages). */
export type PlayerErrorClass =
  | "network"
  | "decode"
  | "drm"
  | "provider_404"
  | "provider_410"
  | "cloudflare"
  | "timeout"
  | "no-response"
  | "http404"
  | "http410"
  | "tc"
  | "escape-blocked"
  | "render-gone"
  | "invalid-route"
  | "other";
/** E2 — which player surface produced the error. */
export type PlayerSurface = "direct" | "embed" | "route";
/** E1 — the chosen/max quality, bucketed (from streamSelector quality strings). */
export type QualityBucket = "480p" | "720p" | "1080p" | "4k" | "unknown";
/** E1/E8 — sustained connection speed bucketed by achievable max quality. */
export type MbpsBucket = "<2" | "2-5" | "5-15" | "15+";
/** E5 — download lifecycle stage (E5 gated until F10 fix ships). */
export type DownloadStage = "started" | "completed" | "failed" | "cancelled" | "retried";
/** E5 — coarse downloadable failure class. */
export type DownloadFailureClass =
  | "http"
  | "network"
  | "incomplete"
  | "storage"
  | "cancelled"
  | "other";
/** E6 — the fixed feature enum (enums only, no values/free text). */
export type FeatureName =
  | "speed_changed"
  | "speed_2x_hold"
  | "lock"
  | "skip_intro"
  | "next_episode_auto"
  | "next_episode_manual"
  | "cw_resume"
  | "audio_manual_override"
  | "quality_manual_override"
  | "language_prompt_answered"
  | "mode_toggle_anime"
  | "mode_toggle_movie_tv"
  | "bookmark_save"
  | "trailer_open"
  | "share_used";
/** E6 — usable context enum (same-class details for a few features). */
export type FeatureContext =
  | "settings"
  | "search"
  | "detail"
  | "player"
  | "watch"
  | "library"
  | "saved";
/** E4 — search surface / content-mode context. */
export type SearchMode = "movie_tv" | "anime";
/** P2 — screen identifiers for adoption counts. */
/** E10 — normalized screen names (dynamic routes collapse to their type). */
export type ScreenName =
  | "home"
  | "detail_movie"
  | "detail_tv"
  | "watch"
  | "search"
  | "library"
  | "history"
  | "saved"
  | "settings";
/** P2 — search query length bucket (chars). */
export type QueryLengthBucket = "0-3" | "4-10" | "11-25" | "26+";
/** The user's audio-language preference used to rank sources. */
export type PrefAudioLang = "auto" | "multi" | "hindi" | "english";
/** E1 — playback position bucketed (abandonment is flagged by <first 60s). */
export type PlaybackStageBucket = "tapped" | "framed" | "60s+";

/** Per-event dim maps — the single source of truth for scrub() + server. */
export const EVENT_DIMS: Record<TelemetryEventName, readonly string[]> = {
  provider_fetch: [
    "providerId",
    "tmdbId",
    "mediaType",
    "outcome",
    "linkCountBucket",
    "fetchMs",
    "probeMs",
    "verdict",
    "capBucket",
    "chosenQualityBucket",
  ],
  watch_end: [
    "providerId",
    "mediaType",
    "tmdbId",
    "durationMs",
    "fallbacks",
    "switchedProvider",
    "intentToFirstFrameMs",
    "handoff",
    "eager",
    "prefAudioLang",
    "stallMs",
    "rebufferCount",
    "reachedFirstFrame",
    "gaveUp",
    "qualityBucket",
    "capBucket",
  ],
  provider_switch: ["from", "to", "reason"],
  app_launch: [
    "splashMs",
    "contentReadyMs",
    "reason",
    "prefAudioLang",
    "otaApplied",
  ],
  buffer_stall: [
    "positionMs",
    "durationMs",
    "providerId",
    "mediaType",
    "prefAudioLang",
  ],
  player_start: [
    "outcome",
    "intentToFirstFrameMs",
    "providerId",
    "mediaType",
    "prefAudioLang",
  ],
  player_error: [
    "errorClass",
    "surface",
    "providerId",
    "mediaType",
    "prefAudioLang",
  ],
  screen_view: ["screen"],
  search_performed: [
    "queryLengthBucket",
    "resultsCountBucket",
    "tookMs",
    "failed",
    "mediaType",
    "mode",
    "retriedAfterFail",
  ],
  session_end: ["durationMs", "eventCount", "providerSwitches", "prefAudioLang"],
  download_event: [
    "stage",
    "provider",
    "qualityBucket",
    "failureClass",
    "mediaType",
  ],
  feature_used: ["feature", "context"],
  network_speed: ["mbpsBucket", "connectionClass", "latencyBucket"],
  boundary_error: ["errorClass"],
} as const;

export interface ProviderFetchDims {
  providerId: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  outcome?: FetchOutcome;
  linkCountBucket?: LinkCountBucket;
  fetchMs?: number;
  probeMs?: number;
  verdict?: ProbeVerdict;
  capBucket?: QualityBucket;
  chosenQualityBucket?: QualityBucket;
}

export interface WatchEndDims {
  providerId: string;
  mediaType: "movie" | "tv";
  tmdbId: number;
  durationMs: number;
  fallbacks: number;
  switchedProvider: boolean;
  intentToFirstFrameMs: number;
  handoff: HandoffUsed;
  eager: EagerVerdict;
  stallMs?: number;
  rebufferCount?: number;
  reachedFirstFrame?: boolean;
  gaveUp?: boolean;
  qualityBucket?: QualityBucket;
  capBucket?: QualityBucket;
}

export interface ProviderSwitchDims {
  from: string;
  to: string;
  reason: SwitchReason;
}

export interface AppLaunchDims {
  splashMs: number;
  contentReadyMs: number;
  reason: ColdStartReasonTelemetry;
  otaApplied?: boolean;
}

export interface BufferStallDims {
  positionMs: number;
  durationMs: number;
  providerId: string;
  mediaType: "movie" | "tv";
}

export interface PlayerStartDims {
  outcome: PlayerStartOutcome;
  intentToFirstFrameMs: number;
  providerId: string;
  mediaType: "movie" | "tv";
}

export interface PlayerErrorDims {
  errorClass: PlayerErrorClass;
  surface?: PlayerSurface;
  providerId: string;
  mediaType: "movie" | "tv";
}

export interface ScreenViewDims {
  screen: ScreenName;
}

export interface SearchPerformedDims {
  queryLengthBucket: QueryLengthBucket;
  resultsCountBucket: LinkCountBucket;
  tookMs: number;
  failed: boolean;
  mediaType?: "movie" | "tv" | "mixed";
  mode?: SearchMode;
  retriedAfterFail?: boolean;
}

export interface SessionEndDims {
  durationMs: number;
  eventCount: number;
  providerSwitches: number;
}

export interface DownloadEventDims {
  stage: DownloadStage;
  provider?: string;
  qualityBucket?: QualityBucket;
  failureClass?: DownloadFailureClass;
  mediaType?: "movie" | "tv";
}

export interface FeatureUsedDims {
  feature: FeatureName;
  context?: FeatureContext;
}

export interface NetworkSpeedDims {
  mbpsBucket: MbpsBucket;
  connectionClass: ConnectionClass;
  latencyBucket: number;
}

export interface BoundaryErrorDims {
  errorClass: string;
}

/** Envelope every queued event carries after scrub(). */
export interface TelemetryEnvelope {
  name: TelemetryEventName;
  /** Epoch ms. */
  ts: number;
  appVersion: string;
  connectionClass: ConnectionClass;
  deviceTier: DeviceTier;
  dims: Record<string, string | number | boolean>;
}

/** Whitelist dims for a name (server mirrors this). */
export function allowedDims(name: string): readonly string[] | null {
  return (EVENT_DIMS as Record<string, readonly string[] | undefined>)[name] ?? null;
}

/** Drop any dim not on the whitelist for this event name. */
export function scrub(env: TelemetryEnvelope): TelemetryEnvelope | null {
  const allow = allowedDims(env.name);
  if (!allow) return null;
  const dims: Record<string, string | number | boolean> = {};
  for (const key of allow) {
    const v = env.dims[key];
    if (v === undefined) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      dims[key] = v;
    }
  }
  return { ...env, dims };
}

/** Bucket helpers — coarse enough that raw timings cannot fingerprint users. */
export function bucketFetchMs(ms: number): number {
  return Math.max(0, Math.round(ms / 250) * 250);
}

export function bucketDurationMs(ms: number): number {
  return Math.max(0, Math.round(ms / 30_000) * 30_000);
}

/** P1 — stall length, bucketed to 500ms (short events, no sub-second detail). */
export function bucketStallMs(ms: number): number {
  return Math.max(0, Math.round(ms / 500) * 500);
}

/** P1 — playback position, bucketed to 1s ranges. */
export function bucketPositionMs(ms: number): number {
  return Math.max(0, Math.round(ms / 1_000) * 1_000);
}

export function bucketLinkCount(n: number): LinkCountBucket {
  if (n < 5) return "<5";
  if (n <= 15) return "5-15";
  if (n <= 30) return "16-30";
  return "30+";
}

/** P2 — query length in characters → coarse bucket. */
export function bucketQueryLength(n: number): QueryLengthBucket {
  if (n <= 3) return "0-3";
  if (n <= 10) return "4-10";
  if (n <= 25) return "11-25";
  return "26+";
}

/** HevcPlayer beginSwitch reason → telemetry SwitchReason. */
export function mapSwitchReason(
  reason: "timeout" | "error" | "dead" | "user" | "switch",
): SwitchReason {
  switch (reason) {
    case "user":
      return "manual-pick";
    case "dead":
      return "dead-head";
    case "timeout":
    case "error":
    case "switch":
      return "auto-fallback";
    default:
      return "auto-fallback";
  }
}

/** E1/E5 — a streamSelector quality string ("1080p"…/resolved numbers) → bucket. */
export function bucketQuality(q?: string | null): QualityBucket {
  if (!q) return "unknown";
  const s = String(q).toLowerCase();
  if (s.includes("4k") || s.includes("2160")) return "4k";
  if (s.includes("1080")) return "1080p";
  if (s.includes("720")) return "720p";
  if (s.includes("480")) return "480p";
  return "unknown";
}

/**
 * E1/E8 — sustained speed (Mbps, after CDN sustain factor applied) → the max
 * quality tier the connection can realistically sustain. Mirrors
 * getMaxQualityForSpeed in networkSpeedTest.ts so the bucket reads as the cap.
 */
export function bucketCappedQuality(mbps: number | undefined | null): QualityBucket {
  if (mbps == null || Number.isNaN(mbps)) return "unknown";
  if (mbps < 2) return "480p";
  if (mbps < 5) return "720p";
  if (mbps < 15) return "1080p";
  return "4k";
}

/** E8 — speed in Mbps → coarse bucket (never exact throughput). */
export function bucketMbps(mbps: number | undefined | null): MbpsBucket {
  if (mbps == null || Number.isNaN(mbps)) return "<2";
  if (mbps < 2) return "<2";
  if (mbps < 5) return "2-5";
  if (mbps < 15) return "5-15";
  return "15+";
}

/** E8 — latency → coarse bucket ms (rounded to 50ms). */
export function bucketLatencyMs(ms: number): number {
  return Math.max(0, Math.round(ms / 50) * 50);
}

/** E1 — 60s abandonment marker (durationMs is already 30s-bucketed upstream). */
export function isAbandonedWatch(durationMs: number): boolean {
  return durationMs < 60_000;
}