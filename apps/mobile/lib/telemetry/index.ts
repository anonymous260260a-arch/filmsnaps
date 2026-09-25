/**
 * Telemetry — privacy-first anonymous usage events (Phase 4 Package B + Phase 5).
 *
 * Public surface:
 *   setTelemetryGate({ legalAccepted, analyticsEnabled })
 *   trackProviderFetch / trackProviderFetchResult / trackProviderProbe
 *   trackWatchEnd / emitProviderSwitch / trackAppLaunch
 *   trackPlayerError / trackDownloadEvent / trackFeatureUsed
 *   trackNetworkSpeed / trackBoundaryError / resolveCapBucket
 *
 * Hard rules (enforced in types.ts + queue.ts + server):
 *   - No user/device/advertising/session identifiers ever.
 *   - No IP read, logged, or stored.
 *   - No free text / URLs / titles — whitelisted fields only.
 *   - Nothing queues or sends before legalAccepted AND analyticsEnabled.
 *   - Toggle off → drop queue, stop sends immediately.
 */

export {
  setTelemetryGate,
  isTelemetryOpen,
  flushNow,
  resetTelemetryForTests,
} from "./queue";

export {
  trackProviderFetch,
  trackProviderFetchResult,
  trackProviderProbe,
  trackWatchEnd,
  emitProviderSwitch,
  trackProviderSwitchRaw,
  trackAppLaunch,
  trackBufferStall,
  trackPlayerStart,
  trackPlayerError,
  trackScreenView,
  trackSearchPerformed,
  trackSessionEnd,
  emitSessionEndOnBackground,
  trackDownloadEvent,
  trackFeatureUsed,
  trackNetworkSpeed,
  trackBoundaryError,
  refreshConnectionClass,
  setDeviceTier,
  setPrefAudioLang,
  resolveCapBucket,
} from "./track";

export {
  EVENT_DIMS,
  scrub,
  bucketFetchMs,
  bucketDurationMs,
  bucketStallMs,
  bucketPositionMs,
  bucketLinkCount,
  bucketQueryLength,
  bucketQuality,
  bucketCappedQuality,
  bucketMbps,
  bucketLatencyMs,
  mapSwitchReason,
} from "./types";

export type {
  TelemetryEventName,
  TelemetryEnvelope,
  LinkCountBucket,
  FetchOutcome,
  ProbeVerdict,
  SwitchReason,
  HandoffUsed,
  EagerVerdict,
  ColdStartReasonTelemetry,
  ConnectionClass,
  DeviceTier,
  ProviderFetchDims,
  WatchEndDims,
  ProviderSwitchDims,
  AppLaunchDims,
  BufferStallDims,
  PlayerStartDims,
  PlayerErrorDims,
  ScreenViewDims,
  SearchPerformedDims,
  SessionEndDims,
  DownloadEventDims,
  FeatureUsedDims,
  NetworkSpeedDims,
  BoundaryErrorDims,
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
} from "./types";
