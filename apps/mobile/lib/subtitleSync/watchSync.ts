/**
 * Stage C — watch-sync session: correlation + refinement over live tap windows.
 *
 * Native WatchCollector (Stage B) emits ExtractResult-shaped windows via
 * onWatchSignal. This module owns the JS session: loads cues, correlates,
 * applies the first offset under the same checkpoint bars as the fetch path,
 * then allows up to two refinements under stricter guards. HevcPlayer starts/
 * stops the session and drives anchors; SubtitleSheet registers the apply
 * handler that owns sidecar re-add + prefs (same target as AutoSyncButton).
 *
 * Kill-switch: WATCH_SYNC_ENABLED (JS rebundle only).
 */

import type { Cue, SpeechSignal, SubFormat } from "./types";
import { validateSignal } from "./types";
import {
  findOffset,
  confidence,
  keptFraction,
  findOffsetWideSlice,
  confidenceWideSlice,
} from "./correlate";
import {
  CHECKPOINT_EARLY_APPLY,
  CHECKPOINT_CONF,
  CHECKPOINT_SHARP,
  CHECKPOINT_KEEP,
  runApplyOnce,
} from "./autoSync";
import { File } from "expo-file-system";
import {
  writeShiftedSubtitleFile,
  mimeTypeForFormat,
  appliedOffsetMs,
} from "./applySync";
import { getCachedSync, setCachedSync, setCachedWindow } from "./cache";
import { watchWindowKeyFor } from "./autoSync";
import { MARK_ON, MARK_OFF } from "./engineConstants";
import { parseSubtitles } from "./parseSubtitles";
import {
  activateWatchSync,
  watchAnchor as nativeWatchAnchor,
  stopWatchSync as nativeStopWatchSync,
  onWatchSignal,
  onDebug,
  type WatchSignalEvent,
} from "expo-subtitle-sync";
import { downloadToast } from "../../components/DownloadToast";

/**
 * JS kill-switch: set false to disable watch-sync entirely (no native activate,
 * no signal correlation). No rebuild needed beyond a Metro reload.
 */
export const WATCH_SYNC_ENABLED = true;

/** Session wall-clock cap — matches the device plan (30 minutes). */
const SESSION_CAP_MS = 30 * 60 * 1000;
/** Anchor poll period while the session is active. */
const ANCHOR_POLL_MS = 5_000;
/** Content-time jump (beyond expected poll drift) that forces a re-anchor. */
const ANCHOR_DRIFT_TOLERANCE_SEC = 2.0;
/** Refinement confidence bar (stricter than first-apply checkpoint conf). */
const REFINE_CONF = 0.75;
/** Minimum |delta| for a refinement to be worth applying. */
const REFINE_MIN_DELTA_MS = 300;
/** Max refinements per session. */
const REFINE_MAX = 2;
/** "Same sign + similar magnitude" — within this many ms of the last delta. */
const REFINE_SIMILAR_MS = 300;
/**
 * P4 rework: windows are scored against ONLY the cues overlapping the signal
 * span (fetch-path parity). The old all-cues scoring capped confidence at
 * ~0.03 on a 20s live window (keep ≈ window/file span at ANY offset, and
 * confidence decays with keep) — first apply was structurally unreachable.
 * With windowed cues a live window scores honestly, so first apply happens
 * EITHER on one strong window (same bars as the fetch checkpoint) OR on two
 * consecutive windows agreeing within WINDOW_AGREE_DELTA_SEC at a lower
 * per-window bar — a lone short window must not need 240s-of-audio evidence.
 */
const WINDOW_AGREE_DELTA_SEC = 1.5;
const AGREE_FIRST_CONF = 0.45;
const AGREE_FIRST_KEEP = 0.55;
const AGREE_FIRST_SHARP = 0.08;

export type WatchApplyKind = "first" | "refine";

export type WatchApplyHandler = (
  offsetMs: number,
  confidence: number,
  rewritten?:
    | {
        uri: string;
        mimeType: string;
        language?: string;
        label?: string;
      }
    | undefined,
  kind?: WatchApplyKind,
) => boolean | void | Promise<boolean | void>;

export type WatchSessionOptions = {
  contentId: string;
  subtitleCacheKey: string;
  /** Content-time anchor at activate (seconds). */
  fromSec: number;
  /** Latest stream duration for cache keys (0 if unknown). */
  durationSec: number;
  /** file:// URI of the subtitle to correlate against (null = wait). */
  getSubtitleUri: () => string | null;
  /** Preferred language for cache keys / rewrite metadata. */
  subtitleLanguage?: string;
  /** Live playback position (seconds) for the 5s anchor poll. */
  getPosition: () => number;
};

