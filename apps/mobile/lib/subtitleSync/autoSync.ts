/**
 * Orchestrator - resolve -> extract -> analyze -> apply.
 * Streaming-first, cache keyed by contentId, with re-resolve/retry.
 *
 * Speed model (2026-09 rework, Android-first):
 *   - scan at 4x (Android native cap); remote progressive early is 180s (P2-4),
 *     HLS 240/300, local 900/480
 *   - the EARLY window scans first; the LATE window always scans too (when it
 *     has >= 8 cues), because a lone window can lock onto a music/beat peak
 *   - application requires a two-window agreement (diff < 1.5s) OR a strong
 *     early result that the late window structurally cannot judge: the late
 *     scan was unavailable (unseekable) or the early offset pushes the late
 *     cue set out of the late scan span (see lateCannotJudge), OR one window
 *     decisively more confident than the other (see the arbitration block - a
 *     less-confident window's disagreement is not a veto)
 *   - a clipped window (keep < 0.7) is DEFERRED behind cross-validation (P2-2):
 *     the anchored rescan runs only if the cross-check cannot decide AND that
 *     window is the loser - most files skip both rescans entirely
 *   - per-window correlation cache skips re-scanning a window on retry
 *   - Silero is the production VAD (kill-switch SUBTITLE_SYNC_SILERO below);
 *     EnergyVad remains the fallback when Silero duty < 0.05 or the kill-switch
 *     is flipped (JS rebundle only — no native rebuild needed)
 */

import type { SubFormat, SyncOutcome, SpeechSignal } from "./types";
import { validateSignal } from "./types";
import type { SourceRef, NetworkType } from "./source";
import { canAutoSync, windowPlan } from "./source";
import { parseSubtitles } from "./parseSubtitles";
import {
  findOffset,
  refineNear,
  confidence,
  keptFraction,
  contrastScore,
  solveDrift,
  meanCueStart,
  APPLY_CONF,
  TRY_CONF,
} from "./correlate";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * R8-2 production kill-switch: set false to force EnergyVad without a native
 * rebuild (JS rebundle on reload is enough).
 */
export const SUBTITLE_SYNC_SILERO = true;

/**
 * P2-1 kill-switch: set false to skip early checkpoint apply (JS rebundle only).
 * When true, an early window with conf >= 0.70, sharp lead >= 15% over the
 * runner-up, and keep >= 0.70 applies immediately; the late window continues as
 * silent verification (agree → silent confirm; decisive late win → re-apply +
 * toast; inconclusive → keep the provisional apply).
 *
 * 2026-09 rework: bars dropped from 0.75/0.25/0.9 — the old pair missed every
 * clean hit outside the perfect Luther/DEMAND class and let high-keep near-
 * misses through on sharp alone. The outcome counter is the feedback loop;
 * revisit after ~2 weeks of weekKeys.
 */
export const CHECKPOINT_EARLY_APPLY = true;
export const CHECKPOINT_CONF = 0.7;
export const CHECKPOINT_SHARP = 0.15;
export const CHECKPOINT_KEEP = 0.7;

/**
 * Stage C: shared applyOnce gate — one offset rewrite / onSynced at a time
 * across the fetch path (applyOrConfirm) and the watch path (watchSync).
 * Returns fn()'s value, or null when another apply already holds the gate.
 */
let applyOnceHeld = false;
export async function runApplyOnce<T>(fn: () => Promise<T>): Promise<T | null> {
  if (applyOnceHeld) return null;
  applyOnceHeld = true;
  try {
    return await fn();
  } finally {
    applyOnceHeld = false;
  }
}

/** R8-3: known-good Silero asset identity for the verdict record. */
const SILERO_MODEL_SHA =
  "2623A2953F6FF3D2C1E61740C6CDB7168133479B267DFEF114A4A3CC5BDD788F";
/** Android ORT pin (modules/subtitle-sync/android/build.gradle). iOS reports unknown. */
const SILERO_ORT_VERSION = "1.20.0";

/**
 * R5-3: Silero diagnostics switch. Deliberately a module-level flag rather than
 * another positional argument through extractWithRetry - it is debug-only, off
 * by default, and read at the single scanAsync call site.
 */
let vadDebugEnabled = false;
/**
 * G1/G3/G4-3: scan governor knobs, set by autoSync before extractWithRetry runs.
 * throttleMbps = FINAL player-aware scan budget (Mbps) — native no longer
 * multiplies by 0.35; 0 = uncapped.
 */
let scanThrottleMbps = 0;
let scanCellular = false;
let scanAllowConfirmBytes = false;
/**
 * G4-3: player-aware budget derivation.
 * scanBudget = link − player − 1.0 (SAFETY), floor 0.5, cap 0.6×link.
 * playerMbps: no actual player-throughput meter exists yet (perfMetrics /
 * NetworkMonitor only track rebuffers + speed tests) → fallback 3 Mbps.
 */
const PLAYER_FALLBACK_MBPS = 3.0;
const BUDGET_SAFETY_MBPS = 1.0;
const BUDGET_FLOOR_MBPS = 0.5;
const BUDGET_LINK_CAP_FRACTION = 0.6;

function computeScanBudgetMbps(linkMbps: number, playerMbps?: number): number {
  if (!(linkMbps > 0)) return 0;
  const player =
    typeof playerMbps === "number" && playerMbps > 0
      ? playerMbps
      : PLAYER_FALLBACK_MBPS;
  const cap = linkMbps * BUDGET_LINK_CAP_FRACTION;
  const raw = linkMbps - player - BUDGET_SAFETY_MBPS;
  return Math.max(BUDGET_FLOOR_MBPS, Math.min(cap, raw));
}
import {
  applyOffset,
  writeShiftedSubtitleFile,
  mimeTypeForFormat,
  appliedOffsetMs,
} from "./applySync";
import {
  getCachedSync,
  setCachedSync,
  getCachedWindow,
  setCachedWindow,
  type CachedSync,
} from "./cache";
import {
  extractAsync,
  scanAsync,
  onExtractProgress,
  scanStatus,
  cancel,
} from "expo-subtitle-sync";
import { getCachedSpeed } from "../networkSpeedTest";

// Native pipeline trace reaches Metro via two paths (event listener in
// expo-subtitle-sync's index.ts and the 500ms status poller) - both log
// already, so no additional subscription here.

export type AutoSyncOptions = {
  source: SourceRef;
  durationSec: number;
  subtitleText: string;
  subtitleFormat: SubFormat;
  subtitleCacheKey: string;
  /** file:// URI of the subtitle source (for offset file-rewrite apply). */
  subtitleUri?: string;
  /** Preferred audio-track language (2-letter ISO), matched against track language. */
  subtitleLanguage?: string;
  /** Silero VAD (neural, music-robust). Defaults to SUBTITLE_SYNC_SILERO. */
  useSilero?: boolean;
  network: NetworkType;
  platform: "android" | "ios";
  onProgress?: (p: number, stage: "extract" | "analyze" | "done") => void;
  /** G3: user already approved a >20MB cellular download for this attempt. */
  allowConfirmBytes?: boolean;
};

/** Read subtitle file, strip BOM + extra whitespace for SRT/VTT. */
function cleanSubtitle(text: string, format: SubFormat): string {
  let t = text.replace(/^\uFEFF/, ""); // strip BOM
  if (format === "srt" || format === "vtt") {
    t = t.replace(/\r/g, "");
  }
  return t;
}

/**
 * Extract/scan with retry: resolve fresh URL, retry once on expired-url or network.
 * Routing:  local  -> framework extractor (fast, seekable)
 *           hls    -> headless native HLS scan player (probe-gated, `speed`x)
 *           remote -> headless native scan player at `speed`x - the framework
 *                    HTTP stack cannot be trusted for remote progressive files.
 */
async function extractWithRetry(
  source: SourceRef,
  fromSec: number,
  toSec: number,
  useSilero: boolean,
  speed: number,
  audioLang: string | undefined,
  onProgress?: (p: number) => void,
): Promise<
  | {
      ok: true;
      startSec: number;
      endSec: number;
      bins: number;
      signalB64: string;
      vadChose?: string;
      sileroDuty?: number;
      energyDuty?: number;
      sileroMaxProb?: number;
      totalChunks?: number;
    }
  | { ok: false; code: string; message: string }
