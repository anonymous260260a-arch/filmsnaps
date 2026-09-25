/**
 * Telemetry builders — the only public way to emit events.
 *
 * Each builder maps raw app signals into the typed dim shape, buckets
 * sensitive timings, and enqueues through queue.ts (which applies the
 * legal/analytics gate). P1/P2/P3 extend the original four events with
 * playback quality, product adoption, and session-shape signals.
 */

import Constants from "expo-constants";
import NetInfo from "@react-native-community/netinfo";
import { enqueue, getSessionSnapshot, startNewSession } from "./queue";
import {
  bucketCappedQuality,
  bucketDurationMs,
  bucketFetchMs,
  bucketLinkCount,
  bucketPositionMs,
  bucketQueryLength,
  bucketStallMs,
  mapSwitchReason,
  type AppLaunchDims,
  type BoundaryErrorDims,
  type BufferStallDims,
  type ConnectionClass,
  type DeviceTier,
  type DownloadEventDims,
  type DownloadFailureClass,
  type DownloadStage,
  type EagerVerdict,
  type FeatureContext,
  type FeatureName,
  type FeatureUsedDims,
  type FetchOutcome,
  type HandoffUsed,
  type MbpsBucket,
  type NetworkSpeedDims,
  type PlayerErrorDims,
  type PlayerErrorClass,
  type PlayerStartDims,
  type PlayerStartOutcome,
  type PlayerSurface,
  type PrefAudioLang,
  type ProviderFetchDims,
  type ProviderSwitchDims,
  type ProbeVerdict,
  type QualityBucket,
  type QueryLengthBucket,
  type ScreenName,
  type ScreenViewDims,
  type SearchMode,
  type SearchPerformedDims,
  type SessionEndDims,
  type WatchEndDims,
} from "./types";

let cachedAppVersion: string | null = null;
let cachedConnection: ConnectionClass = "unknown";
let cachedTier: DeviceTier = "unknown";
let cachedPrefAudioLang: PrefAudioLang = "auto";

function appVersion(): string {
  if (cachedAppVersion) return cachedAppVersion;
  cachedAppVersion = Constants.expoConfig?.version || "0.0.0";
  return cachedAppVersion;
}

/** Refresh connection class from NetInfo (fire-and-forget). */
export function refreshConnectionClass(): void {
  NetInfo.fetch()
    .then((s) => {
      cachedConnection = mapConnection(s.type);
    })
    .catch(() => {});
}

function mapConnection(type: string): ConnectionClass {
  if (type === "wifi" || type === "ethernet") return "wifi";
  if (type === "cellular") return "cellular";
  if (type === "other" || type === "unknown") return "other";
  return "unknown";
}

/**
 * Device tier — coarse class only (no model string / fingerprint).
 * Defaults to "standard"; a future native bridge can refine this.
 */
export function setDeviceTier(tier: DeviceTier): void {
  cachedTier = tier;
}

/**
 * Sync the user's audio-language preference (from settings). Whitelisted
 * enum only — never free text. Call on settings load and on change.
 */
export function setPrefAudioLang(value: PrefAudioLang): void {
  if (value === "multi" || value === "hindi" || value === "english" || value === "auto") {
    cachedPrefAudioLang = value;
  }
}

function baseEnvelope() {
  return {
    ts: Date.now(),
    appVersion: appVersion(),
    connectionClass: cachedConnection,
    deviceTier: cachedTier,
  };
}

/**
 * E3 — shared connection-cap resolution. The stream selector ranks against
 * speedMbps × CDN_SUSTAIN_FACTOR; mirror that here so capBucket reads as the
 * tier the selector could actually use at fetch time. Async so the caller can
 * await the cached speed (no extra network work).
 */
export function resolveCapBucket(): Promise<QualityBucket> {
  return import("../networkSpeedTest")
    .then((m) => m.getCachedSpeed())
    .then((s) => bucketCappedQuality(s ? s.speedMbps : undefined))
    .catch(() => "unknown" as QualityBucket);
}

/** T2 — provider_fetch at FETCH completion (and optional head-probe fields). */
export async function trackProviderFetch(dims: ProviderFetchDims): Promise<void> {
  const payload: Record<string, string | number | boolean> = {
    providerId: dims.providerId,
    tmdbId: dims.tmdbId,
    mediaType: dims.mediaType,
  };
  if (dims.outcome !== undefined) payload.outcome = dims.outcome;
  if (dims.linkCountBucket !== undefined) {
    payload.linkCountBucket = dims.linkCountBucket;
  }
  if (dims.fetchMs !== undefined) payload.fetchMs = bucketFetchMs(dims.fetchMs);
  if (dims.probeMs !== undefined) payload.probeMs = bucketFetchMs(dims.probeMs);
  if (dims.verdict !== undefined) payload.verdict = dims.verdict;
  // E3 — attach the connection cap at fetch time if the caller didn't supply one.
  const capBucket = dims.capBucket ?? (await resolveCapBucket());
  payload.capBucket = capBucket;
  if (dims.chosenQualityBucket !== undefined) {
    payload.chosenQualityBucket = dims.chosenQualityBucket;
  }
  enqueue("provider_fetch", payload, baseEnvelope());
}