type Session = WatchSessionOptions & {
  cues: Cue[] | null;
  subtitleFormat: SubFormat | null;
  /** URI the loaded cues came from — invalidated when the live URI changes. */
  cuesFromUri: string | null;
  /** Last applied auto offset (ms) — null until first apply. */
  appliedMs: number | null;
  refinements: number;
  lastDeltaMs: number | null;
  /** P4: previous window's candidate (first-apply two-window agreement). */
  lastCandidateMs: number | null;
  lastCandidateConf: number;
  /** Whether the stashed candidate came from the wide-slice rescue. */
  lastCandidateFromRescue: boolean;
  /** P4: baseline came from the fetch cache, not a live apply (weaker trust). */
  adoptedFromCache: boolean;
  capAt: number;
  unsubSignal: () => void;
  anchorTimer: ReturnType<typeof setInterval> | null;
  lastAnchorPos: number;
  applying: boolean;
  stopped: boolean;
};

let session: Session | null = null;
let applyHandler: WatchApplyHandler | null = null;
/** Diagnostics: windows received this process (never reset per session). */
let signalCount = 0;
/**
 * Scoped native-log bridge (diagnostics). B4 removed the global onDebug
 * console mirror (it double-printed fetch-scan lines against the 500ms
 * poller), which also hid every WATCH-collector log — `watch: emit #N`,
 * `watch: skip emit`, silero init — exactly when a watch-only session runs
 * and no poller exists. While a watch session is live we mirror ONLY the
 * collector's messages (they are prefix-filtered to `watch`), so fetch
 * scans stay single-printed.
 */
let unsubNativeDebug: (() => void) | null = null;

function startNativeDebugBridge(): void {
  if (unsubNativeDebug) return;
  try {
    unsubNativeDebug = onDebug((msg) => {
      if (typeof msg === "string" && /^watch/.test(msg)) {
        console.log(`[SubSyncNative] ${msg}`);
      }
    });
  } catch {
    // bridge is best-effort
  }
}

function stopNativeDebugBridge(): void {
  try {
    unsubNativeDebug?.();
  } catch {
    // ignore
  }
  unsubNativeDebug = null;
}

// ── Watch-first UX (2026-09): progress pub/sub for the Auto Sync card ──
// The card polls watchSessionProgress() so it can show a live "heard Xs"
// line without a new native event surface. Reset on every session start.
let progress = {
  listenedSec: 0,
  candidateMs: null as number | null,
  appliedMs: null as number | null,
  /** Highest content-time credited so far (windows may re-cover ground). */
  creditedEndSec: 0,
};
const progressListeners = new Set<() => void>();

function notifyProgress(): void {
  progressListeners.forEach((l) => l());
}

/** Subscribe to watch-session progress (listening seconds + candidate). */
export function onWatchProgress(fn: () => void): () => void {
  progressListeners.add(fn);
  return () => {
    progressListeners.delete(fn);
  };
}

/** Latest watch-session progress snapshot (module-level, survives remounts). */
export function watchSessionProgress(): {
  listenedSec: number;
  candidateMs: number | null;
  appliedMs: number | null;
} {
  return {
    listenedSec: progress.listenedSec,
    candidateMs: progress.candidateMs,
    appliedMs: progress.appliedMs,
  };
}

/** Register the UI-side apply sink (SubtitleSheet). Replaces any prior handler. */
export function registerWatchApplyHandler(
  fn: WatchApplyHandler | null,
): () => void {
  applyHandler = fn;
  return () => {
    if (applyHandler === fn) applyHandler = null;
  };
}

function detectFormat(uri: string): SubFormat {
  const ext = uri.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  if (ext === "vtt") return "vtt";
  if (ext === "ass") return "ass";
  if (ext === "ssa") return "ssa";
  if (ext === "sub") return "sub";
  return "srt";
}

function cleanSubtitle(text: string, format: SubFormat): string {
  let t = text.replace(/^\uFEFF/, "");
  if (format === "srt" || format === "vtt") t = t.replace(/\r/g, "");
  return t;
}

/** Lazy-load cues from the current subtitle URI. Returns null when unavailable.
 *  Re-reads when the live URI changed (user picked a different subtitle file
 *  after tapping sync) so correlation never runs against a stale file. */