> {
  let { uri, headers } = await source.resolve();
  for (let attempt = 0; ; attempt++) {
    // Subscribe to progress events during extraction
    let unsub: (() => void) | undefined;
    // Poll the native scan status while the scan runs: events may not be
    // delivered on some RN setups, so progress/trace ride the poll instead.
    // Declared per-attempt and ALWAYS torn down in this attempt's finally —
    // a previous design only cleared the poller on scanAsync settlement, so
    // a cancelled scan (native never resolves the promise) left the interval
    // running and a restart produced interleaved [SubSyncFast] lines.
    let poller: ReturnType<typeof setInterval> | undefined;
    const stopAttempt = () => {
      unsub?.();
      unsub = undefined;
      if (poller) {
        clearInterval(poller);
        poller = undefined;
      }
    };
    try {
      if (onProgress) {
        unsub = onExtractProgress(onProgress);
      }
      let finalFlush: () => void = () => {};
      if (source.kind !== "local") {
        // R5-5: the native side keeps a MONOTONIC line counter plus the last N
        // lines, so the poller prints lines by INDEX. Slicing the text by length
        // desynced whenever the trace ring trimmed (that produced the malformed
        // "0 size=8192" line, and silently dropped "signal summary:"/"DONE" when
        // more than a ring's worth of lines arrived between two polls). Now a
        // gap is reported instead of hidden.
        let printedLines = 0;
        const flushTrace = () => {
          try {
            const st = scanStatus();
            if (st.progress > 0) onProgress?.(st.progress);
            const total = typeof st.lineCount === "number" ? st.lineCount : 0;
            const tail = Array.isArray(st.traceLines) ? st.traceLines : [];
            if (total <= printedLines) return;
            const newCount = total - printedLines;
            if (newCount > tail.length) {
              console.log(
                `[SubSyncFast] (${newCount - tail.length} earlier trace lines not retained by the native ring)`,
              );
            }
            for (const line of tail.slice(
              Math.max(0, tail.length - newCount),
            )) {
              if (line.trim()) console.log(`[SubSyncFast] ${line}`);
            }
            printedLines = total;
          } catch {
            // flush is best-effort
          }
        };
        poller = setInterval(flushTrace, 500);
        // Final flush: DONE / hls prefetch stats land in the ring after the
        // last 500ms tick and before onResult nulls scanJob — without this
        // they never reach Metro (F3).
        finalFlush = flushTrace;
      }
      const r =
        source.kind === "local"
          ? await extractAsync(uri, { fromSec, toSec, useSilero, headers })
          : await scanAsync(uri, {
              fromSec,
              toSec,
              useSilero,
              headers,
              speed,
              container: source.kind === "hls" ? "hls" : "progressive",
              audioLang,
              vadDebug: vadDebugEnabled,
              throttleMbps: scanThrottleMbps,
              cellular: scanCellular,
              allowConfirmBytes: scanAllowConfirmBytes,
            });
      finalFlush();
      if (r.ok || source.kind === "local" || attempt >= 1) return r;
      // Remote: expired token or transient -> fresh URL, one retry
      if (r.code === "expired-url" || r.code === "network") {
        console.log(
          `[SubSync] extract failed (${r.code}) - resolving fresh URL, attempt ${attempt + 1}`,
        );
        ({ uri, headers } = await source.resolve());
        continue;
      }
      return r;
    } finally {
      stopAttempt();
    }
  }
}

/** User-facing copy for extraction failures - technical detail stays in logs. */
const EXTRACT_MESSAGES: Record<string, string> = {
  "expired-url": "Stream link expired - try again.",
  network:
    "Network issue while scanning the stream. Try again, or wait for the video to buffer.",
  "unsupported-codec": "This device can't decode the audio in this stream.",
  "unsupported-format": "Stream format not recognized for auto sync.",
  unseekable:
    "This stream has no seek index - auto sync can't reach that part. Try the downloaded file.",
  timeout: "The stream is too slow to scan right now. Try again later.",
  "no-audio-track": "No decodable audio track in this stream.",
  "decode-failed": "Couldn't read the stream's audio. Try the downloaded file.",
  "live-unsupported": "Live streams can't be auto-synced.",
  "drm-unsupported": "This stream is DRM-protected - auto sync isn't possible.",
  cancelled: "Cancelled.",
  busy: "A sync is already running - wait for it to finish.",
  "silent-audio-track":
    "This stream's audio track is silent - switch to another link and retry.",
};

/**
 * "-61.2:0.041/0.89" - offset:score/keep per candidate. Field diagnostics: a
 * wrong pick should name its rivals in the log, not need a rebuilt APK.
 */
function formatTop(
  top: { offset: number; score: number; keep: number }[],
): string {
  if (top.length === 0) return "-";
  return top
    .map(
      (t) =>
        `${t.offset.toFixed(1)}:${t.score.toFixed(3)}/k${t.keep.toFixed(2)}`,
    )
    .join(" ");
}

/** Split cues into a window. */
function cuesInWindow(
  cues: { start: number; end: number; text: string }[],
  fromSec: number,
  toSec: number,
) {
  return cues.filter((c) => c.end >= fromSec && c.start <= toSec);
}

// Watch-path cache keys use the `watch-<from>-<to>` prefix (Stage C) so a
// fetch window and a live-tap window over the same span never collide.
function windowKeyFor(fromSec: number, toSec: number): string {
  return `${Math.round(fromSec)}-${Math.round(toSec)}`;
}

/** Stage C: window-cache key for a live watch-sync span (hyphens, namespaced). */
export function watchWindowKeyFor(fromSec: number, toSec: number): string {
  return `watch-${Math.round(fromSec)}-${Math.round(toSec)}`;
}

/** Fraction of cue time landing in [spanFrom, spanTo] when shifted by offset. */
function keepAtOffsetInSpan(
  cues: { start: number; end: number }[],
  spanFrom: number,
  spanTo: number,
  offset: number,
): number {
  let total = 0;
  let kept = 0;
  for (const c of cues) {
    total += Math.max(0, c.end - c.start);
    const a = Math.max(c.start + offset, spanFrom);
    const b = Math.min(c.end + offset, spanTo);
    if (b > a) kept += b - a;
  }
  return total > 0 ? Math.min(1, kept / total) : 0;
}

/**
 * Part B LOG-ONLY: onset diagnostic over cue starts only (first 300ms).
 * Does NOT affect the applied offset — DO NOT adopt (device: overshoots on CAM).
 *
 * 2026-09 repair: the old path ran a full findOffset (FFT + anyBest) over the
 * truncated cue set, which locked onto garbage when the onset contrast was
 * flat (−138s/−117s deltas on clean audio). Now: local refine ONLY, ±2s around
 * the main offset at 0.05s, contrastAt on the truncated cues — no FFT, no
 * anyBest. Delta = onsetRefined − mainOffset restores the murkiness detector
 * (clean audio |delta| ~0.1–0.7s; CAM +0.5 signature).
 */
function logOnsetWeighted(
  label: string,
  cues: { start: number; end: number; text: string }[],
  sig: SpeechSignal,
  rawOffset: number,
): number | null {
  const onsetCues = cues.map((c) => ({
    start: c.start,
    end: Math.min(c.end, c.start + 0.3),
    text: c.text,
  }));
  try {
    const o = refineNear(onsetCues, sig, rawOffset, 2, 0.05);
    if (o == null) {
      console.log(
        `[SubSync] ${label} onset-weighted: n/a (no valid contrast near main)`,
      );
      return null;
    }
    const delta = o - rawOffset;
    console.log(
      `[SubSync] ${label} onset-weighted: offset=${o.toFixed(2)}s ` +
        `(delta=${delta >= 0 ? "+" : ""}${delta.toFixed(2)}s, refine ±2s @0.05s)`,
    );
    return o;
  } catch {
    console.log(`[SubSync] ${label} onset-weighted: n/a`);
    return null;
  }
}

/** Content-dead duty: VAD marked almost nothing (credits, silence). */
function isContentDead(sig: SpeechSignal): boolean {
  let speech = 0;
  for (let i = 0; i < sig.data.length; i++) speech += sig.data[i];
  const duty = sig.data.length > 0 ? speech / sig.data.length : 0;
  return duty < 0.02;
}

function dutyOf(sig: SpeechSignal): number {
  let speech = 0;
  for (let i = 0; i < sig.data.length; i++) speech += sig.data[i];
  return sig.data.length > 0 ? speech / sig.data.length : 0;
}

// ─── P2-3: weekly outcome counter (measurement base, no UI) ─────

const OUTCOMES_KEY = "@subtitles/outcomes:v1";

type OutcomeCounts = {
  week: string;
  attempted: number;
  applied: number;
  checkpointApplied: number;
  correctedAfterCheckpoint: number;
  refused: number;
  kept: number;
};