/** Convenience: fetch outcome + bucket from raw link count / ms. */
export function trackProviderFetchResult(args: {
  providerId: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  linkCount: number;
  fetchMs: number;
  failed?: boolean;
  capBucket?: QualityBucket;
  chosenQualityBucket?: QualityBucket;
}): void {
  const outcome: FetchOutcome = args.failed
    ? "fail"
    : args.linkCount === 0
      ? "empty"
      : "ok";
  void trackProviderFetch({
    providerId: args.providerId,
    tmdbId: args.tmdbId,
    mediaType: args.mediaType,
    outcome,
    linkCountBucket: bucketLinkCount(args.linkCount),
    fetchMs: args.fetchMs,
    capBucket: args.capBucket,
    chosenQualityBucket: args.chosenQualityBucket,
  });
}

/** Convenience: head-probe leg of provider_fetch. */
export function trackProviderProbe(args: {
  providerId: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  probeMs: number | undefined;
  verdict: ProbeVerdict;
  capBucket?: QualityBucket;
}): void {
  void trackProviderFetch({
    providerId: args.providerId,
    tmdbId: args.tmdbId,
    mediaType: args.mediaType,
    probeMs: args.probeMs ?? 0,
    verdict: args.verdict,
    capBucket: args.capBucket,
  });
}

/** T2 — watch_end at PerfSession close(). */
export function trackWatchEnd(
  dims: Omit<WatchEndDims, "durationMs" | "intentToFirstFrameMs"> & {
    durationMs: number;
    intentToFirstFrameMs: number;
  },
): void {
  const payload: Record<string, string | number | boolean> = {
    providerId: dims.providerId,
    mediaType: dims.mediaType,
    tmdbId: dims.tmdbId,
    durationMs: bucketDurationMs(dims.durationMs),
    fallbacks: dims.fallbacks,
    switchedProvider: dims.switchedProvider,
    intentToFirstFrameMs: bucketFetchMs(dims.intentToFirstFrameMs),
    handoff: dims.handoff,
    eager: dims.eager,
    prefAudioLang: cachedPrefAudioLang,
  };
  // E1 — enriched difficulty + outcome signals (optional dims, whitelisted).
  if (dims.stallMs !== undefined) payload.stallMs = bucketStallMs(dims.stallMs);
  if (dims.rebufferCount !== undefined) payload.rebufferCount = dims.rebufferCount;
  if (dims.reachedFirstFrame !== undefined) {
    payload.reachedFirstFrame = dims.reachedFirstFrame;
  }
  if (dims.gaveUp !== undefined) payload.gaveUp = dims.gaveUp;
  if (dims.qualityBucket !== undefined) payload.qualityBucket = dims.qualityBucket;
  if (dims.capBucket !== undefined) payload.capBucket = dims.capBucket;
  enqueue("watch_end", payload, baseEnvelope());
}

/** T2 — provider_switch at every beginSwitch site. */
export function trackProviderSwitchRaw(dims: ProviderSwitchDims): void {
  enqueue(
    "provider_switch",
    { from: dims.from, to: dims.to, reason: dims.reason },
    baseEnvelope(),
  );
}

/** Map + emit from HevcPlayer reason union. */
export function emitProviderSwitch(
  from: string,
  to: string,
  reason: "timeout" | "error" | "dead" | "user" | "switch",
): void {
  trackProviderSwitchRaw({ from, to, reason: mapSwitchReason(reason) });
}

/** T2 — app_launch once per cold start when launch summary logs. */
export function trackAppLaunch(dims: AppLaunchDims): void {
  enqueue(
    "app_launch",
    {
      splashMs: bucketFetchMs(dims.splashMs),
      contentReadyMs: bucketFetchMs(dims.contentReadyMs),
      reason: dims.reason,
      prefAudioLang: cachedPrefAudioLang,
      ...(dims.otaApplied === undefined ? {} : { otaApplied: dims.otaApplied }),
    },
    baseEnvelope(),
  );
}

/** P1 — one stall event at the end of each mid-play buffering episode. */
export function trackBufferStall(dims: BufferStallDims): void {
  enqueue(
    "buffer_stall",
    {
      positionMs: bucketPositionMs(dims.positionMs),
      durationMs: bucketStallMs(dims.durationMs),
      providerId: dims.providerId,
      mediaType: dims.mediaType,
      prefAudioLang: cachedPrefAudioLang,
    },
    baseEnvelope(),
  );
}