async function ensureCues(
  s: Session,
): Promise<{ cues: Cue[]; format: SubFormat } | null> {
  const uri = s.getSubtitleUri();
  if (!uri) return null;
  if (s.cues && s.subtitleFormat && s.cuesFromUri === uri) {
    return { cues: s.cues, format: s.subtitleFormat };
  }
  if (s.cues != null && s.cuesFromUri !== uri) {
    // The user picked a DIFFERENT subtitle file after tapping sync. The old
    // baseline/refinement state belongs to the previous file — reset to
    // fresh-session semantics so correlation starts clean for the new one.
    console.log(
      "[SubSync] watch: subtitle file changed - resetting session state",
    );
    s.cues = null;
    s.subtitleFormat = null;
    s.appliedMs = null;
    s.adoptedFromCache = false;
    s.refinements = 0;
    s.lastDeltaMs = null;
    s.lastCandidateMs = null;
    s.lastCandidateConf = 0;
    s.lastCandidateFromRescue = false;
    progress.appliedMs = null;
    progress.candidateMs = null;
    notifyProgress();
  }
  try {
    const text = await new File(uri).text();
    const format = detectFormat(uri);
    const cues = parseSubtitles(cleanSubtitle(text, format), format);
    if (cues.length < 8) {
      console.log(
        `[SubSync] watch: too few cues (${cues.length}) - skipping correlate`,
      );
      return null;
    }
    s.cues = cues;
    s.subtitleFormat = format;
    s.cuesFromUri = uri;
    console.log(
      `[SubSync] watch: loaded ${cues.length} cues (${format}) from ${uri.split("/").pop()}`,
    );
    return { cues, format };
  } catch (e: any) {
    console.log(`[SubSync] watch: cue load failed: ${e?.message ?? e}`);
    return null;
  }
}

/** Write the shifted sidecar (same rules as autoSync makeOffsetOutcome). */
async function prepareRewrite(
  cues: Cue[],
  offsetMs: number,
  format: SubFormat,
  subtitleUri: string,
  language?: string,
): Promise<
  | {
      uri: string;
      mimeType: string;
      language?: string;
      label?: string;
    }
  | undefined
> {
  const prev = appliedOffsetMs(subtitleUri) ?? 0;
  if (offsetMs === 0 && prev === 0) return undefined;
  // Already shifted to this exact value — hand back the existing file.
  if (offsetMs !== 0 && appliedOffsetMs(subtitleUri) === offsetMs) {
    return {
      uri: subtitleUri,
      mimeType: mimeTypeForFormat(format),
      language,
      label: subtitleUri.split("/").pop() ?? undefined,
    };
  }
  try {
    const uri = await writeShiftedSubtitleFile(
      cues,
      offsetMs / 1000,
      format,
      subtitleUri,
    );
    if (!uri) return undefined;
    return {
      uri,
      mimeType: mimeTypeForFormat(format),
      language,
      label: uri.split("/").pop() ?? undefined,
    };
  } catch (e: any) {
    console.log(`[SubSync] watch: rewrite failed: ${e?.message ?? e}`);
    return undefined;
  }
}

function sameSignSimilar(a: number, b: number): boolean {
  const sameSign = a * b > 0;
  return sameSign && Math.abs(Math.abs(a) - Math.abs(b)) < REFINE_SIMILAR_MS;
}

