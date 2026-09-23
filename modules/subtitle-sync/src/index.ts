import SubtitleSyncModule from "./SubtitleSyncModule";

export type ExtractErrorCode =
  | "busy"
  | "no-audio-track"
  | "unsupported-codec"
  | "unsupported-format"
  | "network"
  | "expired-url"
  | "timeout"
  | "decode-failed"
  | "unseekable"
  | "live-unsupported"
  | "drm-unsupported"
  | "cancelled"
  /** G3: cellular + projected download >20MB — user must confirm to continue. */
  | "confirm-bybytes";

export type ExtractResult =
  | {
      ok: true;
      rate: 100;
      startSec: number;
      endSec: number;
      bins: number;
      signalB64: string;
      /** R8-1/R8-3: end-of-window VAD choice + diagnostics (absent on some paths). */
      vadChose?: string;
      sileroDuty?: number;
      energyDuty?: number;
      sileroMaxProb?: number;
      totalChunks?: number;
    }
  | { ok: false; code: ExtractErrorCode; message: string };

export type ExtractOptions = {
  fromSec?: number;
  toSec?: number;
  useSilero?: boolean;
  headers?: Record<string, string>;
  audioTrackIndex?: number; // reserved, v1 uses first track
};

export type ProgressEvent = { progress: number };

let _progressListeners: Set<(p: number) => void> = new Set();
let _debugListeners: Set<(msg: string) => void> = new Set();

SubtitleSyncModule.addListener("onProgress", (ev: ProgressEvent) => {
  for (const fn of _progressListeners) fn(ev.progress);
});

SubtitleSyncModule.addListener("onDebug", (ev: { message: string }) => {
  // B4: the console mirror moved out of here. Logging from this event AND from
  // the 500ms scanStatus poller (autoSync) printed every [SubSyncFast] line
  // twice. The poller is the delivery-proof path, so it is the only logger now;
  // this event still fans out to programmatic onDebug() subscribers.
  for (const fn of _debugListeners) fn(ev.message);
});

export function onExtractProgress(fn: (progress: number) => void): () => void {
  _progressListeners.add(fn);
  return () => _progressListeners.delete(fn);
}

/** Subscribe to native pipeline diagnostics (also auto-logged to console). */
export function onDebug(fn: (msg: string) => void): () => void {
  _debugListeners.add(fn);
  return () => _debugListeners.delete(fn);
}

export async function extractAsync(
  uri: string,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  return SubtitleSyncModule.extractAsync(uri, {
    fromSec: options.fromSec ?? 0,
    toSec: options.toSec ?? 900,
    useSilero: options.useSilero ?? false,
    headers: options.headers ?? {},
    audioTrackIndex: options.audioTrackIndex,
  });
}

export type ScanOptions = ExtractOptions & {
  /** Playback speed for the headless scan — higher is faster, 1—4. */
  speed?: number;
  /** "progressive" (mp4/mkv/webm, sniffed) or "hls". */
  container?: "progressive" | "hls";
  /** Preferred audio-track language (2-letter ISO), matched against track language. */
  audioLang?: string;
  /** R5-3: log Silero tensor metadata + the first 200 probabilities per window. */
  vadDebug?: boolean;
  /**
   * Stage D: Silero mark-threshold hysteresis (engineConstants.MARK_ON /
   * MARK_OFF). Omit to use native F6 defaults (0.35 / 0.25).
   */
  vadMarkOn?: number;
  vadMarkOff?: number;
  /**
   * G1/G4-3: FINAL player-aware scan budget in Mbps (link − player − 1.0,
   * floor 0.5, cap 0.6×link — computed in JS). Native reads are capped at
   * this rate directly (no fixed fraction). 0/omit = uncapped.
   */
  throttleMbps?: number;
  /** G3: on cellular, windows projecting >20MB return confirm-bybytes unless allowConfirmBytes. */
  cellular?: boolean;
  /** G3: user already approved the cellular download for this attempt. */
  allowConfirmBytes?: boolean;
};

/**
 * Remote-source scan: headless Media3 player (muted, video disabled) taps PCM
 * at `speed`Ã—. Use for ALL remote sources â€” the framework MediaExtractor path
 * (extractAsync) cannot be trusted over HTTP.
 */
export async function scanAsync(
  uri: string,
  options: ScanOptions = {},
): Promise<ExtractResult> {
  return SubtitleSyncModule.scanAsync(uri, {
    fromSec: options.fromSec ?? 0,
    toSec: options.toSec ?? 300,
    useSilero: options.useSilero ?? false,
    headers: options.headers ?? {},
    speed: options.speed ?? 2,
    container: options.container ?? "progressive",
    audioLang: options.audioLang,
    vadDebug: options.vadDebug ?? false,
    vadMarkOn: options.vadMarkOn,
    vadMarkOff: options.vadMarkOff,
    throttleMbps: options.throttleMbps ?? 0,
    cellular: options.cellular ?? false,
    allowConfirmBytes: options.allowConfirmBytes ?? false,
  });
}

/**
 * Poll the running scan's status: { phase, progress, trace }.
 * The UI can poll this as a fallback when progress events are not delivered.
 */
export type ScanStatus = {
  phase: string;
  progress: number;
  trace: string;
  /** R5-5: monotonic count of trace lines ever emitted by this scan. */
  lineCount?: number;
  /** R5-5: the most recent trace lines (bounded by the native ring). */
  traceLines?: string[];
};