function weekKey(d = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function bumpOutcome(
  kind: keyof Omit<OutcomeCounts, "week">,
): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(OUTCOMES_KEY);
    const week = weekKey();
    let o: OutcomeCounts;
    try {
      o = raw ? (JSON.parse(raw) as OutcomeCounts) : (null as any);
    } catch {
      o = null as any;
    }
    if (!o || o.week !== week) {
      o = {
        week,
        attempted: 0,
        applied: 0,
        checkpointApplied: 0,
        correctedAfterCheckpoint: 0,
        refused: 0,
        kept: 0,
      };
    }
    o[kind] = (o[kind] ?? 0) + 1;
    await AsyncStorage.setItem(OUTCOMES_KEY, JSON.stringify(o));
    console.log(
      `[SubSync] outcomes ${week}: attempted=${o.attempted} applied=${o.applied} ` +
        `checkpoint=${o.checkpointApplied} corrected=${o.correctedAfterCheckpoint} ` +
        `refused=${o.refused} kept=${o.kept}`,
    );
  } catch {
    // best-effort
  }
}

/** Round a duration so equivalent windows always produce the same cache key. */
function stableDuration(durationSec: number): number {
  return Math.round(durationSec);
}

// ─── R8-3: per-device Silero verdict ─────────────────────────────

type SileroVerdict = {
  sileroOk: boolean;
  maxProbSeen: number;
  appVersion: string;
  deviceModel: string;
  ortVersion: string;
  modelSha: string;
  createdAt: number;
};

const SILERO_VERDICT_KEY = "@subtitles/sileroVerdict";

function currentAppVersion(): string {
  return Constants.expoConfig?.version ?? "0";
}

function currentDeviceModel(): string {
  // Android exposes Model via Platform.constants; iOS falls back to the OS name.
  const c = Platform.constants as { Model?: string } | undefined;
  return c?.Model ?? Platform.OS;
}

async function loadSileroVerdict(): Promise<SileroVerdict | null> {
  try {
    const raw = await AsyncStorage.getItem(SILERO_VERDICT_KEY);
    return raw ? (JSON.parse(raw) as SileroVerdict) : null;
  } catch {
    return null;
  }
}

async function saveSileroVerdict(
  v: Omit<SileroVerdict, "createdAt">,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      SILERO_VERDICT_KEY,
      JSON.stringify({ ...v, createdAt: Date.now() }),
    );
  } catch {
    // best-effort
  }
}

/**
 * R8-2/R8-3: production default + once-per-app-version retry.
 * A dead-model verdict from THIS app version with THIS model asset forces
 * EnergyVad; bumping the app version (or the model) re-arms Silero for one try.
 */
async function resolveUseSilero(requested: boolean): Promise<boolean> {
  if (!requested || !SUBTITLE_SYNC_SILERO) return false;
  const verdict = await loadSileroVerdict();
  if (!verdict) return true;
  const sameVersion = verdict.appVersion === currentAppVersion();
  const sameModel = verdict.modelSha === SILERO_MODEL_SHA;
  if (!verdict.sileroOk && sameVersion && sameModel) {
    console.log(
      `[SubSync] silero verdict: dead on app ${verdict.appVersion} model=${verdict.modelSha.slice(0, 12)} ` +
        `maxProb=${verdict.maxProbSeen.toFixed(4)} - using energy (retry on next app-version bump)`,
    );
    return false;
  }
  if (!sameVersion || !sameModel) {
    console.log(
      `[SubSync] silero verdict: re-arming (prior ok=${verdict.sileroOk} app=${verdict.appVersion} -> ${currentAppVersion()})`,
    );
  }
  return true;
}

function logScanSummary(
  label: string,
  r: {
    vadChose?: string;
    sileroDuty?: number;
    energyDuty?: number;
    sileroMaxProb?: number;
  },
  sileroEnabled: boolean,
): void {
  const on = sileroEnabled ? "on" : "off";
  const duty = (r.energyDuty ?? 0).toFixed(3);
  const maxP = (r.sileroMaxProb ?? 0).toFixed(3);
  const chose = r.vadChose ?? "-";
  console.log(
    `[SubSync] ${label} summary: silero=${on} energy duty=${duty} maxProb=${maxP} chose=${chose}`,
  );
}

/** R8-3: persist the first successful scan's verdict (once per run is enough). */
async function maybePersistVerdict(
  r: { sileroMaxProb?: number },
  sileroEnabled: boolean,
  persisted: { current: boolean },
): Promise<void> {
  if (persisted.current || !sileroEnabled || r.sileroMaxProb === undefined)
    return;
  persisted.current = true;
  const maxProbSeen = r.sileroMaxProb;
  await saveSileroVerdict({
    sileroOk: maxProbSeen >= 0.05,
    maxProbSeen,
    appVersion: currentAppVersion(),
    deviceModel: currentDeviceModel(),
    ortVersion: Platform.OS === "android" ? SILERO_ORT_VERSION : "unknown",
    modelSha: SILERO_MODEL_SHA,
  });
}

// ─── R8-4: SDH bracketed-cue diagnostic (LOG-ONLY) ───────────────

/** Entire cue text is bracketed: [door slams], (sighs), etc. */
function isBracketedCue(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  return (
    (t.startsWith("[") && t.endsWith("]")) ||
    (t.startsWith("(") && t.endsWith(")"))
  );
}