async function handleSignal(ev: WatchSignalEvent): Promise<void> {
  const s = session;
  if (!s || s.stopped || !WATCH_SYNC_ENABLED) return;
  if (Date.now() > s.capAt) {
    console.log("[SubSync] watch: 30-min session cap reached - stopping");
    stopWatchSession("cap");
    return;
  }
  if (s.applying) {
    console.log("[SubSync] watch: apply in flight - dropping this window");
    return;
  }
  if (!applyHandler) {
    console.log(
      "[SubSync] watch: no apply handler registered - dropping window",
    );
    return;
  }
  // Diagnostics: every native window that reaches JS. If this line never
  // appears for a session, the native audio-tap produced nothing (that is
  // an expo-video patch / audio-pipeline problem, not a correlation one).
  signalCount += 1;
  console.log(
    `[SubSync] watch: signal #${signalCount} [${ev.startSec.toFixed(1)}..${ev.endSec.toFixed(1)}]s bins=${ev.bins} baseline=${s.appliedMs ?? "none"}${s.adoptedFromCache ? " (cache)" : ""}`,
  );

  let sig: SpeechSignal;
  try {
    sig = validateSignal({
      rate: ev.rate,
      startSec: ev.startSec,
      endSec: ev.endSec,
      bins: ev.bins,
      signalB64: ev.signalB64,
    });
  } catch (e: any) {
    console.log(`[SubSync] watch: invalid signal: ${e?.message ?? e}`);
    return;
  }

  // Watch-first UX: a usable window landed — credit its span as "heard".
  // Only the part beyond what earlier windows already covered counts
  // (re-anchors can re-cover old ground; that isn't new evidence). Windows
  // rejected earlier (invalid signal, no handler, apply in flight) never
  // reach this line and don't count.
  const creditFrom = Math.max(ev.startSec, progress.creditedEndSec);
  if (ev.endSec > creditFrom) {
    progress.listenedSec += ev.endSec - creditFrom;
    progress.creditedEndSec = ev.endSec;
    notifyProgress();
  }

  const loaded = await ensureCues(s);
  if (!loaded) return;
  const { cues, format } = loaded;

  try {
    // P4: score against the window's cues only. The old whole-file cue set
    // made every live window's keep (and thus confidence) collapse — this is
    // the one-line root cause of "progressive sync never applied".
    const cuesInWindow = cues.filter(
      (c) => c.end >= sig.startSec && c.start <= sig.endSec,
    );
    if (cuesInWindow.length < 8) {
      console.log(
        `[SubSync] watch: window [${sig.startSec.toFixed(1)}..${sig.endSec.toFixed(1)}]s has ${cuesInWindow.length} cues - skipping`,
      );
      return;
    }
    let off = findOffset(cuesInWindow, sig);
    let conf = confidence(
      cuesInWindow,
      sig,
      off.offset,
      off.runnerUp,
      off.score,
    );
    let keep = keptFraction(cuesInWindow, sig, off.offset);
    let sharp =
      off.runnerUp >= 0
        ? (off.score - off.runnerUp) / Math.max(off.score, 0.02)
        : 1;
    console.log(
      `[SubSync] watch: correlate [${sig.startSec.toFixed(1)}..${sig.endSec.toFixed(1)}]s ` +
        `offset=${off.offset.toFixed(2)}s conf=${conf.toFixed(3)} keep=${keep.toFixed(2)} ` +
        `sharp=${sharp.toFixed(2)} (${cuesInWindow.length} window cues) ` +
        `applied=${s.appliedMs ?? "none"} refinements=${s.refinements}`,
    );

    // P5: SHORT-window wide-slice rescue. A watch window is ~60-90s of
    // audio, but real offsets reach ±90s (recap / cold-open / WEB-DL cuts).
    // At a large TRUE offset only a thin sliver of the window's cue set maps
    // into the span — the windowed scorer marks the true peak INVALID (no
    // cues) or keep-ineligible — so findOffset's winner is a junk near-zero
    // offset (device evidence: true +54.47s lost to -5.19s conf=0.370
    // sharp=0.00; even the FFT's coarse proposals cannot rank the truth
    // with ~3 cues of aligned mass). The rescuer direct-scans the whole
    // ±MAX_OFF range over WIDE slices of the FILE's cues. Runs even when a
    // (cache-adopted) baseline exists — if the rescue disagrees, it must
    // win the SAME two-window agreement as a first apply before it can
    // displace the baseline (below).
    let rescueWon = false;
    {
      const rescue = findOffsetWideSlice(cues, sig);
      if (rescue) {
        const rConf = confidenceWideSlice(
          rescue.cues,
          sig,
          rescue.offset,
          rescue.score,
          rescue.rivalScore,
        );
        if (rConf > conf) {
          const rSharp =
            rescue.rivalScore > 0
              ? (rescue.score - rescue.rivalScore) /
                Math.max(rescue.score, 0.02)
              : 1;
          console.log(
            `[SubSync] watch: wide-slice rescue accepted ` +
              `offset=${rescue.offset.toFixed(2)}s conf=${rConf.toFixed(3)} ` +
              `keep=${rescue.keep.toFixed(2)} sharp=${rSharp.toFixed(2)} ` +
              `(${rescue.cues.length} wide cues; was ${off.offset.toFixed(2)}s ` +
              `conf=${conf.toFixed(3)} keep=${keep.toFixed(2)})`,
          );
          off = {
            ...off,
            offset: rescue.offset,
            score: rescue.score,
            keep: rescue.keep,
          };
          conf = rConf;
          keep = rescue.keep;
          sharp = rSharp;
          rescueWon = true;
        }
      }
    }

    // Content-dead / no signal — skip without burning a refinement.
    if (off.score <= 0 || conf <= 0) return;

    const isFirst = s.appliedMs === null;
    let targetMs: number | null = null;
    let kind: WatchApplyKind | null = null;

    if (isFirst) {
      // No single-window first apply, even at checkpoint bars. A SHORT
      // window is locally ambiguous: at offset o the window only hears the
      // cue band [start-o..end-o], and on a recap/credits file that band is
      // sparse — so a WRONG offset can score higher than the truth inside
      // the window (device 2026-09: true +54.47s mapped to a 3-cue recap
      // band and lost to junk -26.28s on a 20.5s window; the fetch path
      // guards this exact case with early+late agreement before applying).
      // Stash and require the NEXT emit (≥45s later, a different cue band)
      // to agree before anything touches playback.
      targetMs = Math.round(off.offset * 1000);
      // Stash quality floor: a junk candidate (device: -33.20s, sharp 0.05)
      // must not occupy the pairing slot — a first stash needs its own
      // window to clear the per-window conf bar.
      if (
        s.lastCandidateMs == null &&
        (conf < AGREE_FIRST_CONF || sharp < AGREE_FIRST_SHARP)
      ) {
        console.log(
          `[SubSync] watch: candidate ${targetMs}ms below stash floor ` +
            `(conf=${conf.toFixed(3)}/${AGREE_FIRST_CONF} sharp=${sharp.toFixed(2)}/${AGREE_FIRST_SHARP}) - not stashing`,
        );
        return;
      }
      // Sharpness is per-window noise on wide-slice rescues (the "rival" is
      // a junk full-range candidate). When two independent windows AGREE on
      // the same offset, the agreement itself is the cross-validation —
      // sharp is exempt for rescue candidates (device: +53.73s and +54.69s
      // agreed within 0.96s but sharp 0.05 < 0.08 vetoed the apply).
      if (
        s.lastCandidateMs != null &&
        conf >= AGREE_FIRST_CONF &&
        keep >= AGREE_FIRST_KEEP &&
        (s.lastCandidateFromRescue || sharp >= AGREE_FIRST_SHARP) &&
        Math.abs(targetMs - s.lastCandidateMs) <= WINDOW_AGREE_DELTA_SEC * 1000
      ) {
        kind = "first";
        console.log(
          `[SubSync] watch: first apply via window agreement ${targetMs >= 0 ? "+" : ""}${(targetMs / 1000).toFixed(2)}s ` +
            `(windows Δ<=${WINDOW_AGREE_DELTA_SEC}s, this conf=${conf.toFixed(3)}/${AGREE_FIRST_CONF})`,
        );
      } else if (s.lastCandidateMs != null && conf < s.lastCandidateConf) {
        // Eviction discipline: a WEAKER candidate never replaces a stashed
        // one (device 2026-09: junk −36.12s conf=0.619 evicted the better
        // −5.11s conf=0.685 stash, costing one full emit cycle of latency).
        // Agreement with the stash is handled above; disagreement at lower
        // confidence leaves the stronger candidate waiting for its partner.
        console.log(
          `[SubSync] watch: candidate ${targetMs}ms conf=${conf.toFixed(3)} weaker than stash ` +
            `${s.lastCandidateMs}ms (${s.lastCandidateConf.toFixed(3)}) - stash kept`,
        );
        return;
      } else {
        // Stash this window's candidate and wait for the next emit (~30s).
        s.lastCandidateMs = targetMs;
        s.lastCandidateConf = conf;
        s.lastCandidateFromRescue = rescueWon;
        progress.candidateMs = targetMs;
        notifyProgress();
        console.log(
          `[SubSync] watch: first window below bar - candidate stashed ` +
            `(conf=${conf.toFixed(3)} keep=${keep.toFixed(2)} sharp=${sharp.toFixed(2)}${rescueWon ? ", rescue" : ""}), waiting for agreement`,
        );
        return;
      }
    } else {
      // P4: a strong window that clearly contradicts a CACHE-ADOPTED baseline
      // is a first-apply override, not a refinement — the cached offset was
      // never verified against live audio. (Live-applied baselines keep the
      // normal refinement guards.)
      // A rescue result that contradicts a CACHE baseline (never verified
      // against live audio) is not applied immediately: it is stashed and
      // must win the same two-window agreement as a first apply. (Windowed
      // scoring cannot see large offsets at all, so rescueWon is the only
      // signal that may legitimately displace the baseline.)
      if (
        s.adoptedFromCache &&
        rescueWon &&
        Math.abs(Math.round(off.offset * 1000) - s.appliedMs!) >
          WINDOW_AGREE_DELTA_SEC * 1000
      ) {
        const candMs = Math.round(off.offset * 1000);
        console.log(
          `[SubSync] watch: rescue ${candMs}ms contradicts cache baseline ${s.appliedMs}ms - stashing for agreement`,
        );
        s.appliedMs = null;
        s.adoptedFromCache = false;
        s.lastCandidateMs = candMs;
        s.lastCandidateConf = conf;
        progress.appliedMs = null;
        progress.candidateMs = candMs;
        notifyProgress();
        return;
      }
      const candMs = Math.round(off.offset * 1000);
      if (
        s.adoptedFromCache &&
        CHECKPOINT_EARLY_APPLY &&
        conf >= CHECKPOINT_CONF &&
        off.score > 0 &&
        keep >= CHECKPOINT_KEEP &&
        sharp >= CHECKPOINT_SHARP &&
        Math.abs(candMs - s.appliedMs!) > WINDOW_AGREE_DELTA_SEC * 1000
      ) {
        targetMs = candMs;
        kind = "first";
        console.log(
          `[SubSync] watch: strong window overrides cache baseline ${s.appliedMs}ms -> ${candMs}ms`,
        );
      } else {
        // Refinement guards.
        if (s.refinements >= REFINE_MAX) {
          console.log("[SubSync] watch: refinement budget spent - ignoring");
          return;
        }
        if (conf < REFINE_CONF) {
          console.log(
            `[SubSync] watch: refine conf ${conf.toFixed(3)} < ${REFINE_CONF} - ignoring`,
          );
          return;
        }
        const deltaMs = Math.round(off.offset * 1000) - s.appliedMs!;
        if (Math.abs(deltaMs) < REFINE_MIN_DELTA_MS) {
          // Distinguishes "baseline already correct" (expected when the
          // session adopted a good cache offset) from a weak measurement.
          console.log(
            `[SubSync] watch: refine |Δ|=${(Math.abs(deltaMs) / 1000).toFixed(2)}s < ${REFINE_MIN_DELTA_MS}ms - ignoring (baseline already matches${s.adoptedFromCache ? " the cached offset" : ""})`,
          );
          return;
        }
        if (s.lastDeltaMs != null && sameSignSimilar(deltaMs, s.lastDeltaMs)) {
          console.log(
            `[SubSync] watch: refine Δ=${(deltaMs / 1000).toFixed(2)}s same-sign-similar to last ` +
              `${(s.lastDeltaMs / 1000).toFixed(2)}s - rejecting`,
          );
          return;
        }
        targetMs = Math.round(off.offset * 1000);
        kind = "refine";
        console.log(
          `[SubSync] watch: refine ${s.appliedMs}ms -> ${targetMs}ms (Δ=${(deltaMs / 1000).toFixed(2)}s ` +
            `conf=${conf.toFixed(3)}) refine#${s.refinements + 1}/${REFINE_MAX}`,
        );
      }
    }

    if (targetMs == null || kind == null) return;

    const uri = s.getSubtitleUri();
    const rewritten = uri
      ? await prepareRewrite(cues, targetMs, format, uri, s.subtitleLanguage)
      : undefined;

    // Shared applyOnce gate with the fetch path (autoSync.applyOrConfirm).
    const priorAppliedMs = s.appliedMs;
    s.applying = true;
    let attachOk = true;
    try {
      const result = await runApplyOnce(async () => {
        // The handler returns false when the offset could NOT be attached
        // (sidecar re-add failed and rolled back) — the session must not
        // treat the offset as applied, and the UI must not persist it.
        const r = await applyHandler!(targetMs!, conf, rewritten, kind!);
        attachOk = r !== false;
        return true;
      });
      if (result == null) {
        // The fetch path is applying its own offset right now. Adopt it as
        // this session's baseline so later refinements measure against the
        // actually-applied value instead of re-running a stale first apply.
        console.log(
          `[SubSync] watch: applyOnce busy (fetch path holds the gate) - adopting ${targetMs}ms as baseline`,
        );
        s.appliedMs = targetMs;
        return;
      }
      if (!attachOk) {
        // ATTACH FAILED. Do NOT update the baseline, do NOT clear the
        // pending candidate, do NOT cache, and do NOT show success. The
        // device loop (2026-09): a failed attach still marked appliedMs,
        // the offset persisted to prefs/cache, and every later session
        // started poisoned on an unverified wrong offset.
        console.log(
          `[SubSync] watch: apply REJECTED - attach failed, baseline stays ${s.appliedMs ?? "none"}`,
        );
        s.lastCandidateMs = null;
        return;
      }
    } finally {
      s.applying = false;
    }

    if (kind === "refine" && priorAppliedMs != null) {
      s.lastDeltaMs = targetMs - priorAppliedMs;
      s.refinements++;
    }
    s.appliedMs = targetMs;
    s.lastCandidateMs = null;
    s.lastCandidateConf = 0;
    s.lastCandidateFromRescue = false;
    progress.appliedMs = targetMs;
    progress.candidateMs = null;
    notifyProgress();

    // I-2: surface the outcome to the user even with the sheet closed — the
    // session owner owns the toast (first apply + every correction).
    try {
      const signed = `${targetMs >= 0 ? "+" : "−"}${Math.abs(targetMs / 1000).toFixed(2)}s`;
      if (kind === "first") {
        downloadToast.success(`Subtitles synced (${signed})`);
      } else if (priorAppliedMs != null) {
        const delta = (targetMs - priorAppliedMs) / 1000;
        downloadToast.info(
          `Subtitles adjusted by ${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)}s`,
        );
      } else {
        downloadToast.info(`Subtitles synced (${signed})`);
      }
    } catch {
      // toast is best-effort
    }

    // Cache so a later fetch-path Auto Sync can short-circuit.
    try {
      const contentKey = `${s.contentId}:${Math.round(s.durationSec)}`;
      if (kind === "first") {
        await setCachedSync(s.subtitleCacheKey, contentKey, {
          offsetMs: targetMs,
          scale: 1,
          method: "offset",
          confidence: conf,
          createdAt: Date.now(),
        });
      }
      const winKey = watchWindowKeyFor(sig.startSec, sig.endSec);
      await setCachedWindow(s.subtitleCacheKey, s.contentId, winKey, {
        offsetMs: targetMs,
        confidence: conf,
        createdAt: Date.now(),
        startSec: sig.startSec,
        endSec: sig.endSec,
        bins: sig.bins,
        signalB64: ev.signalB64,
      });
    } catch {
      // cache is best-effort
    }
  } catch (e: any) {
    console.log(`[SubSync] watch: correlate error: ${e?.message ?? e}`);
  }
}

