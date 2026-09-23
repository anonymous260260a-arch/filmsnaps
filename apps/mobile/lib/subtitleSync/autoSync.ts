/**
 * Orchestrator - resolve -> extract -> analyze -> apply.
 * Streaming-first, cache keyed by contentId, with re-resolve/retry.
 *
 * Speed model (2026-09 rework, Android-first):
 *   - scan at 4x (Android native cap), small windows (remote 240s/120s)
 *   - the EARLY window scans first; the LATE window always scans too (when it
 *     has >= 8 cues), because a lone window can lock onto a music/beat peak
 *   - application requires a two-window agreement (diff < 1.5s) OR a strong
 *     early result that the late window structurally cannot judge: the late
 *     scan was unavailable (unseekable) or the early offset pushes the late
 *     cue set out of the late scan span (see lateCannotJudge), OR one window
 *     decisively more confident than the other (see the arbitration block - a
 *     less-confident window's disagreement is not a veto)
 *   - a clipped window (keep < 0.7) is rescanned anchored on the candidate
 *     offset so the same cue set is judged with full coverage (see the
 *     "clipped-window rescue" below)
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
    if (onProgress) {
      unsub = onExtractProgress(onProgress);
    }
    // Poll the native scan status while the scan runs: events may not be
    // delivered on some RN setups, so progress/trace ride the poll instead.
    let poller: ReturnType<typeof setInterval> | undefined;
    if (source.kind !== "local") {
      // R5-5: the native side keeps a MONOTONIC line counter plus the last N
      // lines, so the poller prints lines by INDEX. Slicing the text by length
      // desynced whenever the trace ring trimmed (that produced the malformed
      // "0 size=8192" line, and silently dropped "signal summary:"/"DONE" when
      // more than a ring's worth of lines arrived between two polls). Now a
      // gap is reported instead of hidden.
      let printedLines = 0;
      poller = setInterval(() => {
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
          for (const line of tail.slice(Math.max(0, tail.length - newCount))) {
            if (line.trim()) console.log(`[SubSyncFast] ${line}`);
          }
          printedLines = total;
        } catch {
          // poller is best-effort
        }
      }, 500);
    }
    try {
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
            }).finally(() => {
              if (poller) clearInterval(poller);
            });
      if (source.kind === "local" && poller) clearInterval(poller);
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
      unsub?.();
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

function windowKeyFor(fromSec: number, toSec: number): string {
  return `${Math.round(fromSec)}-${Math.round(toSec)}`;
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
 * Part B LOG-ONLY: onset-weighted score over cue starts only (first 300ms).
 * Does NOT affect the applied offset — we compare against `raw` on regression
 * data (Spider-Man / Blacklist / Lioness) before adopting.
 */