/** P1 — how a watch attempt went from the player's perspective. */
export function trackPlayerStart(dims: PlayerStartDims): void {
  enqueue(
    "player_start",
    {
      outcome: dims.outcome,
      intentToFirstFrameMs: bucketFetchMs(dims.intentToFirstFrameMs),
      providerId: dims.providerId,
      mediaType: dims.mediaType,
      prefAudioLang: cachedPrefAudioLang,
    },
    baseEnvelope(),
  );
}

/** P1 — classified playback error (no raw message/URL ever). */
export function trackPlayerError(dims: PlayerErrorDims): void {
  enqueue(
    "player_error",
    {
      errorClass: dims.errorClass,
      ...(dims.surface === undefined ? {} : { surface: dims.surface }),
      providerId: dims.providerId,
      mediaType: dims.mediaType,
      prefAudioLang: cachedPrefAudioLang,
    },
    baseEnvelope(),
  );
}

/** P2 — one count per screen focus (adoption histogram). */
export function trackScreenView(dims: ScreenViewDims): void {
  enqueue("screen_view", { screen: dims.screen }, baseEnvelope());
}

/** P2 — one event per completed search (live + settled). */
export function trackSearchPerformed(dims: SearchPerformedDims): void {
  enqueue(
    "search_performed",
    {
      queryLengthBucket: dims.queryLengthBucket,
      resultsCountBucket: dims.resultsCountBucket,
      tookMs: bucketFetchMs(dims.tookMs),
      failed: dims.failed,
      // E4 — directory-wide context (no query text).
      ...(dims.mediaType === undefined ? {} : { mediaType: dims.mediaType }),
      ...(dims.mode === undefined ? {} : { mode: dims.mode }),
      ...(dims.retriedAfterFail === undefined
        ? {}
        : { retriedAfterFail: dims.retriedAfterFail }),
    },
    baseEnvelope(),
  );
}

/** P3 — one session_end per foreground app session (AppState background). */
export function trackSessionEnd(dims: SessionEndDims): void {
  enqueue(
    "session_end",
    {
      durationMs: bucketDurationMs(dims.durationMs),
      eventCount: dims.eventCount,
      providerSwitches: dims.providerSwitches,
      prefAudioLang: cachedPrefAudioLang,
    },
    baseEnvelope(),
  );
}

/**
 * P3 — read the live session counters, emit session_end, and restart the
 * foreground-session window. Call exactly once on AppState → background.
 */
export function emitSessionEndOnBackground(): void {
  const snap = getSessionSnapshot();
  trackSessionEnd(snap);
  startNewSession();
}

/**
 * E5 — download lifecycle. Gated: wire ONLY after the F10 Kotlin fix ships so
 * "completed" is trustworthy. Never includes URLs, titles, names, or byte
 * counts — qualityBucket ≤ tier, failureClass is coarse only.
 */
export function trackDownloadEvent(dims: DownloadEventDims): void {
  enqueue(
    "download_event",
    {
      stage: dims.stage,
      ...(dims.provider === undefined ? {} : { provider: dims.provider }),
      ...(dims.qualityBucket === undefined
        ? {}
        : { qualityBucket: dims.qualityBucket }),
      ...(dims.failureClass === undefined
        ? {}
        : { failureClass: dims.failureClass }),
      ...(dims.mediaType === undefined
        ? {}
        : { mediaType: dims.mediaType }),
    },
    baseEnvelope(),
  );
}

/**
 * E6 — feature adoption. Enum + coarse context only; zero values or free text.
 * Context defaults to "player" (the most common surface) — callers pass others.
 */
export function trackFeatureUsed(
  feature: FeatureName,
  context: FeatureContext = "player",
): void {
  enqueue(
    "feature_used",
    { feature, context },
    baseEnvelope(),
  );
}

/**
 * E8 — one network_speed per COMPLETED speed test (client only re-runs when
 * cache is stale/missing, so this stays rare). Never exact Mbps.
 */
export function trackNetworkSpeed(dims: NetworkSpeedDims): void {
  enqueue(
    "network_speed",
    {
      mbpsBucket: dims.mbpsBucket,
      connectionClass: dims.connectionClass,
      latencyBucket: dims.latencyBucket,
    },
    baseEnvelope(),
  );
}

/**
 * E9 — crash/error boundary, coarse class only (detail lives in Sentry).
 * No file/line/stack is ever emitted here.
 */
export function trackBoundaryError(dims: BoundaryErrorDims): void {
  enqueue(
    "boundary_error",
    { errorClass: dims.errorClass },
    baseEnvelope(),
  );
}

export type {
  EagerVerdict,
  HandoffUsed,
  FetchOutcome,
  ProbeVerdict,
  PlayerStartOutcome,
  PlayerErrorClass,
  PlayerSurface,
  QualityBucket,
  MbpsBucket,
  DownloadStage,
  DownloadFailureClass,
  FeatureName,
  FeatureContext,
  SearchMode,
  ScreenName,
  QueryLengthBucket,
  PrefAudioLang,
};