/** Parse-and-handle a raw event (never throws). */
function onSignalSafe(ev: WatchSignalEvent): void {
  void handleSignal(ev).catch((e) => {
    console.log(`[SubSync] watch: unhandled signal error: ${e?.message ?? e}`);
  });
}

/**
 * Start (or replace) the watch session. Returns false when the kill-switch is
 * off or native activate fails. HevcPlayer owns start/stop/anchor calls.
 */
export async function startWatchSession(
  opts: WatchSessionOptions,
): Promise<boolean> {
  if (!WATCH_SYNC_ENABLED) {
    console.log("[SubSync] watch: WATCH_SYNC_ENABLED=false - not starting");
    return false;
  }
  // Idempotent restart: an already-active session for the SAME content keeps
  // its applied offset / refinement budget — only re-anchor to the current
  // position. A different contentId still gets a full stop+start.
  const existing = session;
  if (existing && !existing.stopped && existing.contentId === opts.contentId) {
    console.log(
      `[SubSync] watch: session already active for ${opts.contentId} - re-anchoring (idempotent restart)`,
    );
    anchorWatchSession(Math.max(0, opts.fromSec));
    return true;
  }
  stopWatchSession("restart");

  // P4: adopt an already-computed fetch offset as the session baseline.
  // With playhead-anchored scanning the fetch result IS the watched scene's
  // answer — adopting it means live windows start as refinements immediately
  // (or confirm it), instead of re-deriving a first apply from scratch.
  // Tagged adoptedFromCache so a strong contradicting live window can still
  // override (the cached number was never verified against this stream).
  let adoptedMs: number | null = null;
  try {
    const cachedSync = await getCachedSync(
      opts.subtitleCacheKey,
      `${opts.contentId}:${Math.round(opts.durationSec)}`,
    );
    if (cachedSync?.offsetMs != null) {
      adoptedMs = cachedSync.offsetMs;
      console.log(
        `[SubSync] watch: adopting fetch cache offset ${adoptedMs}ms as baseline (conf=${cachedSync.confidence.toFixed(3)})`,
      );
    }
  } catch {
    // cache read is best-effort
  }
  try {
    const activated = await activateWatchSync({
      fromSec: Math.max(0, opts.fromSec),
      // 60s windows (was 90): shorter independent windows make the two-window
      // agreement gate land sooner. The wide-slice rescue already converges on
      // 60-65s spans on device (conf 0.809/0.884) — evidence pace, not gate
      // strictness, was setting sync latency (first apply ~180s).
      windowSec: 60,
      useSilero: true,
      vadMarkOn: MARK_ON,
      vadMarkOff: MARK_OFF,
    });
    if (!activated?.ok && !activated?.active) {
      console.log("[SubSync] watch: native activate failed", activated);
      return false;
    }
  } catch (e: any) {
    console.log(`[SubSync] watch: native activate threw: ${e?.message ?? e}`);
    return false;
  }

  const s: Session = {
    ...opts,
    cues: null,
    subtitleFormat: null,
    cuesFromUri: null,
    appliedMs: adoptedMs,
    adoptedFromCache: adoptedMs != null,
    refinements: 0,
    lastDeltaMs: null,
    lastCandidateMs: null,
    lastCandidateConf: 0,
    lastCandidateFromRescue: false,
    capAt: Date.now() + SESSION_CAP_MS,
    unsubSignal: onWatchSignal(onSignalSafe),
    anchorTimer: null,
    lastAnchorPos: Math.max(0, opts.fromSec),
    applying: false,
    stopped: false,
  };
  session = s;
  progress = {
    listenedSec: 0,
    candidateMs: null,
    appliedMs: adoptedMs,
    creditedEndSec: 0,
  };
  notifyProgress();
  startNativeDebugBridge();

  // 5s anchor poll: re-base when content time jumped beyond expected drift
  // (seek that bypassed isSeeking, stall recovery, etc.). Position comes
  // from the player via opts.getPosition — see HevcPlayer wiring.
  s.anchorTimer = setInterval(() => {
    const cur = session;
    if (!cur || cur.stopped) return;
    if (Date.now() > cur.capAt) {
      stopWatchSession("cap");
      return;
    }
    try {
      const pos = cur.getPosition();
      if (!Number.isFinite(pos) || pos < 0) return;
      // FROZEN POSITION (paused / stalled / buffering): do NOT re-anchor.
      // Device logs (2026-09) showed the old logic re-anchoring every 5s
      // while paused (drift = poll interval > tolerance), which spammed
      // native rebuilds + VAD re-inits AND wiped any accumulated partial
      // window on every pause/play cycle. A frozen playhead is not a seek.
      // (A resume after a real stall still trips the drift check below on
      // the next poll — and that re-anchor also clears native suspension.)
      const moved = Math.abs(pos - cur.lastAnchorPos);
      if (moved < 0.25) return;
      // Expected continuous-play drift is ~ANCHOR_POLL_MS of content time;
      // anything far from that is a discontinuity worth re-anchoring.
      const elapsed = ANCHOR_POLL_MS / 1000;
      const drift = Math.abs(pos - cur.lastAnchorPos - elapsed);
      if (drift > ANCHOR_DRIFT_TOLERANCE_SEC) {
        anchorWatchSession(pos);
      } else {
        cur.lastAnchorPos = pos;
      }
    } catch {
      // best-effort
    }
  }, ANCHOR_POLL_MS);

  console.log(
    `[SubSync] watch: session started contentId=${opts.contentId} from=${opts.fromSec.toFixed(1)}s ` +
      `cap=${SESSION_CAP_MS / 1000}s baseline=${adoptedMs != null ? `${adoptedMs}ms (cache)` : "none"}`,
  );
  return true;
}

