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
import {
  enqueue,
  getSessionSnapshot,
  startNewSession,
  generateSessionId,
  getSessionId as queueGetSessionId,
  setSessionId,
  resetSessionCounters,
} from "./queue";
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
  type SessionStartDims,
  type DetailViewedDims,
  type SearchResultClickedDims,
  type OnboardingStepDims,
  type WatchProgressDims,
  type AdSlotViewDims,
  type AdImpressionDims,
  type OnboardingStep,
  type PositionClickedBucket,
  type DwellingSecondsBucket,
  bucketDwellingSeconds,
  bucketPositionClicked,
  bucketDaysSinceInstall,
} from "./types";

let cachedAppVersion: string | null = null;
let cachedConnection: ConnectionClass = "unknown";
let cachedTier: DeviceTier = "unknown";
let cachedPrefAudioLang: PrefAudioLang = "auto";

// Track which features have been used this session (for retention analysis).
const sessionFeaturesUsed = new Set<string>();

// Track whether onboarding steps have fired (one-shot per install).
const onboardingStepsFired = new Set<string>();

/** Days since the anonId was created (approx install time). */
let installedAtEpoch = 0;

function getDaysSinceInstall(): number {
  if (!installedAtEpoch) return 0;
  return Math.max(0, Math.floor((Date.now() - installedAtEpoch) / 86_400_000));
}

/** Record install time when anonId is first created. */
export function recordInstallTime(): void {
  if (!installedAtEpoch) {
    installedAtEpoch = Date.now();
  }
}