export function scanStatus(): ScanStatus {
  try {
    return SubtitleSyncModule.scanStatus();
  } catch {
    return { phase: "idle", progress: 0, trace: "" };
  }
}
export function cancel(): void {
  SubtitleSyncModule.cancel();
}

/**
 * G2: tell the scan pipeline the player is rebuffers. While true, FastScanJob
 * pauses network reads (stall watchdog stays fed) so a rebuffer and a scan do
 * not fight for the same link.
 */
export function setPlayerStruggling(struggling: boolean): void {
  SubtitleSyncModule.setPlayerStruggling(struggling);
}

/**
 * A5: isolation probe for the playback PCM tap (Stage A). Snapshot of the
 * static PlayerAudioTap counters — bytes/rate independent of any watch session.
 */
export type TapProbeSnapshot = {
  totalBytes: number;
  lastPcmWallMs: number;
  /** ms since last PCM, or -1 if none yet. */
  ageMs: number;
  sampleRate: number;
  channelCount: number;
  encoding: number;
  flushes: number;
  segmentResets: number;
  listening: boolean;
  monotonicMs: number;
};

export function tapProbe(): TapProbeSnapshot {
  return SubtitleSyncModule.tapProbe();
}

/**
 * I-4: rolling player-throughput in Mbps over the last 5s (from expo-video's
 * PlayerTraffic meter). Returns -1 when no samples yet (cold start) — callers
 * should fall back to a fixed estimate. Returns 0 when the player is paused
 * or idle (no bytes in the window).
 */
export function playerThroughputMbps(): number {
  try {
    return SubtitleSyncModule.playerThroughputMbps();
  } catch {
    return -1;
  }
}

/** Zero the tap counters so a rate measurement starts clean. */
export function tapProbeReset(): void {
  SubtitleSyncModule.tapProbeReset();
}

// ─── Stage B: watch-sync (third slot — concurrent with fetch scans) ───

export type WatchSignalEvent = {
  ok: true;
  rate: 100;
  startSec: number;
  endSec: number;
  bins: number;
  signalB64: string;
  vadChose?: string;
  sileroDuty?: number;
  energyDuty?: number;
  sileroMaxProb?: number;
  totalChunks?: number;
};

export type ActivateWatchSyncOptions = {
  /** Content-time anchor (seconds) — usually current playback position. */
  fromSec: number;
  /** Window length in seconds (default 90). */
  windowSec?: number;
  /** Use Silero alongside Energy (native defaults apply when omitted). */
  useSilero?: boolean;
  /**
   * Stage D: Silero mark-threshold hysteresis (engineConstants.MARK_ON /
   * MARK_OFF). Omit to use native F6 defaults (0.35 / 0.25).
   */
  vadMarkOn?: number;
  vadMarkOff?: number;
};

export type ActivateWatchSyncResult = {
  ok: boolean;
  active: boolean;
  anchorSec: number;
  windowSec: number;
};

let _watchSignalListeners: Set<(s: WatchSignalEvent) => void> = new Set();

SubtitleSyncModule.addListener("onWatchSignal", (ev: WatchSignalEvent) => {
  for (const fn of _watchSignalListeners) fn(ev);
});

/**
 * Subscribe to watch-sync signal windows. Each event is a correlation-ready
 * SpeechSignal-shaped payload covering [startSec, endSec] of content time.
 * Returns unsubscribe.
 */
export function onWatchSignal(fn: (s: WatchSignalEvent) => void): () => void {
  _watchSignalListeners.add(fn);
  return () => _watchSignalListeners.delete(fn);
}

/**
 * Start (or replace) a watch session on the playback PCM tap.
 * Outside the fetch-scan busy gate — concurrent scans are allowed.
 */
export async function activateWatchSync(
  options: ActivateWatchSyncOptions,
): Promise<ActivateWatchSyncResult> {
  return SubtitleSyncModule.activateWatchSync({
    fromSec: options.fromSec,
    windowSec: options.windowSec ?? 90,
    useSilero: options.useSilero ?? false,
    vadMarkOn: options.vadMarkOn,
    vadMarkOff: options.vadMarkOff,
  });
}

/** Re-base the watch window after a seek resolves. Emits any usable partial first. */
export function watchAnchor(toSec: number): boolean {
  return SubtitleSyncModule.watchAnchor(toSec);
}

/** Stop the watch session (source change, unmount, end, kill-switch). */
export function stopWatchSync(): boolean {
  return SubtitleSyncModule.stopWatchSync();
}

export type WatchSyncStatus = {
  active: boolean;
  anchorSec?: number;
  windowToSec?: number;
  decodedSpanMs?: number;
  hasSignal?: boolean;
  emits?: number;
  droppedBuffers?: number;
  silero?: boolean;
  monotonicMs?: number;
};

export function watchSyncStatus(): WatchSyncStatus {
  try {
    return SubtitleSyncModule.watchSyncStatus();
  } catch {
    return { active: false };
  }
}

export type ProbeResult =
  | { ok: true; live: boolean; drmProtected: boolean; muxedOnly: boolean }
  | { ok: false; code: ExtractErrorCode; message: string };

export type ProbeOptions = {
  headers?: Record<string, string>;
};

/**
 * Inspect an m3u8 playlist URL without decoding: returns live/drm/muxed flags
 * (used to gate HLS auto-sync and pick scan windows) or a clean error code.
 */
export async function probeAsync(
  uri: string,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  return SubtitleSyncModule.probeAsync(uri, {
    headers: options.headers ?? {},
  });
}