/**
 * Re-base the native window (after a seek resolves or a large jump).
 * Emits any usable partial first (native side).
 */
export function anchorWatchSession(toSec: number): boolean {
  const s = session;
  if (!s || s.stopped || !WATCH_SYNC_ENABLED) return false;
  if (!Number.isFinite(toSec) || toSec < 0) return false;
  if (Date.now() > s.capAt) {
    stopWatchSession("cap");
    return false;
  }
  const drift = Math.abs(toSec - s.lastAnchorPos);
  s.lastAnchorPos = toSec;
  try {
    nativeWatchAnchor(toSec);
    if (drift > ANCHOR_DRIFT_TOLERANCE_SEC) {
      console.log(
        `[SubSync] watch: anchor -> ${toSec.toFixed(1)}s (drift ${drift.toFixed(1)}s)`,
      );
    }
    return true;
  } catch (e: any) {
    console.log(`[SubSync] watch: anchor failed: ${e?.message ?? e}`);
    return false;
  }
}

/** Stop the session (source change, unmount, video end, cap, kill-switch). */
export function stopWatchSession(reason = "stop"): boolean {
  const s = session;
  if (!s) {
    console.log(
      `[SubSync] watch: stop ignored - no active session (${reason})`,
    );
    return false;
  }
  console.log(
    `[SubSync] watch: stopping session (${reason}) applied=${s.appliedMs ?? "none"} refinements=${s.refinements} signalsSeen=${signalCount}`,
  );
  s.stopped = true;
  if (s.anchorTimer) {
    clearInterval(s.anchorTimer);
    s.anchorTimer = null;
  }
  try {
    s.unsubSignal();
  } catch {
    // ignore
  }
  session = null;
  progress = {
    listenedSec: 0,
    candidateMs: null,
    appliedMs: progress.appliedMs,
    creditedEndSec: 0,
  };
  notifyProgress();
  stopNativeDebugBridge();
  try {
    nativeStopWatchSync();
  } catch {
    // ignore
  }
  return true;
}

/** Diagnostics for device logs / Stage C probe. */
export function watchSessionStatus(): {
  active: boolean;
  appliedMs?: number;
  refinements?: number;
  capAt?: number;
  lastAnchorPos?: number;
  /** True when a session is live AND the playing-time deadline is still open. */
  deadlineOpen?: boolean;
  /** Seconds of usable audio heard this session (watch-first UX). */
  listenedSec?: number;
} {
  const s = session;
  if (!s) return { active: false };
  return {
    active: !s.stopped,
    appliedMs: s.appliedMs ?? undefined,
    refinements: s.refinements,
    capAt: s.capAt,
    lastAnchorPos: s.lastAnchorPos,
    deadlineOpen: Date.now() < s.capAt,
    listenedSec: progress.listenedSec,
  };
}

// Re-export the shared gate so callers can probe without importing autoSync.
export { runApplyOnce };