function appVersion(): string {
  if (cachedAppVersion) return cachedAppVersion;
  // nativeApplicationVersion = the versionName actually installed on the
  // device (expoConfig.version is the JS-bundle-time value and can drift
  // from installed builds after an OTA/standalone mismatch).
  cachedAppVersion =
    (Constants.nativeApplicationVersion as string | null) ||
    Constants.expoConfig?.version ||
    "0.0.0";
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
  if (
    value === "multi" ||
    value === "hindi" ||
    value === "english" ||
    value === "auto"
  ) {
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
export async function trackProviderFetch(
  dims: ProviderFetchDims,
): Promise<void> {
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
  // E2 — which surface closed the intent (direct native player vs embed
  // webview). "direct" when absent (legacy rows / direct pipeline default).
  if (dims.surface !== undefined) payload.surface = dims.surface;
  // E1 — enriched difficulty + outcome signals (optional dims, whitelisted).
  if (dims.stallMs !== undefined) payload.stallMs = bucketStallMs(dims.stallMs);
  if (dims.rebufferCount !== undefined)
    payload.rebufferCount = dims.rebufferCount;
  if (dims.reachedFirstFrame !== undefined) {
    payload.reachedFirstFrame = dims.reachedFirstFrame;
  }
  if (dims.gaveUp !== undefined) payload.gaveUp = dims.gaveUp;
  if (dims.qualityBucket !== undefined)
    payload.qualityBucket = dims.qualityBucket;
  if (dims.capBucket !== undefined) payload.capBucket = dims.capBucket;
  // P5 — completion curve + resume correction (whitelisted; server mirrors).
  if (dims.watchedPctBucket !== undefined) {
    payload.watchedPctBucket = dims.watchedPctBucket;
  }
  if (dims.resumeCorrection !== undefined) {
    payload.resumeCorrection = dims.resumeCorrection;
  }
  enqueue("watch_end", payload, baseEnvelope());
}

/** T2 — provider_switch at every beginSwitch site. */
export function trackProviderSwitchRaw(dims: ProviderSwitchDims): void {
  const sessionId = queueGetSessionId();
  enqueue(
    "provider_switch",
    { sessionId, from: dims.from, to: dims.to, reason: dims.reason },
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
    },
    baseEnvelope(),
  );
}

/** P1 — how a watch attempt went from the player's perspective. */
export function trackPlayerStart(dims: PlayerStartDims): void {
  enqueue(
    "player_start",
    {
      sessionId: queueGetSessionId(),
      outcome: dims.outcome,
      intentToFirstFrameMs: bucketFetchMs(dims.intentToFirstFrameMs),
      providerId: dims.providerId,
      mediaType: dims.mediaType,
    },
    baseEnvelope(),
  );
}

/** P1 — classified playback error (no raw message/URL ever). */
export function trackPlayerError(dims: PlayerErrorDims): void {
  enqueue(
    "player_error",
    {
      sessionId: queueGetSessionId(),
      errorClass: dims.errorClass,
      ...(dims.surface === undefined ? {} : { surface: dims.surface }),
      providerId: dims.providerId,
      mediaType: dims.mediaType,
    },
    baseEnvelope(),
  );
}

/** P2 — one count per screen focus (adoption histogram). */
export function trackScreenView(dims: ScreenViewDims): void {
  enqueue(
    "screen_view",
    { sessionId: queueGetSessionId(), screen: dims.screen },
    baseEnvelope(),
  );
}

/** P2 — one event per completed search (live + settled). */
export function trackSearchPerformed(dims: SearchPerformedDims): void {
  enqueue(
    "search_performed",
    {
      sessionId: queueGetSessionId(),

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

/** P4 — watch-page opened: the top of the playback funnel (direct vs embed). */
// Dedupe guard: dev StrictMode remounts the watch route twice → one event.
let lastWatchOpenedAt = 0;
export function trackWatchOpened(dims: {
  surface: "direct" | "embed";
  mediaType?: "movie" | "tv";
}): void {
  const now = Date.now();
  if (now - lastWatchOpenedAt < 1000) return;
  lastWatchOpenedAt = now;
  enqueue(
    "watch_opened",
    {
      sessionId: queueGetSessionId(),
      surface: dims.surface,
      ...(dims.mediaType ? { mediaType: dims.mediaType } : {}),
    },
    baseEnvelope(),
  );
}

/**
 * P5 — seek latency: time from a user seek REQUEST (double-tap, ±10 button,
 * or scrub release) to the playhead actually landing on target. This is the
 * metric that validates the optimistic-seek/seek-lock UX work.
 */
export function trackSeekLatency(dims: {
  latencyMs: number;
  kind: "double_tap" | "buttons" | "scrub" | "resume";
  providerId?: string;
  mediaType?: "movie" | "tv";
}): void {
  enqueue(
    "seek_latency",
    {
      sessionId: queueGetSessionId(),
      latencyMs: bucketFetchMs(dims.latencyMs),
      kind: dims.kind,
      ...(dims.providerId ? { providerId: dims.providerId } : {}),
      ...(dims.mediaType ? { mediaType: dims.mediaType } : {}),
    },
    baseEnvelope(),
  );
}

/**
 * P5 — the user left the app while a source switch was still in flight —
 * an impatience/satisfaction signal for the switching experience.
 */
export function trackExitDuringSwitch(dims: {
  surface: "direct" | "embed";
  switchKind: "auto-fallback" | "manual-pick";
}): void {
  enqueue(
    "exit_during_switch",
    {
      sessionId: queueGetSessionId(),
      surface: dims.surface,
      switchKind: dims.switchKind,
    },
    baseEnvelope(),
  );
}

/** P3 — one session_start per foreground app session. */
export function trackSessionStart(
  resumeFromBackground: boolean,
  lastScreen?: string,
): void {
  // On resume from background, the session was already started (new ID
  // generated + counters reset) when the app was backgrounded via
  // emitSessionEndOnBackground → startNewSession(). Reuse that ID so
  // the session_start emitted here pairs with the session_end that
  // started this session.
  const sessionId = queueGetSessionId() || generateSessionId();
  // Anchor the session clock to when trackSessionStart actually fired.
  // For cold-start / gate-open paths this corrects the drift between
  // module init and the first foreground session; for resume paths
  // startNewSession() already reset sessionStartedAt on background.
  if (!resumeFromBackground) {
    // Reset counters + start time for a fresh foreground session while
    // keeping the sessionId we just generated above.
    resetSessionCounters(true);
  }
  setSessionId(sessionId);
  enqueue(
    "session_start",
    {
      sessionId,
      resumeFromBackground,
      ...(lastScreen ? { lastScreen } : {}),
    },
    baseEnvelope(),
  );
  // Record install time on first session start (approx install epoch).
  recordInstallTime();
}

/** P3 — one session_end per foreground app session (AppState background). */
export function trackSessionEnd(dims: SessionEndDims): void {
  enqueue(
    "session_end",
    {
      sessionId: dims.sessionId,
      durationMs: bucketDurationMs(dims.durationMs),
      eventCount: dims.eventCount,
      watchCount: dims.watchCount,
      totalWatchMs: bucketDurationMs(dims.totalWatchMs),
      providerSwitches: dims.providerSwitches,
      prefAudioLang: cachedPrefAudioLang,
      ...(dims.lastScreen ? { lastScreen: dims.lastScreen } : {}),
      ...(dims.crashed === true ? { crashed: true } : {}),
      ...(dims.backgroundedWithActiveWatch === true
        ? { backgroundedWithActiveWatch: true }
        : {}),
    },
    baseEnvelope(),
  );
}

/**
 * P3 — read the live session counters, emit session_end, and restart the
 * foreground-session window. Call exactly once on AppState → background.
 * Zero-signal sessions (no events, no screen seen) are dropped instead of
 * written as junk rows — iOS/Android can fire background during transitions.
 */
export function emitSessionEndOnBackground(
  backgroundedWithActiveWatch = false,
): void {
  const snap = getSessionSnapshot();
  if (snap.eventCount > 0 || snap.lastScreen) {
    trackSessionEnd({
      ...snap,
      crashed: snap.watchCount === 0 && snap.eventCount > 0 ? false : undefined,
      backgroundedWithActiveWatch,
    } as SessionEndDims);
  }
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
      ...(dims.mediaType === undefined ? {} : { mediaType: dims.mediaType }),
    },
    baseEnvelope(),
  );
}

/**
 * E6 — feature adoption. Enum + coarse context only; zero values or free text.
 * Context defaults to "player" (the most common surface) — callers pass others.
 * Tracks first-time vs repeat usage this session via useIndex dim.
 */
export function trackFeatureUsed(
  feature: FeatureName,
  context: FeatureContext = "player",
  extra?: { fromTab?: string; surface?: "direct" | "embed" },
): void {
  // Track first-time vs repeat usage this session.
  const isFirstUseThisSession = !sessionFeaturesUsed.has(feature);
  sessionFeaturesUsed.add(feature);
  enqueue(
    "feature_used",
    {
      feature,
      context,
      ...(extra?.fromTab ? { fromTab: extra.fromTab } : {}),
      ...(extra?.surface ? { surface: extra.surface } : {}),
      ...(isFirstUseThisSession ? { useIndex: 1 } : { useIndex: 2 }),
    },
    baseEnvelope(),
  );
}

/** Reset session-level feature tracking (called on session start). */
export function resetSessionFeatures(): void {
  sessionFeaturesUsed.clear();
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
  enqueue("boundary_error", { errorClass: dims.errorClass }, baseEnvelope());
}

/** P2 — watch progress threshold crossing (25/50/75/100%). */
export function trackWatchProgress(dims: WatchProgressDims): void {
  enqueue(
    "watch_progress",
    {
      sessionId: queueGetSessionId(),
      tmdbId: dims.tmdbId,
      mediaType: dims.mediaType,
      ...(dims.season ? { season: dims.season } : {}),
      ...(dims.episode ? { episode: dims.episode } : {}),
      watchedPctThreshold: dims.watchedPctThreshold,
      ...(dims.qualityBucket ? { qualityBucket: dims.qualityBucket } : {}),
      ...(dims.providerId ? { providerId: dims.providerId } : {}),
      ...(dims.surface ? { surface: dims.surface } : {}),
    },
    baseEnvelope(),
  );
}

/** P2 — detail page viewed with dwelling time. */
export function trackDetailViewed(dims: DetailViewedDims): void {
  enqueue(
    "detail_viewed",
    {
      sessionId: queueGetSessionId(),
      screen: dims.screen,
      tmdbId: dims.tmdbId,
      mediaType: dims.mediaType,
      fromTab: dims.fromTab,
      dwellingSecondsBucket: dims.dwellingSecondsBucket,
    },
    baseEnvelope(),
  );
}

/** P2 — search result clicked (tracks search success). */
export function trackSearchResultClicked(dims: SearchResultClickedDims): void {
  enqueue(
    "search_result_clicked",
    {
      sessionId: queueGetSessionId(),
      queryLengthBucket: dims.queryLengthBucket,
      resultsCountBucket: dims.resultsCountBucket,
      tookMs: bucketFetchMs(dims.tookMs),
      positionClickedBucket: dims.positionClickedBucket,
      ...(dims.mediaType ? { mediaType: dims.mediaType } : {}),
      ...(dims.mode ? { mode: dims.mode } : {}),
    },
    baseEnvelope(),
  );
}

/** Onboarding step tracking — one-shot per step per install. */
export function trackOnboardingStep(step: OnboardingStep): void {
  if (onboardingStepsFired.has(step)) return;
  onboardingStepsFired.add(step);
  enqueue(
    "onboarding_step",
    {
      step,
      daysSinceInstallBucket: bucketDaysSinceInstall(getDaysSinceInstall()),
    },
    baseEnvelope(),
  );
}

/**
 * M1 — a candidate ad slot rendered on a focused screen (an impression
 * opportunity). Measurement only: the app shows no ads. view carries the
 * fidelity tier (tierA = rendered on visit; tierB = viewport-verified).
 */
export function trackAdSlotView(dims: AdSlotViewDims): void {
  enqueue(
    "ad_slot_view",
    {
      sessionId: queueGetSessionId(),
      slot: dims.slot,
      screen: dims.screen,
      view: dims.view,
    },
    baseEnvelope(),
  );
}

/**
 * M2 — a real ad SDK outcome inside an enabled slot (only fires when the
 * remote ads-config has the SDK active; never fires in measurement-only).
 */
export function trackAdImpression(dims: AdImpressionDims): void {
  enqueue(
    "ad_impression",
    {
      sessionId: queueGetSessionId(),
      slot: dims.slot,
      network: dims.network,
      format: dims.format,
      outcome: dims.outcome,
      test: dims.test,
    },
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
  OnboardingStep,
  PositionClickedBucket,
  DwellingSecondsBucket,
};