export async function autoSync(opts: AutoSyncOptions): Promise<SyncOutcome> {
  const {
    source,
    durationSec,
    subtitleText,
    subtitleFormat,
    subtitleCacheKey: rawSubtitleCacheKey,
    subtitleUri,
    subtitleLanguage,
    // R8-2: Silero is the production default via the kill-switch constant.
    useSilero = SUBTITLE_SYNC_SILERO,
    network,
    platform,
    onProgress,
    allowConfirmBytes = false,
  } = opts;

  // G1/G3/G4-3: arm the scan governor for this attempt.
  scanCellular = network === "cellular";
  scanAllowConfirmBytes = allowConfirmBytes;
  try {
    const cached = await getCachedSpeed();
    const linkMbps = cached?.speedMbps ?? 0;
    scanThrottleMbps = computeScanBudgetMbps(linkMbps);
    if (linkMbps > 0) {
      const cap = linkMbps * BUDGET_LINK_CAP_FRACTION;
      console.log(
        `[SubSync] governor: link=${linkMbps.toFixed(2)} ` +
          `player=${PLAYER_FALLBACK_MBPS.toFixed(2)} ` +
          `budget=${scanThrottleMbps.toFixed(2)} ` +
          `(floor ${BUDGET_FLOOR_MBPS}, cap ${cap.toFixed(2)}), ` +
          `cellular=${scanCellular}, allowConfirmBytes=${scanAllowConfirmBytes}`,
      );
    }
  } catch {
    scanThrottleMbps = 0;
  }

  // Re-sync UX: a shifted filename (synced-31800-… / pristine-…) must not
  // change the cache key — same pristine content, same entry.
  const subtitleCacheKey = rawSubtitleCacheKey.replace(
    /^(synced-(-?\d+)-|pristine-)/,
    "",
  );
  if (subtitleCacheKey !== rawSubtitleCacheKey) {
    console.log(
      `[SubSync] cache key normalized: ${rawSubtitleCacheKey} -> ${subtitleCacheKey}`,
    );
  }

  // Already-shifted input: a failed re-sync keeps the existing file intact.
  const existingAppliedMs = appliedOffsetMs(subtitleUri);
  /** P2-1: early checkpoint provisional apply (null until/unless it fires). */
  const checkpointRef: { offsetMs: number | null; confidence: number } = {
    offsetMs: null,
    confidence: 0,
  };
  const failOrKeep = async (reason: string): Promise<SyncOutcome> => {
    if (checkpointRef.offsetMs !== null) {
      console.log(
        `[SubSync] ${reason} - keeping early checkpoint ${checkpointRef.offsetMs}ms`,
      );
      const out = await makeOffsetOutcome(
        checkpointRef.offsetMs,
        checkpointRef.confidence,
      );
      if (out.type === "offset") await bumpOutcome("applied");
      return out;
    }
    if (existingAppliedMs != null) {
      console.log(
        `[SubSync] ${reason} - existing sync ${existingAppliedMs}ms kept (not disturbed)`,
      );
      await bumpOutcome("kept");
      return { type: "kept", existingOffsetMs: existingAppliedMs, reason };
    }
    await bumpOutcome("refused");
    return { type: "failed", reason };
  };
  await bumpOutcome("attempted");

  // 0. Gate check (async - HLS probes the playlist first)
  const gate = await canAutoSync(source, platform);
  if (!gate.ok) {
    console.log(`[SubSync] gate: blocked - ${gate.reason}`);
    return failOrKeep(gate.reason);
  }

  // R8-3: honor a dead-model verdict from this app version (once-per-bump retry).
  const sileroEnabled = await resolveUseSilero(useSilero);
  const sileroPersisted = { current: false };
  if (useSilero && !sileroEnabled) {
    console.log("[SubSync] silero disabled for this app version - energy VAD");
  }

  // 1. Check cache
  const durKey = stableDuration(durationSec);
  const cached = await getCachedSync(
    subtitleCacheKey,
    `${source.contentId}:${durKey}`,
  );

  // 2. Parse subtitles
  const cleaned = cleanSubtitle(subtitleText, subtitleFormat);
  let cues = parseSubtitles(cleaned, subtitleFormat);
  console.log(`[SubSync] parsed ${cues.length} cues (${subtitleFormat})`);
  // R8-4: count fully-bracketed SDH cues (log-only; does not affect scoring).
  const sdhBracketed = cues.filter((c) => isBracketedCue(c.text)).length;
  console.log(
    `[SubSync] SDH: ${sdhBracketed}/${cues.length} fully-bracketed cues`,
  );

  // If this file was already shifted by a previous sync, undo that shift
  // in-memory first: every offset we compute and write is then ABSOLUTE
  // (relative to the ORIGINAL file), so re-syncing can never stack shifts.
  const prevAppliedMs = appliedOffsetMs(subtitleUri) ?? 0;
  if (prevAppliedMs !== 0) {
    const backSec = -prevAppliedMs / 1000;
    cues = cues.map((c) => ({
      start: Math.max(0, c.start + backSec),
      end: Math.max(0, c.end + backSec),
      text: c.text,
    }));
    console.log(
      `[SubSync] file already shifted by ${prevAppliedMs}ms - syncing against the ORIGINAL timeline`,
    );
  }
  if (cues.length < 8) {
    console.log("[SubSync] too few cues - aborting");
    return failOrKeep("too few cues");
  }

  // Apply helper: rewrite the sidecar subtitle file with the computed offset
  // (the native setSubtitleOffset only shifts embedded MKV text tracks).
  const makeOffsetOutcome = async (
    offsetMs: number,
    confidence: number,
  ): Promise<Extract<SyncOutcome, { type: "offset" }>> => {
    // Already applied to this exact file (cache replay / re-sync): never shift
    // twice - the file on disk is already the answer.
    if (
      offsetMs !== 0 &&
      subtitleUri &&
      appliedOffsetMs(subtitleUri) === offsetMs
    ) {
      // Hand back the existing shifted file so the sheet still selects it.
      return {
        type: "offset",
        offsetMs,
        confidence,
        rewritten: {
          uri: subtitleUri,
          mimeType: mimeTypeForFormat(subtitleFormat),
          language: subtitleLanguage,
          label: subtitleUri.split("/").pop() ?? undefined,
        },
      };
    }
    if (subtitleUri && (offsetMs !== 0 || prevAppliedMs !== 0)) {
      const uri = await writeShiftedSubtitleFile(
        cues,
        offsetMs / 1000,
        subtitleFormat,
        subtitleUri,
      );
      if (uri) {
        return {
          type: "offset",
          offsetMs,
          confidence,
          rewritten: {
            uri,
            mimeType: mimeTypeForFormat(subtitleFormat),
            language: subtitleLanguage,
            label: subtitleUri.split("/").pop() ?? undefined,
          },
        };
      }
    }
    return { type: "offset", offsetMs, confidence };
  };

  const finishApplied = async (
    outcome: Awaited<ReturnType<typeof makeOffsetOutcome>>,
    opts?: { checkpoint?: boolean; corrected?: boolean },
  ): Promise<SyncOutcome> => {
    if (outcome.type === "offset") {
      if (opts?.checkpoint) await bumpOutcome("checkpointApplied");
      else await bumpOutcome("applied");
      if (opts?.corrected) await bumpOutcome("correctedAfterCheckpoint");
      if (
        opts?.corrected &&
        checkpointRef.offsetMs !== null &&
        checkpointRef.offsetMs !== outcome.offsetMs
      ) {
        const delta = (outcome.offsetMs - checkpointRef.offsetMs) / 1000;
        outcome.notice = `Subtitles adjusted by ${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)}s`;
      }
    }
    return outcome;
  };

  const applyOrConfirm = async (
    offsetMs: number,
    conf: number,
    kind: "agree" | "early" | "cross" | "confirm" | "correct",
  ): Promise<SyncOutcome> => {
    // Stage C: serialize with the watch path — if watch already holds the
    // gate, keep the existing on-disk state (no second rewrite race).
    const raced = await runApplyOnce(async () => {
      const out = await makeOffsetOutcome(offsetMs, conf);
      if (out.type !== "offset") return out;
      const hasCheckpoint = checkpointRef.offsetMs !== null;
      const differs =
        hasCheckpoint && Math.abs(checkpointRef.offsetMs! - offsetMs) >= 100;
      if (hasCheckpoint && !differs) {
        console.log(
          `[SubSync] late window confirms early checkpoint ${offsetMs}ms (silent)`,
        );
        return finishApplied(out);
      }
      if (kind === "correct" && hasCheckpoint && differs) {
        console.log(
          `[SubSync] correcting early checkpoint ${checkpointRef.offsetMs}ms -> ${offsetMs}ms`,
        );
        return finishApplied(out, { corrected: true });
      }
      if (hasCheckpoint && differs) {
        // Late path wins after a checkpoint without the decisive correction
        // criteria: still re-apply, but keep the normal Synced toast (no
        // "adjusted by" notice) unless kind === "correct".
        if (kind !== "correct") {
          console.log(
            `[SubSync] post-checkpoint apply ${offsetMs}ms (was ${checkpointRef.offsetMs}ms) - silent update`,
          );
        }
      }
      return finishApplied(out);
    });
    if (raced == null) {
      console.log(
        "[SubSync] applyOnce busy (watch path holds the gate) - keeping current state",
      );
      return { type: "cancelled" };
    }
    return raced;
  };

  // Cached result replay: still produce the offset-applied sidecar file.
  if (cached) {
    console.log(
      `[SubSync] cache hit: offset=${cached.offsetMs}ms conf=${cached.confidence.toFixed(2)}`,
    );
    onProgress?.(1, "done");
    const replayed = await runApplyOnce(() =>
      makeOffsetOutcome(cached.offsetMs, cached.confidence),
    );
    if (replayed == null) {
      console.log(
        "[SubSync] cached replay applyOnce busy (watch path) - keeping current state",
      );
      return { type: "cancelled" };
    }
    return finishApplied(replayed);
  }

  // 3. Window plan (speed is the Android scan cap, 1..4)
  const { earlySec, lateSec, speed } = await windowPlan(source, network);
  console.log(
    `[SubSync] window plan: early=${earlySec}s late=${lateSec}s speed=${speed}x (network=${network})`,
  );

  onProgress?.(0, "extract");

  // 4. Early window
  const earlyFrom = Math.max(0, cues[0].start - 10);
  const earlyTo = earlySec;
  const earlyCues = cuesInWindow(cues, earlyFrom, earlyTo);
  console.log(
    `[SubSync] early window: ${earlyFrom.toFixed(1)}s-${earlyTo}s (${earlyCues.length} cues)`,
  );

  let earlyOff = { offset: 0, score: -1, runnerUp: -1 };
  let earlyConf = 0;
  /** Early-window signal, kept for the clipped-window rescue below. */
  let earlySig: SpeechSignal | null = null;

  const earlyWinKey = windowKeyFor(earlyFrom, earlyTo);
  const earlyCached = await getCachedWindow(
    subtitleCacheKey,
    source.contentId,
    earlyWinKey,
  );
  if (earlyCached) {
    console.log(
      `[SubSync] early window cache hit: offset=${(earlyCached.offsetMs / 1000).toFixed(2)}s conf=${earlyCached.confidence.toFixed(3)}`,
    );
    earlyOff = { offset: earlyCached.offsetMs / 1000, score: -1, runnerUp: -1 };
    earlyConf = earlyCached.confidence;
    // B2 + R5-1: the signal arrives already rebuilt (getCachedWindow returns a
    // miss when the payload cannot be rebuilt), so a rerun can cross-validate
    // this candidate on the other window's audio.
    earlySig = earlyCached.signal;
  } else {
    const earlyResult = await extractWithRetry(
      source,
      earlyFrom,
      earlyTo,
      sileroEnabled,
      speed,
      subtitleLanguage,
      (p) => onProgress?.(p * 0.75, "extract"),
    );

    if (!earlyResult.ok) {
      console.log(
        `[SubSync] early extract failed: ${earlyResult.code} - ${earlyResult.message}`,
      );
      // G3: surface the cellular byte gate so the UI can dialog and re-run.
      if (earlyResult.code === "confirm-bybytes") {
        const mb = /projectedMb=(\d+)/.exec(earlyResult.message)?.[1];
        return {
          type: "confirm-bybytes",
          projectedMb: mb ? parseInt(mb, 10) : 21,
        };
      }
      const friendly =
        EXTRACT_MESSAGES[earlyResult.code] ?? earlyResult.message;
      return failOrKeep(friendly);
    }

    logScanSummary("early", earlyResult, sileroEnabled);
    await maybePersistVerdict(earlyResult, sileroEnabled, sileroPersisted);

    try {
      const sig = validateSignal({ rate: 100, ...earlyResult });
      if (isContentDead(sig)) {
        console.log(
          `[SubSync] early window content-dead (duty=${dutyOf(sig).toFixed(3)}, credits?) - skipping`,
        );
      } else {
        earlySig = sig;
        const raw = findOffset(earlyCues, sig);
        const rawConf = confidence(
          earlyCues,
          sig,
          raw.offset,
          raw.runnerUp,
          raw.score,
        );
        console.log(
          `[SubSync] early: offset=${raw.offset.toFixed(2)}s conf=${rawConf.toFixed(3)} ` +
            `keep=${keptFraction(earlyCues, sig, raw.offset).toFixed(2)} baseline=${raw.baseline.toFixed(3)} ` +
            `top=${formatTop(raw.top)}`,
        );
        const earlyOnset = logOnsetWeighted(
          "early",
          earlyCues,
          sig,
          raw.offset,
        );
        // P3-3 LOG-ONLY: refined vs FFT coarse vs onset-weighted diagnostic.
        console.log(
          `[SubSync] refined: offset=${raw.offset.toFixed(3)}s ` +
            `(coarse ${raw.coarse.toFixed(2)}, onset ${
              earlyOnset != null ? earlyOnset.toFixed(2) : "n/a"
            })`,
        );

        // R8-4 LOG-ONLY: re-rank the early window without fully-bracketed cues so
        // an SDH-heavy file's offset shift is visible. The applied path below is
        // UNCHANGED (still uses `raw` / `rawConf` over all cues).
        const dialogueCues = earlyCues.filter((c) => !isBracketedCue(c.text));
        if (
          dialogueCues.length >= 8 &&
          dialogueCues.length < earlyCues.length
        ) {
          const rawD = findOffset(dialogueCues, sig);
          const sdhInWindow = earlyCues.length - dialogueCues.length;
          console.log(
            `early: offset=${raw.offset.toFixed(2)}s (all ${earlyCues.length} cues) / ` +
              `offset=${rawD.offset.toFixed(2)}s (${dialogueCues.length} dialogue cues, ${sdhInWindow} SDH annotations)`,
          );
        }

        await setCachedWindow(subtitleCacheKey, source.contentId, earlyWinKey, {
          offsetMs: Math.round(raw.offset * 1000),
          confidence: rawConf,
          createdAt: Date.now(),
          // B2: cache the signal so a rerun can cross-validate without a rescan.
          startSec: earlyResult.startSec,
          endSec: earlyResult.endSec,
          bins: earlyResult.bins,
          signalB64: earlyResult.signalB64,
        });
        earlyOff = {
          offset: raw.offset,
          score: raw.score,
          runnerUp: raw.runnerUp,
        };
        earlyConf = rawConf;
      }
    } catch (e: any) {
      return failOrKeep(`signal validation: ${e.message}`);
    }
  }

  onProgress?.(0.8, "analyze");

  // P2-2: clipped-window rescue is DEFERRED behind cross-validation.
  // A clipped candidate (keep < 0.7) is only re-scanned anchored on its
  // offset if the cross-check fails to decide AND this window is the loser.
  // Most files now skip both rescans entirely.
  // NOTE: findOffset returns a GLOBAL offset (cue time -> video time) —
  // a rescanned offset needs no timeline conversion.
  let earlyClipped = false;
  if (earlySig) {
    const earlyKeep = keptFraction(earlyCues, earlySig, earlyOff.offset);
    earlyClipped =
      earlyKeep < 0.7 &&
      earlyKeep > 0 &&
      earlyConf < APPLY_CONF &&
      earlyOff.score > 0 &&
      earlyCues.length >= 8;
    if (earlyClipped) {
      console.log(
        `[SubSync] early keep=${earlyKeep.toFixed(2)} - clipped, rescan deferred until cross-check fails`,
      );
    }

    // P2-1: early checkpoint - conf/sharp/keep all clear the bar → apply now
    // and keep scanning the late window as silent verification.
    if (
      CHECKPOINT_EARLY_APPLY &&
      checkpointRef.offsetMs === null &&
      earlyConf >= CHECKPOINT_CONF &&
      earlyOff.score > 0
    ) {
      const sharp =
        earlyOff.runnerUp >= 0
          ? (earlyOff.score - earlyOff.runnerUp) /
            Math.max(earlyOff.score, 0.02)
          : 1;
      if (earlyKeep >= CHECKPOINT_KEEP && sharp >= CHECKPOINT_SHARP) {
        const offsetMs = Math.round(earlyOff.offset * 1000);
        console.log(
          `[SubSync] early checkpoint: applied ${offsetMs >= 0 ? "+" : ""}${(offsetMs / 1000).toFixed(2)}s ` +
            `(conf=${earlyConf.toFixed(3)}/${CHECKPOINT_CONF} sharp=${sharp.toFixed(2)}/${CHECKPOINT_SHARP} ` +
            `keep=${earlyKeep.toFixed(2)}/${CHECKPOINT_KEEP}) - ` +
            `late window continues as silent verification`,
        );
        const out = await runApplyOnce(() =>
          makeOffsetOutcome(offsetMs, earlyConf),
        );
        if (out && out.type === "offset") {
          checkpointRef.offsetMs = offsetMs;
          checkpointRef.confidence = earlyConf;
          await bumpOutcome("checkpointApplied");
        } else if (out == null) {
          console.log(
            "[SubSync] early checkpoint applyOnce busy - skipping provisional apply",
          );
        }
      }
    }
  }

  // NOTE: a single window is never applied on its own when the other window
  // produced a contradicting result. With the energy VAD a lone window can
  // lock onto a music/beat peak (observed: early -72s vs late +88s for the
  // same file, which then double-applied and corrupted the subtitle).
  if (earlyConf >= TRY_CONF) {
    console.log(
      `[SubSync] early conf ${earlyConf.toFixed(3)} - confirming with the late window before applying`,
    );
  }

  // 5. Late window - only when the early window clearly failed AND the tail
  // actually has cues (credits windows have none; scanning them wastes a full
  // window pass - observed 40s burned on a 0-cue credits window).
  const lateToRaw = Math.min(
    Math.max(earlyTo + 120, durationSec * 0.9),
    durationSec,
  );
  // Fixed (historical) late span: cue selection always uses this - the late
  // cues of the FILE. The AUDIO scan may be re-anchored below (Part A).
  const lateCueFrom = Math.max(earlyTo + 60, lateToRaw - lateSec);
  const lateCueTo = lateToRaw;
  if (lateCueFrom >= lateCueTo - 30) {
    console.log("[SubSync] content too short for a separate late window");
    onProgress?.(1, "done");
    return failOrKeep("low confidence in both windows");
  }
  const lateCues = cuesInWindow(cues, lateCueFrom, lateCueTo);
  console.log(
    `[SubSync] late window: ${lateCueFrom.toFixed(1)}s-${lateCueTo.toFixed(1)}s (${lateCues.length} cues)`,
  );
  if (lateCues.length < 8) {
    console.log("[SubSync] late window has <8 cues - skipping scan");
    onProgress?.(1, "done");
    return failOrKeep("low confidence in both windows");
  }

  // Part A: re-anchor the late AUDIO scan on the early candidate so a large
  // positive offset cannot push the late cue set past the signal end
  // (keep was ~0.54 at e=+54s on a 120s fixed window; need >= 0.7).
  // CUE-FIT span = [lateCueFrom + e, lateCueFrom + e + lateSec], clamped.
  let lateFrom = lateCueFrom;
  let lateTo = lateCueTo;
  if (earlyConf >= TRY_CONF) {
    const e = earlyOff.offset;
    const reFrom = Math.max(earlyTo + 60, lateCueFrom + e);
    const reTo = Math.min(durationSec, lateCueFrom + e + lateSec);
    if (reTo - reFrom >= 30) {
      const keepRe = keepAtOffsetInSpan(lateCues, reFrom, reTo, e);
      const keepFix = keepAtOffsetInSpan(lateCues, lateCueFrom, lateCueTo, e);
      // Pick whichever span keeps more of the cue set at e (Spider-Man: fixed
      // 1.00 beat re-anchored 0.89 — moving unconditionally was wrong).
      if (keepRe > keepFix) {
        lateFrom = reFrom;
        lateTo = reTo;
        console.log(
          `[SubSync] late window re-anchored by early offset e=${e.toFixed(2)}s: ` +
            `[${lateFrom.toFixed(1)}..${lateTo.toFixed(1)}]s ` +
            `(keep at e: re-anchored ${keepRe.toFixed(2)} > fixed ${keepFix.toFixed(2)})`,
        );
      } else {
        console.log(
          `[SubSync] late window stays fixed (keep at e: fixed ${keepFix.toFixed(2)} >= re-anchored ${keepRe.toFixed(2)}, e=${e.toFixed(2)}s)`,
        );
      }
    } else {
      console.log(
        `[SubSync] late re-anchor e=${e.toFixed(2)}s rejected (span ${(reTo - reFrom).toFixed(1)}s < 30s) - fixed window`,
      );
    }
  }

  let lateOff = { offset: 0, score: -1, runnerUp: -1 };
  let lateConf = 0;
  // Whether the late window produced ANY usable signal. When it did not (e.g.
  // an unseekable stream), the early window is allowed to stand alone.
  let lateUsable = false;
  // P2-2: late candidate is clipped (keep < 0.7) and eligible for a gated
  // anchored rescan if the cross-check fails and late is the loser.
  let lateClipped = false;
  /** Late-window signal, kept so we can check whether this window could judge
   *  the early offset at all (see lateCannotJudge below). */
  let lateSigRef: SpeechSignal | null = null;

  // Both the re-anchored and the fixed window must be cache-findable.
  const fixedWinKey = windowKeyFor(lateCueFrom, lateCueTo);
  const lateWinKey = windowKeyFor(lateFrom, lateTo);
  let lateCached = await getCachedWindow(
    subtitleCacheKey,
    source.contentId,
    lateWinKey,
  );
  if (!lateCached && lateWinKey !== fixedWinKey) {
    lateCached = await getCachedWindow(
      subtitleCacheKey,
      source.contentId,
      fixedWinKey,
    );
  }
  if (lateCached) {
    console.log(
      `[SubSync] late window cache hit (${lateWinKey === fixedWinKey ? lateWinKey : lateWinKey + " or fixed " + fixedWinKey}): offset=${(lateCached.offsetMs / 1000).toFixed(2)}s conf=${lateCached.confidence.toFixed(3)}`,
    );
    lateOff = { offset: lateCached.offsetMs / 1000, score: -1, runnerUp: -1 };
    lateConf = lateCached.confidence;
    lateUsable = true;
    // B2 + R5-1: same as the early window - a cached late result keeps its
    // signal, so the cross-check prints a number instead of "nosig" on a rerun.
    lateSigRef = lateCached.signal;
  } else {
    const lateResult = await extractWithRetry(
      source,
      lateFrom,
      lateTo,
      sileroEnabled,
      speed,
      subtitleLanguage,
      (p) => onProgress?.(0.75 + p * 0.15, "extract"),
    );

    if (lateResult.ok) {
      logScanSummary("late", lateResult, sileroEnabled);
      await maybePersistVerdict(lateResult, sileroEnabled, sileroPersisted);
      try {
        const lateSig = validateSignal({ rate: 100, ...lateResult });
        if (isContentDead(lateSig)) {
          // Credits window: duty ~0.003. Skip correlation AND the anchored
          // rescan so junk conf-0.6 candidates never enter arbitration.
          console.log(
            `[SubSync] late window content-dead (duty=${dutyOf(lateSig).toFixed(3)}, credits?) - skipping`,
          );
        } else {
          lateSigRef = lateSig;
          let off = findOffset(lateCues, lateSig);
          let conf = confidence(
            lateCues,
            lateSig,
            off.offset,
            off.runnerUp,
            off.score,
          );
          console.log(
            `[SubSync] late raw: offset=${off.offset.toFixed(2)}s conf=${conf.toFixed(3)} ` +
              `keep=${keptFraction(lateCues, lateSig, off.offset).toFixed(2)} baseline=${off.baseline.toFixed(3)} ` +
              `top=${formatTop(off.top)}`,
          );
          const lateOnset = logOnsetWeighted(
            "late",
            lateCues,
            lateSig,
            off.offset,
          );
          // P3-3 LOG-ONLY: refined vs FFT coarse vs onset-weighted diagnostic.
          console.log(
            `[SubSync] refined: offset=${off.offset.toFixed(3)}s ` +
              `(coarse ${off.coarse.toFixed(2)}, onset ${
                lateOnset != null ? lateOnset.toFixed(2) : "n/a"
              })`,
          );

          // P2-2: clipped-late rescue is DEFERRED behind cross-validation
          // (same as the early window). Eligibility is recorded; the anchored
          // rescan runs only if the cross-check fails and late is the loser.
          let keep = keptFraction(lateCues, lateSig, off.offset);
          const lateCanRescan =
            keep < 0.7 && keep > 0 && off.score > 0 && lateCues.length >= 8;
          lateClipped = lateCanRescan;

          lateOff = off;
          lateConf = conf;
          // A late window that keeps < 70% of its cue set is structurally
          // unable to judge its own candidate fairly. When an anchored rescan
          // is still pending (P2-2), keep lateUsable=true provisionally so the
          // cross-check can run FIRST; lateUsable flips false only after the
          // gated rescan (or if the window is not rescannable at all).
          if (keep < 0.7) {
            if (lateCanRescan) {
              console.log(
                `[SubSync] late keep=${keep.toFixed(2)} - clipped, rescan deferred until cross-check fails`,
              );
              lateUsable = true;
            } else {
              console.log(
                `[SubSync] late window clipped (keep=${keep.toFixed(2)}) - treating as unusable, early window may stand alone`,
              );
              lateUsable = false;
            }
          } else {
            lateUsable = true;
            await setCachedWindow(
              subtitleCacheKey,
              source.contentId,
              lateWinKey,
              {
                offsetMs: Math.round(off.offset * 1000),
                confidence: conf,
                createdAt: Date.now(),
                startSec: lateResult.startSec,
                endSec: lateResult.endSec,
                bins: lateResult.bins,
                signalB64: lateResult.signalB64,
              },
            );
          }
        }
      } catch {
        // signal validation failed - fall back to early only
      }
    } else {
      console.log(
        `[SubSync] late extract failed: ${lateResult.code} - ${lateResult.message}`,
      );
      // G3: late window hits the cellular gate after early already ran —
      // keep whatever early produced (checkpoint / arbitration) rather than
      // discarding the whole attempt.
      if (lateResult.code === "confirm-bybytes") {
        console.log(
          "[SubSync] late confirm-bybytes - proceeding with early window only",
        );
      }
    }
  }

  console.log(
    `[SubSync] late: offset=${lateOff.offset.toFixed(2)}s conf=${lateConf.toFixed(3)}`,
  );

  // Part C LOG-ONLY: both windows confident but far apart → implied scale.
  // Does NOT act on drift; decision waits on the user's end-of-movie check.
  if (
    earlyConf >= TRY_CONF &&
    lateConf >= TRY_CONF &&
    lateUsable &&
    Math.abs(earlyOff.offset - lateOff.offset) >= 10
  ) {
    const eMean = meanCueStart(earlyCues);
    const lMean = meanCueStart(lateCues);
    const { scale } = solveDrift(earlyOff.offset, eMean, lateOff.offset, lMean);
    const grow = (scale - 1) * durationSec;
    console.log(
      `[SubSync] drift check: early=${earlyOff.offset.toFixed(2)}s late=${lateOff.offset.toFixed(2)}s ` +
        `-> implied scale=${scale.toFixed(5)} (offset would grow ${grow >= 0 ? "+" : ""}${grow.toFixed(1)}s over ${durationSec}s)`,
    );
  }

  onProgress?.(0.95, "analyze");

  // Agreement rule: two windows independently agreeing on (nearly) the same
  // offset is strong evidence even when each window alone is weak.
  const AGREE_CONF = 0.15;
  if (earlyConf >= AGREE_CONF && lateConf >= AGREE_CONF) {
    const diff = Math.abs(earlyOff.offset - lateOff.offset);
    if (diff < 1.5) {
      const avgOff = (earlyOff.offset + lateOff.offset) / 2;
      const conf = Math.max(earlyConf, lateConf);
      const offsetMs = Math.round(avgOff * 1000);
      console.log(
        `[SubSync] windows agree: early=${earlyOff.offset.toFixed(2)}s late=${lateOff.offset.toFixed(2)}s ` +
          `diff=${diff.toFixed(2)}s - applying avg ${(avgOff * 1000).toFixed(0)}ms (conf=${conf.toFixed(3)})`,
      );
      await setCachedSync(
        subtitleCacheKey,
        `${source.contentId}:${stableDuration(durationSec)}`,
        {
          offsetMs,
          scale: 1,
          method: "offset",
          confidence: conf,
          createdAt: Date.now(),
        },
      );
      onProgress?.(1, "done");
      return applyOrConfirm(offsetMs, conf, "confirm");
    }
  }

  // Single-window fallback: the late window could not judge the early offset -
  // either it could not be scanned at all (unseekable stream), or the early
  // offset pushes the late cue set out of the late scan span (keep < 0.7), so
  // agreement is IMPOSSIBLE BY CONSTRUCTION rather than contradicted. Requires
  // a strong early result (>= APPLY_CONF). The DISAGREE refusal below is
  // untouched: it still requires BOTH windows >= AGREE_CONF, so the
  // music-peak guard is intact (that incident had both windows confident).
  const lateJudgeKeep =
    lateSigRef !== null
      ? keptFraction(lateCues, lateSigRef, earlyOff.offset)
      : 1;
  const lateCannotJudge =
    !lateUsable || (lateSigRef !== null && lateJudgeKeep < 0.7);
  if (lateCannotJudge && earlyConf >= APPLY_CONF) {
    const offsetMs = Math.round(earlyOff.offset * 1000);
    console.log(
      `[SubSync] late window can't judge the early offset (keep=${lateJudgeKeep.toFixed(2)} usable=${lateUsable}) - applying early window alone (conf=${earlyConf.toFixed(3)})`,
    );
    await setCachedSync(subtitleCacheKey, `${source.contentId}:${durKey}`, {
      offsetMs,
      scale: 1,
      method: "offset",
      confidence: earlyConf,
      createdAt: Date.now(),
    });
    onProgress?.(1, "done");
    return applyOrConfirm(offsetMs, earlyConf, "confirm");
  }

  // Arbitration: the windows disagree. Cross-validate both candidates on the
  // OTHER window's audio rather than comparing confidence.
  //
  // Confidence is not comparable across windows: the late window is half the
  // length of the early one and is pinned near the content end, so a
  // coincidental local match can score higher there than the true alignment
  // scores in the early window. Observed on Lioness S01E01 (MKV, AMZN WEB-DL):
  // the late window's -73.90s (conf 0.701, keep 0.48) was applied over the true
  // early +0.65s (conf 0.421, keep 1.00) - a 74s wrong shift, while the file
  // and video are the same release and need ~+0.7s. Blacklist S02E10 needs the
  // opposite winner (late +53.30s over early -75.55s), so "trust the early
  // window" or "trust the longer window" would break it.
  //
  // Re-scoring each candidate on the other window's audio settles it: the true
  // offset explains the dialogue in every stretch of the file, a coincidence
  // only explains its own window. Both signals are already decoded, so this
  // costs no extra scan.
  {
    const CROSS_MIN = 0.03;
    const CROSS_LEAD = 0.01;
    // B3: three unambiguous states per candidate.
    //   number  - scored on the other window's audio
    //   invalid - the other window's audio cannot judge that band at all
    //             (contrastScore returns null)
    //   nosig   - that window's signal is not in memory (cache hit predating
    //             B2, or the window never produced a signal)
    // KNOWN BIAS (unchanged semantics, documented): `earlyLeads = earlyX >=
    // lateX` means that when the rival is nosig or invalid the EARLY window
    // wins the tie by default. It still has to clear CROSS_MIN and the TRY_CONF
    // bar to be applied, so a defaulted win is not a free pass - but it is a
    // deliberate asymmetry, not evidence, and the log line names it.
    const crossMissingEarly = !lateSigRef; // early candidate -> needs the LATE signal
    const crossMissingLate = !earlySig; // late candidate  -> needs the EARLY signal
    const earlyX = crossMissingEarly
      ? null
      : contrastScore(cues, lateSigRef!, earlyOff.offset);
    const lateX = crossMissingLate
      ? null
      : contrastScore(cues, earlySig!, lateOff.offset);
    const label = (v: number | null, missing: boolean) =>
      missing ? "nosig" : v === null ? "invalid" : v.toFixed(3);
    const numeric = (v: number | null, missing: boolean) =>
      missing || v === null ? -1 : v;
    const earlyN = numeric(earlyX, crossMissingEarly);
    const lateN = numeric(lateX, crossMissingLate);
    console.log(
      `[SubSync] disagree cross-check: early=${earlyOff.offset.toFixed(2)}s -> ${label(earlyX, crossMissingEarly)} ` +
        `late=${lateOff.offset.toFixed(2)}s -> ${label(lateX, crossMissingLate)} ` +
        `(min ${CROSS_MIN})`,
    );
    if (earlyN >= 0 || lateN >= 0) {
      const earlyLeads = earlyN >= lateN;
      const winOff = earlyLeads ? earlyOff.offset : lateOff.offset;
      const winConf = earlyLeads ? earlyConf : lateConf;
      const winX = earlyLeads ? earlyN : lateN;
      const loseX = earlyLeads ? lateN : earlyN;
      const loseLabel = earlyLeads
        ? label(lateX, crossMissingLate)
        : label(earlyX, crossMissingEarly);
      // The winner must be corroborated by the other window's audio AND lead
      // its rival's corroboration - otherwise the disagreement stands.
      if (
        winX >= CROSS_MIN &&
        winConf >= TRY_CONF &&
        (loseX < 0 || winX - loseX >= CROSS_LEAD)
      ) {
        const offsetMs = Math.round(winOff * 1000);
        // Decisive late win over a checkpoint: TRY_CONF (0.3) keeps the
        // cross-check corroboration as the real gate — lateConf >= 0.75 was
        // too strict and swallowed correction toasts on sharp late peaks.
        const decisiveLate =
          !earlyLeads &&
          lateConf >= TRY_CONF &&
          checkpointRef.offsetMs !== null &&
          Math.abs(checkpointRef.offsetMs - offsetMs) >= 100;
        console.log(
          `[SubSync] windows disagree - ${earlyLeads ? "early" : "late"} candidate ${winOff.toFixed(2)}s ` +
            `corroborated on the other window's audio (x=${winX.toFixed(3)} winConf=${winConf.toFixed(3)} ` +
            `lateConf=${lateConf.toFixed(3)} vs ${loseLabel}) - applying${decisiveLate ? " (decisive correction)" : ""}`,
        );
        await setCachedSync(subtitleCacheKey, `${source.contentId}:${durKey}`, {
          offsetMs,
          scale: 1,
          method: "offset",
          confidence: winConf,
          createdAt: Date.now(),
        });
        onProgress?.(1, "done");
        return applyOrConfirm(
          offsetMs,
          winConf,
          decisiveLate ? "correct" : "confirm",
        );
      }
      console.log(
        "[SubSync] windows disagree - neither candidate is corroborated on the other window's audio",
      );

      // P2-2: cross-check could not decide. Run only the LOSING candidate's
      // anchored rescan when that window was clipped (keep < 0.7) - then
      // re-check agreement and the cross-check once with the improved candidate.
      const earlyLeadsFail = earlyN >= lateN;
      const wantLateRescan = earlyLeadsFail && lateClipped;
      const wantEarlyRescan = !earlyLeadsFail && earlyClipped;

      let rescanRan = false;
      if (wantLateRescan) {
        console.log(
          `[SubSync] cross-check inconclusive - gated late anchored rescan at ${lateOff.offset.toFixed(2)}s`,
        );
        rescanRan = true;
        const span = lateSigRef ? lateSigRef.endSec - lateSigRef.startSec : 0;
        const anchorFrom = Math.max(0, lateCueFrom + lateOff.offset);
        const anchorTo =
          durationSec > 0
            ? Math.min(durationSec, anchorFrom + span)
            : anchorFrom + span;
        if (
          anchorFrom >= earlyTo + 30 &&
          span > 0 &&
          anchorTo - anchorFrom >= Math.min(span, lateTo - lateFrom) * 0.8
        ) {
          const anchorResult = await extractWithRetry(
            source,
            anchorFrom,
            anchorTo,
            sileroEnabled,
            speed,
            subtitleLanguage,
            (p) => onProgress?.(0.9 + p * 0.04, "extract"),
          );
          if (anchorResult.ok) {
            logScanSummary("late-anchor", anchorResult, sileroEnabled);
            await maybePersistVerdict(
              anchorResult,
              sileroEnabled,
              sileroPersisted,
            );
            try {
              const anchorSig = validateSignal({ rate: 100, ...anchorResult });
              const anchorOff = findOffset(lateCues, anchorSig);
              const anchorConf = confidence(
                lateCues,
                anchorSig,
                anchorOff.offset,
                anchorOff.runnerUp,
                anchorOff.score,
              );
              console.log(
                `[SubSync] late anchored rescan: offset=${anchorOff.offset.toFixed(2)}s conf=${anchorConf.toFixed(3)}`,
              );
              if (anchorConf > lateConf) {
                lateOff = anchorOff;
                lateConf = anchorConf;
                lateSigRef = anchorSig;
                lateClipped =
                  keptFraction(lateCues, anchorSig, lateOff.offset) >= 0.7;
                if (lateClipped) lateUsable = false;
                else lateUsable = true;
                const anchorWinKey = windowKeyFor(anchorFrom, anchorTo);
                await setCachedWindow(
                  subtitleCacheKey,
                  source.contentId,
                  anchorWinKey,
                  {
                    offsetMs: Math.round(anchorOff.offset * 1000),
                    confidence: anchorConf,
                    createdAt: Date.now(),
                    startSec: anchorResult.startSec,
                    endSec: anchorResult.endSec,
                    bins: anchorResult.bins,
                    signalB64: anchorResult.signalB64,
                  },
                );
              } else {
                // Rescan did not improve - candidate still clipped → unusable.
                const k = keptFraction(lateCues, lateSigRef!, lateOff.offset);
                if (k < 0.7) lateUsable = false;
              }
            } catch {
              // invalid anchored signal - keep the direct late result
            }
          }
        } else {
          console.log(
            `[SubSync] gated late rescan span rejected (${anchorFrom.toFixed(0)}s-${anchorTo.toFixed(0)}s)`,
          );
        }
      }

      if (wantEarlyRescan) {
        console.log(
          `[SubSync] cross-check inconclusive - gated early anchored rescan at ${earlyOff.offset.toFixed(2)}s`,
        );
        rescanRan = true;
        const span = earlySig ? earlySig.endSec - earlySig.startSec : 0;
        const anchorFrom = Math.max(0, earlyFrom + earlyOff.offset);
        const anchorTo =
          durationSec > 0
            ? Math.min(durationSec, anchorFrom + span)
            : anchorFrom + span;
        if (
          span > 0 &&
          anchorTo - anchorFrom >= Math.min(span, earlyTo - earlyFrom) * 0.8
        ) {
          const anchorResult = await extractWithRetry(
            source,
            anchorFrom,
            anchorTo,
            sileroEnabled,
            speed,
            subtitleLanguage,
            (p) => onProgress?.(0.9 + p * 0.04, "extract"),
          );
          if (anchorResult.ok) {
            logScanSummary("early-anchor", anchorResult, sileroEnabled);
            await maybePersistVerdict(
              anchorResult,
              sileroEnabled,
              sileroPersisted,
            );
            try {
              const anchorSig = validateSignal({ rate: 100, ...anchorResult });
              const anchorOff = findOffset(earlyCues, anchorSig);
              const anchorConf = confidence(
                earlyCues,
                anchorSig,
                anchorOff.offset,
                anchorOff.runnerUp,
                anchorOff.score,
              );
              console.log(
                `[SubSync] anchored rescan: offset=${anchorOff.offset.toFixed(2)}s conf=${anchorConf.toFixed(3)}`,
              );
              if (anchorConf > earlyConf) {
                earlyOff = anchorOff;
                earlyConf = anchorConf;
                earlySig = anchorSig;
                earlyClipped =
                  keptFraction(earlyCues, anchorSig, earlyOff.offset) >= 0.7;
                const anchorWinKey = windowKeyFor(anchorFrom, anchorTo);
                await setCachedWindow(
                  subtitleCacheKey,
                  source.contentId,
                  anchorWinKey,
                  {
                    offsetMs: Math.round(anchorOff.offset * 1000),
                    confidence: anchorConf,
                    createdAt: Date.now(),
                    startSec: anchorResult.startSec,
                    endSec: anchorResult.endSec,
                    bins: anchorResult.bins,
                    signalB64: anchorResult.signalB64,
                  },
                );
              }
            } catch {
              // anchor scan produced an invalid signal - keep the early result
            }
          }
        }
      }

      if (rescanRan) {
        // Re-check agreement first (diff < 1.5s), then the cross-check once more.
        if (earlyConf >= AGREE_CONF && lateConf >= AGREE_CONF) {
          const diff = Math.abs(earlyOff.offset - lateOff.offset);
          if (diff < 1.5) {
            const avgOff = (earlyOff.offset + lateOff.offset) / 2;
            const conf = Math.max(earlyConf, lateConf);
            const offsetMs = Math.round(avgOff * 1000);
            console.log(
              `[SubSync] windows agree after gated rescan: early=${earlyOff.offset.toFixed(2)}s late=${lateOff.offset.toFixed(2)}s ` +
                `diff=${diff.toFixed(2)}s - applying avg ${(avgOff * 1000).toFixed(0)}ms (conf=${conf.toFixed(3)})`,
            );
            await setCachedSync(
              subtitleCacheKey,
              `${source.contentId}:${stableDuration(durationSec)}`,
              {
                offsetMs,
                scale: 1,
                method: "offset",
                confidence: conf,
                createdAt: Date.now(),
              },
            );
            onProgress?.(1, "done");
            return applyOrConfirm(offsetMs, conf, "confirm");
          }
        }

        // Second cross-check pass with the improved candidate(s).
        const e2x = lateSigRef
          ? contrastScore(cues, lateSigRef, earlyOff.offset)
          : null;
        const l2x = earlySig
          ? contrastScore(cues, earlySig, lateOff.offset)
          : null;
        const e2n = !lateSigRef || e2x === null ? -1 : e2x;
        const l2n = !earlySig || l2x === null ? -1 : l2x;
        console.log(
          `[SubSync] disagree cross-check after gated rescan: early=${earlyOff.offset.toFixed(2)}s -> ${e2n < 0 ? (lateSigRef ? "invalid" : "nosig") : e2n.toFixed(3)} ` +
            `late=${lateOff.offset.toFixed(2)}s -> ${l2n < 0 ? (earlySig ? "invalid" : "nosig") : l2n.toFixed(3)} ` +
            `(min ${CROSS_MIN})`,
        );
        if (e2n >= 0 || l2n >= 0) {
          const earlyLeads2 = e2n >= l2n;
          const winOff2 = earlyLeads2 ? earlyOff.offset : lateOff.offset;
          const winConf2 = earlyLeads2 ? earlyConf : lateConf;
          const winX2 = earlyLeads2 ? e2n : l2n;
          const loseX2 = earlyLeads2 ? l2n : e2n;
          if (
            winX2 >= CROSS_MIN &&
            winConf2 >= TRY_CONF &&
            (loseX2 < 0 || winX2 - loseX2 >= CROSS_LEAD)
          ) {
            const offsetMs = Math.round(winOff2 * 1000);
            const decisiveLate2 =
              !earlyLeads2 &&
              lateConf >= TRY_CONF &&
              checkpointRef.offsetMs !== null &&
              Math.abs(checkpointRef.offsetMs - offsetMs) >= 100;
            console.log(
              `[SubSync] windows disagree - ${earlyLeads2 ? "early" : "late"} candidate ${winOff2.toFixed(2)}s ` +
                `corroborated after gated rescan (x=${winX2.toFixed(3)} winConf=${winConf2.toFixed(3)} ` +
                `lateConf=${lateConf.toFixed(3)}) - applying${decisiveLate2 ? " (decisive correction)" : ""}`,
            );
            await setCachedSync(
              subtitleCacheKey,
              `${source.contentId}:${durKey}`,
              {
                offsetMs,
                scale: 1,
                method: "offset",
                confidence: winConf2,
                createdAt: Date.now(),
              },
            );
            onProgress?.(1, "done");
            return applyOrConfirm(
              offsetMs,
              winConf2,
              decisiveLate2 ? "correct" : "confirm",
            );
          }
        }
        console.log(
          "[SubSync] windows disagree - neither candidate is corroborated after gated rescan",
        );
      }
    }
  }

  // Neither window usable / they contradict each other - never guess.
  if (lateUsable && earlyConf >= AGREE_CONF && lateConf >= AGREE_CONF) {
    console.log(
      `[SubSync] windows DISAGREE (early=${earlyOff.offset.toFixed(2)}s late=${lateOff.offset.toFixed(2)}s ` +
        `diff=${Math.abs(earlyOff.offset - lateOff.offset).toFixed(2)}s) - refusing to apply`,
    );
    onProgress?.(1, "done");
    return failOrKeep("windows disagree - not applied");
  }
  console.log(
    `[SubSync] low confidence (early=${earlyConf.toFixed(3)} usable=${lateUsable} late=${lateConf.toFixed(3)}) - manual fallback`,
  );
  onProgress?.(1, "done");
  return failOrKeep("low confidence in both windows");
}

/** Cancel any running extraction. */
export function cancelAutoSync(): void {
  cancel();
}
