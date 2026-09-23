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
  | "cancelled";

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