function logOnsetWeighted(
  label: string,
  cues: { start: number; end: number; text: string }[],
  sig: SpeechSignal,
): void {
  const onsetCues = cues.map((c) => ({
    start: c.start,
    end: Math.min(c.end, c.start + 0.3),
    text: c.text,
  }));
  try {
    const o = findOffset(onsetCues, sig);
    const oc = confidence(onsetCues, sig, o.offset, o.runnerUp, o.score);
    console.log(
      `[SubSync] ${label} onset-weighted: offset=${o.offset.toFixed(2)}s conf=${oc.toFixed(3)}`,
    );
  } catch {
    console.log(`[SubSync] ${label} onset-weighted: n/a`);
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
    subtitleCacheKey,
    subtitleUri,
    subtitleLanguage,
    // R8-2: Silero is the production default via the kill-switch constant.
    useSilero = SUBTITLE_SYNC_SILERO,
    network,
    platform,
    onProgress,
  } = opts;

  // 0. Gate check (async - HLS probes the playlist first)
  const gate = await canAutoSync(source, platform);
  if (!gate.ok) {
    console.log(`[SubSync] gate: blocked - ${gate.reason}`);
    return { type: "failed", reason: gate.reason };
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
    return { type: "failed", reason: "too few cues" };
  }

  // Apply helper: rewrite the sidecar subtitle file with the computed offset
  // (the native setSubtitleOffset only shifts embedded MKV text tracks).
  const makeOffsetOutcome = async (offsetMs: number, confidence: number) => {
    // Already applied to this exact file (cache replay / re-sync): never shift
    // twice - the file on disk is already the answer.
    if (
      offsetMs !== 0 &&
      subtitleUri &&
      appliedOffsetMs(subtitleUri) === offsetMs
    ) {
      // Hand back the existing shifted file so the sheet still selects it.
      return {
        type: "offset" as const,
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
          type: "offset" as const,
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
    return { type: "offset" as const, offsetMs, confidence };
  };

  // Cached result replay: still produce the offset-applied sidecar file.
  if (cached) {
    console.log(
      `[SubSync] cache hit: offset=${cached.offsetMs}ms conf=${cached.confidence.toFixed(2)}`,
    );
    onProgress?.(1, "done");
    return await makeOffsetOutcome(cached.offsetMs, cached.confidence);
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
      const friendly =
        EXTRACT_MESSAGES[earlyResult.code] ?? earlyResult.message;
      return { type: "failed", reason: friendly };
    }

    logScanSummary("early", earlyResult, sileroEnabled);
    await maybePersistVerdict(earlyResult, sileroEnabled, sileroPersisted);

    try {
      const sig = validateSignal({ rate: 100, ...earlyResult });
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
      logOnsetWeighted("early", earlyCues, sig);

      // R8-4 LOG-ONLY: re-rank the early window without fully-bracketed cues so
      // an SDH-heavy file's offset shift is visible. The applied path below is
      // UNCHANGED (still uses `raw` / `rawConf` over all cues).
      const dialogueCues = earlyCues.filter((c) => !isBracketedCue(c.text));
      if (dialogueCues.length >= 8 && dialogueCues.length < earlyCues.length) {
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
    } catch (e: any) {
      return { type: "failed", reason: `signal validation: ${e.message}` };
    }
  }

  onProgress?.(0.8, "analyze");

  // Clipped-window rescue: when the early window's best offset pushes a
  // meaningful share of the cue set outside the scanned span (keep < 0.97),
  // the candidate was judged on a partial cue set. Re-scan a window anchored
  // ON the candidate offset (same span, start shifted by the offset) so the
  // SAME cue set is judged with (nearly) full coverage. Observed: Blacklist's
  // true +54s was clipped by the cue-anchored early window; Lanterns' +85.25s
  // kept only ~30% of its cues. Never rescues a confident, sharp win.
  // NOTE: findOffset returns a GLOBAL offset (cue time -> video time),
  // independent of the window's start — the rescanned offset needs no
  // timeline conversion.
  if (earlySig) {
    const earlyKeep = keptFraction(earlyCues, earlySig, earlyOff.offset);
    if (
      earlyKeep < 0.7 &&
      earlyKeep > 0 &&
      earlyConf < APPLY_CONF &&
      earlyOff.score > 0 &&
      earlyCues.length >= 8
    ) {
      const span = earlySig.endSec - earlySig.startSec;
      const anchorFrom = Math.max(0, earlyFrom + earlyOff.offset);
      const anchorTo =
        durationSec > 0
          ? Math.min(durationSec, anchorFrom + span)
          : anchorFrom + span;
      if (anchorTo - anchorFrom >= Math.min(span, earlyTo - earlyFrom) * 0.8) {
        console.log(
          `[SubSync] early keep=${earlyKeep.toFixed(2)} - rescanning anchored at ${earlyOff.offset.toFixed(2)}s (${earlyCues.length} cues, ${anchorFrom.toFixed(0)}s-${anchorTo.toFixed(0)}s)`,
        );
        const anchorResult = await extractWithRetry(
          source,
          anchorFrom,
          anchorTo,
          sileroEnabled,
          speed,
          subtitleLanguage,
          (p) => onProgress?.(0.8 + p * 0.05, "extract"),
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
              earlyOff = {
                offset: anchorOff.offset,
                score: anchorOff.score,
                runnerUp: anchorOff.runnerUp,
              };
              earlyConf = anchorConf;
              // Cross-validation must use the signal that produced this offset.
              earlySig = anchorSig;
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
    return { type: "failed", reason: "low confidence in both windows" };
  }
  const lateCues = cuesInWindow(cues, lateCueFrom, lateCueTo);
  console.log(
    `[SubSync] late window: ${lateCueFrom.toFixed(1)}s-${lateCueTo.toFixed(1)}s (${lateCues.length} cues)`,
  );
  if (lateCues.length < 8) {
    console.log("[SubSync] late window has <8 cues - skipping scan");
    onProgress?.(1, "done");
    return { type: "failed", reason: "low confidence in both windows" };
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
      lateFrom = reFrom;
      lateTo = reTo;
      console.log(
        `[SubSync] late window re-anchored by early offset e=${e.toFixed(2)}s: ` +
          `[${lateFrom.toFixed(1)}..${lateTo.toFixed(1)}]s ` +
          `(keep at e would be ${keepRe.toFixed(2)} vs ${keepFix.toFixed(2)} fixed)`,
      );
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
        logOnsetWeighted("late", lateCues, lateSig);

        // Clipped-late rescue: the late window is pinned near the content end,
        // so a positive offset pushes its cue set past the signal end. Re-scan
        // anchored at the candidate offset (same as the early rescue), keeping
        // >= 30s clear of the early window for independence.
        let keep = keptFraction(lateCues, lateSig, off.offset);
        // R5-4: the anchored (full-coverage) retest is NOT gated on confidence.
        // A late window enters the disagreement path precisely because it looks
        // strong while being judged on a clipped cue set (Lioness: -73.90s at
        // conf 0.701, keep 0.48) - the old `conf < APPLY_CONF` gate meant such a
        // candidate was never re-tested with full coverage.
        if (keep < 0.7 && keep > 0 && off.score > 0 && lateCues.length >= 8) {
          const span = lateSig.endSec - lateSig.startSec;
          // Anchor on the CUE span + candidate offset (full coverage for this
          // cue set), not on the possibly re-anchored scan start.
          const anchorFrom = Math.max(0, lateCueFrom + off.offset);
          const anchorTo =
            durationSec > 0
              ? Math.min(durationSec, anchorFrom + span)
              : anchorFrom + span;
          if (
            anchorFrom >= earlyTo + 30 &&
            anchorTo - anchorFrom >= Math.min(span, lateTo - lateFrom) * 0.8
          ) {
            console.log(
              `[SubSync] late keep=${keep.toFixed(2)} - rescanning anchored at ${off.offset.toFixed(2)}s (${anchorFrom.toFixed(0)}s-${anchorTo.toFixed(0)}s)`,
            );
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
                const anchorSig = validateSignal({
                  rate: 100,
                  ...anchorResult,
                });
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
                if (anchorConf > conf) {
                  off = anchorOff;
                  conf = anchorConf;
                  keep = keptFraction(lateCues, anchorSig, off.offset);
                  // Cross-validation must use the signal that produced this offset.
                  lateSigRef = anchorSig;
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
                // invalid anchored signal - keep the direct late result
              }
            }
          }
        }

        lateOff = off;
        lateConf = conf;
        // A late window that still keeps < 70% of its cue set at the winning
        // offset is structurally unable to judge it fairly (its tail is pinned
        // at the content end and cannot widen) - treat as unusable so the
        // early window can stand alone instead of hard-failing on an unfair
        // comparison. The DISAGREE refusal still guards the music-peak
        // incident: that path requires BOTH windows >= AGREE_CONF.
        if (keep < 0.7) {
          console.log(
            `[SubSync] late window clipped (keep=${keep.toFixed(2)}) - treating as unusable, early window may stand alone`,
          );
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
      } catch {
        // signal validation failed - fall back to early only
      }
    } else {
      console.log(
        `[SubSync] late extract failed: ${lateResult.code} - ${lateResult.message}`,
      );
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
      return await makeOffsetOutcome(offsetMs, conf);
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
    return await makeOffsetOutcome(offsetMs, earlyConf);
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
        console.log(
          `[SubSync] windows disagree - ${earlyLeads ? "early" : "late"} candidate ${winOff.toFixed(2)}s ` +
            `corroborated on the other window's audio (x=${winX.toFixed(3)} vs ${loseLabel}) - applying`,
        );
        await setCachedSync(subtitleCacheKey, `${source.contentId}:${durKey}`, {
          offsetMs,
          scale: 1,
          method: "offset",
          confidence: winConf,
          createdAt: Date.now(),
        });
        onProgress?.(1, "done");
        return await makeOffsetOutcome(offsetMs, winConf);
      }
      console.log(
        "[SubSync] windows disagree - neither candidate is corroborated on the other window's audio",
      );
    }
  }

  // Neither window usable / they contradict each other - never guess.
  if (lateUsable && earlyConf >= AGREE_CONF && lateConf >= AGREE_CONF) {
    console.log(
      `[SubSync] windows DISAGREE (early=${earlyOff.offset.toFixed(2)}s late=${lateOff.offset.toFixed(2)}s ` +
        `diff=${Math.abs(earlyOff.offset - lateOff.offset).toFixed(2)}s) - refusing to apply`,
    );
    onProgress?.(1, "done");
    return { type: "failed", reason: "windows disagree - not applied" };
  }
  console.log(
    `[SubSync] low confidence (early=${earlyConf.toFixed(3)} usable=${lateUsable} late=${lateConf.toFixed(3)}) - manual fallback`,
  );
  onProgress?.(1, "done");
  return { type: "failed", reason: "low confidence in both windows" };
}

/** Cancel any running extraction. */
export function cancelAutoSync(): void {
  cancel();
}
