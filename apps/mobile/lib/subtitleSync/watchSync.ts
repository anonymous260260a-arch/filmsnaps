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
import { findOffset, confidence, keptFraction } from "./correlate";
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
import { setCachedSync, setCachedWindow } from "./cache";
import { watchWindowKeyFor } from "./autoSync";
import { MARK_ON, MARK_OFF } from "./engineConstants";
import { parseSubtitles } from "./parseSubtitles";
import {
  activateWatchSync,
  watchAnchor as nativeWatchAnchor,
  stopWatchSync as nativeStopWatchSync,
  onWatchSignal,
  type WatchSignalEvent,
} from "expo-subtitle-sync";

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
) => void | Promise<void>;

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
  /** Last applied auto offset (ms) — null until first apply. */
  appliedMs: number | null;
  refinements: number;
  lastDeltaMs: number | null;
  capAt: number;
  unsubSignal: () => void;
  anchorTimer: ReturnType<typeof setInterval> | null;
  lastAnchorPos: number;
  applying: boolean;
  stopped: boolean;
};

let session: Session | null = null;
let applyHandler: WatchApplyHandler | null = null;

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

/** Lazy-load cues from the current subtitle URI. Returns null when unavailable. */
async function ensureCues(
  s: Session,
): Promise<{ cues: Cue[]; format: SubFormat } | null> {
  if (s.cues && s.subtitleFormat)
    return { cues: s.cues, format: s.subtitleFormat };
  const uri = s.getSubtitleUri();
  if (!uri) return null;
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

  const loaded = await ensureCues(s);
  if (!loaded) return;
  const { cues, format } = loaded;

  try {
    const off = findOffset(cues, sig);
    const conf = confidence(cues, sig, off.offset, off.runnerUp, off.score);
    const keep = keptFraction(cues, sig, off.offset);
    const sharp =
      off.runnerUp >= 0
        ? (off.score - off.runnerUp) / Math.max(off.score, 0.02)
        : 1;
    console.log(
      `[SubSync] watch: correlate [${sig.startSec.toFixed(1)}..${sig.endSec.toFixed(1)}]s ` +
        `offset=${off.offset.toFixed(2)}s conf=${conf.toFixed(3)} keep=${keep.toFixed(2)} ` +
        `sharp=${sharp.toFixed(2)} applied=${s.appliedMs ?? "none"} refinements=${s.refinements}`,
    );

    // Content-dead / no signal — skip without burning a refinement.
    if (off.score <= 0 || conf <= 0) return;

    const isFirst = s.appliedMs === null;
    let targetMs: number | null = null;
    let kind: WatchApplyKind | null = null;

    if (isFirst) {
      // First apply: same checkpoint bars as the fetch early path.
      if (
        CHECKPOINT_EARLY_APPLY &&
        conf >= CHECKPOINT_CONF &&
        off.score > 0 &&
        keep >= CHECKPOINT_KEEP &&
        sharp >= CHECKPOINT_SHARP
      ) {
        targetMs = Math.round(off.offset * 1000);
        kind = "first";
        console.log(
          `[SubSync] watch: first apply checkpoint ${targetMs >= 0 ? "+" : ""}${(targetMs / 1000).toFixed(2)}s ` +
            `(conf=${conf.toFixed(3)}/${CHECKPOINT_CONF} keep=${keep.toFixed(2)}/${CHECKPOINT_KEEP} ` +
            `sharp=${sharp.toFixed(2)}/${CHECKPOINT_SHARP})`,
        );
      } else {
        console.log(
          `[SubSync] watch: first window below checkpoint bar - waiting for a stronger window ` +
            `(conf=${conf.toFixed(3)} keep=${keep.toFixed(2)} sharp=${sharp.toFixed(2)})`,
        );
        return;
      }
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
        console.log(
          `[SubSync] watch: refine |Δ|=${(Math.abs(deltaMs) / 1000).toFixed(2)}s < ${REFINE_MIN_DELTA_MS}ms - ignoring`,
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

    if (targetMs == null || kind == null) return;

    const uri = s.getSubtitleUri();
    const rewritten = uri
      ? await prepareRewrite(cues, targetMs, format, uri, s.subtitleLanguage)
      : undefined;

    // Shared applyOnce gate with the fetch path (autoSync.applyOrConfirm).
    const priorAppliedMs = s.appliedMs;
    s.applying = true;
    try {
      const result = await runApplyOnce(async () => {
        await applyHandler!(targetMs!, conf, rewritten, kind!);
        return true;
      });
      if (result == null) {
        console.log(
          "[SubSync] watch: applyOnce busy (fetch path holds the gate) - skipped",
        );
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
  stopWatchSession("restart");
  try {
    const activated = await activateWatchSync({
      fromSec: Math.max(0, opts.fromSec),
      windowSec: 90,
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
    appliedMs: null,
    refinements: 0,
    lastDeltaMs: null,
    capAt: Date.now() + SESSION_CAP_MS,
    unsubSignal: onWatchSignal(onSignalSafe),
    anchorTimer: null,
    lastAnchorPos: Math.max(0, opts.fromSec),
    applying: false,
    stopped: false,
  };
  session = s;

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
      `cap=${SESSION_CAP_MS / 1000}s`,
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
  if (!s) return false;
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
  try {
    nativeStopWatchSync();
  } catch {
    // ignore
  }
  console.log(
    `[SubSync] watch: session stopped (${reason}) applied=${s.appliedMs ?? "none"} ` +
      `refinements=${s.refinements}`,
  );
  return true;
}

/** Diagnostics for device logs / Stage C probe. */
export function watchSessionStatus(): {
  active: boolean;
  appliedMs?: number;
  refinements?: number;
  capAt?: number;
  lastAnchorPos?: number;
} {
  const s = session;
  if (!s) return { active: false };
  return {
    active: !s.stopped,
    appliedMs: s.appliedMs ?? undefined,
    refinements: s.refinements,
    capAt: s.capAt,
    lastAnchorPos: s.lastAnchorPos,
  };
}

// Re-export the shared gate so callers can probe without importing autoSync.
export { runApplyOnce };
