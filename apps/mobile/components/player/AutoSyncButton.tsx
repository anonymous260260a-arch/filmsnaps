/**
 * AutoSyncButton — card UI for automatic subtitle synchronization.
 *
 * UX design (keep in sync with SubtitleSheet):
 *  - Novice-first: the card's title is the user's problem ("Subtitles out of
 *    sync?"), one line explains the mechanism, one primary action. No jargon.
 *  - The run lives in a MODULE-LEVEL RUNNER: closing the sheet does NOT cancel
 *    it. The user is told they can keep watching; the result applies and
 *    toasts on its own. Only an explicit tap on Cancel cancels.
 *  - Perceived-speed techniques (honest, monotonic): staged verb copy
 *    (Connecting → Listening → Matching), an eased progress mapping that
 *    moves fast early, specific two-decimal offsets on success, skeleton
 *    expectations ("usually under a minute").
 *
 * States: idle → running (connect/listen/analyze stages) → applied | failed.
 */

import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
  Animated,
  type TextStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import { File } from "expo-file-system";
import { colors } from "../../theme/colors";
import type {
  SourceRef,
  NetworkType,
  SourceKind,
} from "../../lib/subtitleSync/source";
import { detectKind, isHlsOrDash } from "../../lib/subtitleSync/source";
import { autoSync, cancelAutoSync } from "../../lib/subtitleSync/autoSync";
import {
  WATCH_FIRST_TAP,
  WATCH_FIRST_DEADLINE_PLAYED_SEC,
} from "../../lib/subtitleSync/engineConstants";
import {
  onWatchProgress,
  stopWatchSession,
  watchSessionProgress,
  watchSessionStatus,
} from "../../lib/subtitleSync/watchSync";
import { tapProbe } from "expo-subtitle-sync";
import type { SubFormat, SyncOutcome } from "../../lib/subtitleSync/types";
import { downloadToast } from "../DownloadToast";

export type AutoSyncSourceInfo = {
  uri: string;
  headers: Record<string, string>;
  container: SourceRef["container"];
  durationSec: number;
  kind: "local" | "remote";
};

const GATE_REASONS: Record<string, string> = {
  hls: "Auto sync isn't available for this HLS stream.",
  live: "Live streams can't be auto-synced.",
  dash: "DASH streams aren't supported for auto sync yet.",
  "mkv-ios":
    "MKV/WebM auto sync isn't supported on iPhone — try the downloaded file.",
  drm: "This stream is DRM-protected — auto sync isn't possible.",
  "probe-fail":
    "Couldn't inspect the stream URL for auto sync. Try again, or use the downloaded file.",
};

type Props = {
  sourceInfo: () => AutoSyncSourceInfo;
  contentId: string;
  subtitleUri: string | null;
  subtitleLanguage?: string;
  onSynced: (
    offsetMs: number,
    confidence: number,
    rewritten?: {
      uri: string;
      mimeType: string;
      language?: string;
      label?: string;
    },
  ) => void;
  startWatch?: () => boolean | Promise<boolean>;
  /** Live playhead (seconds) for the playhead-anchored scan. */
  startWatchPosition?: () => number;
};

// ---------------------------------------------------------------------------
// Module-level runner: survives the sheet closing (background sync).
// ---------------------------------------------------------------------------

type SyncStage = "connect" | "listen" | "analyze" | "watch";
type RunnerStatus =
  | "idle"
  | "running"
  /** Watch-first: session is live and listening; deadline not yet reached. */
  | "watching"
  /** Watch-first: deadline reached without an apply — manual scan offered. */
  | "scan-offer"
  | "applied"
  | "failed";

type RunnerState = {
  status: RunnerStatus;
  stage: SyncStage;
  /** Raw 0..1 from the engine — the UI applies the perceived-speed easing. */
  progress: number;
  /** Success line (e.g. "Synced +52.49s"). */
  resultText: string | null;
  /** Info / error line. */
  message: string | null;
  /** Watch-first: seconds of usable dialogue heard this session. */
  watchedSec: number;
  /** Watch-first: number of live session restarts (sub re-pick etc). */
  watchEpoch: number;
};

interface RunHooks {
  sourceInfo: () => AutoSyncSourceInfo;
  contentId: string;
  subtitleUri: string | null;
  subtitleLanguage?: string;
  onSynced: Props["onSynced"];
  startWatch?: Props["startWatch"];
  /** Live playhead (seconds) captured when the run starts — scan anchor. */
  anchorSec?: () => number | null;
  /** True when the fetch scan should stop (watch sync already applied). */
  shouldAbort?: () => boolean;
}

const INITIAL: RunnerState = {
  status: "idle",
  stage: "connect",
  progress: 0,
  resultText: null,
  message: null,
  watchedSec: 0,
  watchEpoch: 0,
};

let runnerState: RunnerState = INITIAL;
const runnerListeners = new Set<() => void>();
let runToken = 0;
let allowBytesNextAttempt = false;
/** Watch-first deadline ticker (module-level so it survives sheet remounts). */
let watchTicker: ReturnType<typeof setInterval> | null = null;
/**
 * Watch-first: the appliedMs the session STARTED with (fetch-cache adopt).
 * The applied-transition subscription fires only when the live appliedMs
 * MOVES off this baseline — otherwise a cached baseline would render the
 * card "Synced" the instant the session starts.
 */
let watchBaselineAppliedMs: number | null = null;

function setRunner(patch: Partial<RunnerState>) {
  runnerState = { ...runnerState, ...patch };
  runnerListeners.forEach((l) => l());
}

/** Eased mapping: the bar moves fast early (a moving bar feels fast; a
 *  stalled one feels broken), never sits at 0%, and only hits 100% on done.
 *  Monotonic in the raw progress — honest, just front-loaded. */
function easeProgress(p: number): number {
  if (p >= 1) return 1;
  const eased = 0.06 + 0.94 * (1 - Math.pow(1 - Math.max(0, p), 1.4));
  return Math.min(eased, 0.97);
}

function beginWatch(hooks: RunHooks): Promise<void> {
  if (!hooks.startWatch) return Promise.resolve();
  return Promise.resolve(hooks.startWatch())
    .then((ok: boolean) => {
      if (ok)
        console.log("[SubSync] watch: session started from Auto Sync tap");
    })
    .catch((e: any) => {
      console.log(`[SubSync] watch: start failed: ${e?.message ?? e}`);
    });
}

// ── Watch-first tap flow (2026-09) ─────────────────────────────────────
// Tap = watch session ONLY (no network scan). If the deadline passes
// without an apply, the card parks at "scan-offer" with a manual button.
// The fetch path stays available via that button (legacy startRun).

/**
 * Playing-time deadline ticker. Paused playback does NOT burn the budget —
 * a session can sit paused indefinitely without falsely expiring.
 */
function startWatchDeadlineTicker(hooks: RunHooks, startPos: number) {
  if (watchTicker) clearInterval(watchTicker);
  /** Playing-time accumulator: burns only while content actually advances. */
  let playingSec = 0;
  let lastPos = Math.max(0, startPos);
  /** Probe cadence counter (log every 5th tick = ~5s). */
  let tickProbeN = 0;
  watchTicker = setInterval(() => {
    try {
      const st = watchSessionStatus();
      if (!st.active) {
        // Session died natively (cap, source change, player teardown).
        if (watchTicker) {
          clearInterval(watchTicker);
          watchTicker = null;
        }
        if (runnerState.status === "watching" && runnerState.message == null) {
          setRunner({
            status: "scan-offer",
            message: "Sync stopped (playback ended or source changed).",
          });
        }
        return;
      }
      // Playing-time accounting: count only forward movement in the expected
      // 1s-poll band (a paused player has ~0 delta; a seek jump is excluded).
      const pos = Math.max(0, hooks.anchorSec?.() ?? 0);
      const delta = pos - lastPos;
      if (delta > 0.2 && delta <= 2.5) {
        playingSec += delta;
      }
      lastPos = pos;
      // ── AUDIO-TAP PROBE (diagnostics, 2026-09) ──
      // Every 5s while watching: is PCM actually flowing into the native
      // tap, and does the tap's route/format match the collector's claim?
      //   bytes flat + ageMs growing + listening=true → tap claimed but NO
      //     PCM reaches it (claim race or HLS audio not routed through the
      //     tapped sink) — the fetch path works because it reads the
      //     network directly, never this tap.
      //   listening=false → no tap was ever configured (player built
      //     before the patch was applied / different renderer path).
      //   sampleRate=0 → sink never configured (same conclusion).
      tickProbeN = (tickProbeN + 1) % 5;
      if (tickProbeN === 0) {
        try {
          const pb = tapProbe();
          console.log(
            `[SubSyncTap] bytes=${pb.totalBytes} ageMs=${pb.ageMs} listening=${pb.listening} sr=${pb.sampleRate} flushes=${pb.flushes} segResets=${pb.segmentResets}`,
          );
        } catch {
          // probe unavailable — non-patched expo-video build
        }
      }
      // Live "heard" line: window-credited audio, floored by playing sec.
      const listened = Math.min(
        Math.max(st.listenedSec ?? 0, Math.round(playingSec)),
        WATCH_FIRST_DEADLINE_PLAYED_SEC,
      );
      if (runnerState.watchedSec !== listened) {
        setRunner({ watchedSec: listened });
      }
      // State moved on (applied elsewhere, cancelled, fetch run took over).
      if (
        runnerState.status !== "watching" &&
        runnerState.status !== "running"
      ) {
        if (watchTicker) {
          clearInterval(watchTicker);
          watchTicker = null;
        }
        return;
      }
      if (
        playingSec >= WATCH_FIRST_DEADLINE_PLAYED_SEC &&
        st.appliedMs == null
      ) {
        if (watchTicker) {
          clearInterval(watchTicker);
          watchTicker = null;
        }
        // Deadline reached without an apply — keep the session alive (it can
        // still land later) but park the card with the manual affordance.
        console.log(
          `[SubSync] watch-first: deadline reached (playing=${Math.round(playingSec)}s, applied=${String(st.appliedMs)}, heard=${st.listenedSec ?? 0}s) - offering manual scan`,
        );
        setRunner({ status: "scan-offer" });
      }
    } catch {
      // best-effort
    }
  }, 1000);
}

/**
 * Watch-first tap: start the watch session and tick the deadline. No network
 * scan ever starts from the tap itself — zero data usage by default.
 */
async function startWatchFirst(hooks: RunHooks) {
  if (runnerState.status === "running") cancelRun();
  if (watchTicker) {
    clearInterval(watchTicker);
    watchTicker = null;
  }
  const token = ++runToken;
  const alive = () => token === runToken;

  if (!hooks.subtitleUri) {
    setRunner({
      status: "failed",
      resultText: null,
      message: "Load a subtitle first — sync needs a file.",
      watchedSec: 0,
    });
    return;
  }

  setRunner({
    status: "watching",
    stage: "watch",
    progress: 0,
    resultText: null,
    message: null,
    watchedSec: 0,
    watchEpoch: runnerState.watchEpoch + 1,
  });

  await beginWatch(hooks);
  if (!alive()) return;

  // Confirm the session actually started (kill-switch off, native activate
  // ok). A failed start lands the card on the manual scan affordance
  // instead of pretending to listen forever.
  const st = watchSessionStatus();
  if (!st.active) {
    console.log(
      "[SubSync] watch-first: session failed to start - offering scan",
    );
    setRunner({
      status: "scan-offer",
      message: "Listening isn't available right now — you can scan instead.",
    });
  } else {
    // Baseline = whatever the session adopted at start (usually null). The
    // subscription below fires only on a MOVE off this value.
    watchBaselineAppliedMs = st.appliedMs ?? null;
    startWatchDeadlineTicker(hooks, hooks.anchorSec?.() ?? 0);
  }
}

function cancelRun() {
  runToken++; // invalidate any in-flight run's continuations
  if (runnerState.status === "running") {
    cancelAutoSync();
  }
  if (watchTicker) {
    clearInterval(watchTicker);
    watchTicker = null;
  }
  // Watch-first: cancel the live session too so it never applies after
  // the user's explicit cancel. Freeze the baseline so a late session apply
  // (raced teardown) can't resurrect the card.
  try {
    watchBaselineAppliedMs = watchSessionProgress().appliedMs;
    stopWatchSession("user-cancel");
  } catch {
    // best-effort
  }
  setRunner({
    status: "idle",
    stage: "connect",
    progress: 0,
    resultText: null,
    message: null,
    watchedSec: 0,
  });
}

async function startRun(hooks: RunHooks) {
  if (runnerState.status === "running") cancelRun();
  const token = ++runToken;
  const alive = () => token === runToken;
  await beginWatch(hooks);
  if (!alive()) return;

  if (!hooks.subtitleUri) {
    setRunner({
      status: "failed",
      resultText: null,
      message: "Load a subtitle first — sync needs a file.",
    });
    return;
  }

  const info = hooks.sourceInfo();
  if (isHlsOrDash(info.uri) && /\.mpd($|\?)/i.test(info.uri)) {
    setRunner({
      status: "failed",
      resultText: null,
      message: "Auto sync doesn't support DASH streams yet.",
    });
    console.log("[SubSync] gated: DASH stream");
    return;
  }

  setRunner({
    status: "running",
    stage: "connect",
    progress: 0,
    resultText: null,
    message: null,
  });
  const t0 = Date.now();
  const kind: SourceKind = detectKind(info.uri);
  console.log(
    `[SubSync] start: contentId=${hooks.contentId} kind=${kind} container=${info.container} ` +
      `dur=${info.durationSec.toFixed(0)}s sub=${hooks.subtitleUri.split("/").pop()}`,
  );

  try {
    const subText = await new File(hooks.subtitleUri).text();
    if (!alive()) return;
    const format = detectFormat(hooks.subtitleUri);
    const network = await currentNetwork();
    if (!alive()) return;
    console.log(`[SubSync] subtitle ${format}, network=${network}`);

    const source: SourceRef = {
      contentId: hooks.contentId,
      kind,
      container: info.container,
      resolve: async () => {
        const latest = hooks.sourceInfo();
        return { uri: latest.uri, headers: latest.headers };
      },
    };

    const outcome: SyncOutcome = await autoSync({
      source,
      durationSec: info.durationSec,
      // P4: scan around where the user is watching, and stop fetching the
      // moment a watch-sync apply lands — the run exists to serve the scene
      // on screen, not the file head.
      anchorSec: hooks.anchorSec?.() ?? undefined,
      shouldAbort: hooks.shouldAbort,
      subtitleText: subText,
      subtitleFormat: format,
      subtitleCacheKey: hooks.subtitleUri.split("/").pop() ?? "sub",
      subtitleUri: hooks.subtitleUri,
      subtitleLanguage:
        hooks.subtitleLanguage ?? detectSubtitleLanguage(hooks.subtitleUri),
      network,
      platform: Platform.OS === "ios" ? "ios" : "android",
      allowConfirmBytes: allowBytesNextAttempt,
      onProgress: (p, stage) => {
        if (!alive()) return;
        setRunner(
          stage === "analyze"
            ? { stage: "analyze", progress: p }
            : { stage: "listen", progress: p },
        );
      },
    });

    if (!alive()) return;
    console.log(
      `[SubSync] outcome: ${JSON.stringify(outcome)} in ${Date.now() - t0}ms`,
    );
    const uiVisible = runnerListeners.size > 0;

    switch (outcome.type) {
      case "offset": {
        const resultText =
          outcome.notice ??
          `Synced ${outcome.offsetMs > 0 ? "+" : "−"}${Math.abs(outcome.offsetMs / 1000).toFixed(2)}s` +
            (outcome.confidence < 0.6 ? " — low confidence, verify" : "");
        setRunner({ status: "applied", resultText, message: null });
        if (outcome.notice) downloadToast.info(outcome.notice);
        if (!uiVisible) downloadToast.info(resultText); // sheet closed: still tell the user
        hooks.onSynced(outcome.offsetMs, outcome.confidence, outcome.rewritten);
        break;
      }
      case "rewritten":
        setRunner({
          status: "applied",
          resultText: "Synced (timing rescaled)",
          message: null,
        });
        if (!uiVisible) downloadToast.info("Subtitles synced");
        break;
      case "kept":
        setRunner({
          status: "failed",
          resultText: null,
          message: "Couldn't improve on the existing sync — keeping it",
        });
        break;
      case "failed": {
        const message = GATE_REASONS[outcome.reason] ?? outcome.reason;
        setRunner({ status: "failed", resultText: null, message });
        if (!uiVisible) downloadToast.info(message);
        break;
      }
      case "cancelled":
        setRunner({ status: "idle", resultText: null, message: null });
        break;
      case "confirm-bybytes": {
        setRunner({ status: "idle", resultText: null, message: null });
        const mb = outcome.projectedMb;
        Alert.alert(
          "Large download on cellular",
          `Auto sync needs about ${mb} MB of mobile data for this scan. Continue?`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Continue",
              onPress: () => {
                allowBytesNextAttempt = true;
                void startRun(hooks);
              },
            },
            {
              text: "Watch-sync instead (no extra data)",
              onPress: () => {
                console.log(
                  "[SubSync] cellular: user chose watch-sync piggyback (skip fetch scan)",
                );
                void beginWatch(hooks);
                const msg = "Watching playback to sync — no extra data.";
                setRunner({ status: "idle", resultText: null, message: msg });
                downloadToast.info(msg);
              },
            },
          ],
          { cancelable: true },
        );
        break;
      }
    }
  } catch (e: any) {
    if (!alive()) return;
    console.log(`[SubSync] error: ${e?.message ?? e}`);
    setRunner({
      status: "failed",
      resultText: null,
      message: e?.message ?? "unknown error",
    });
  } finally {
    allowBytesNextAttempt = false;
  }
}

// ---------------------------------------------------------------------------
// Helpers (unchanged logic)
// ---------------------------------------------------------------------------

function detectFormat(uri: string): SubFormat {
  const ext = uri.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  if (ext === "vtt") return "vtt";
  if (ext === "ass") return "ass";
  if (ext === "ssa") return "ssa";
  if (ext === "sub") return "sub";
  return "srt";
}

const ISO1_MAP: Record<string, string> = {
  en: "en",
  eng: "en",
  hi: "hi",
  hin: "hi",
  es: "es",
  spa: "es",
  fr: "fr",
  fra: "fr",
  fre: "fr",
  de: "de",
  ger: "de",
  deu: "de",
  it: "it",
  ita: "it",
  pt: "pt",
  por: "pt",
  ru: "ru",
  rus: "ru",
  ar: "ar",
  ara: "ar",
  ja: "ja",
  jpn: "ja",
  ko: "ko",
  kor: "ko",
  zh: "zh",
  chi: "zh",
  zho: "zh",
  cmn: "zh",
  nl: "nl",
  dut: "nl",
  pl: "pl",
  pol: "pl",
  tr: "tr",
  tur: "tr",
  sv: "sv",
  swe: "sv",
  no: "no",
  nor: "no",
  da: "da",
  dan: "da",
  fi: "fi",
  fin: "fi",
  el: "el",
  gre: "el",
  ell: "el",
  he: "he",
  heb: "he",
  th: "th",
  tha: "th",
  vi: "vi",
  vie: "vi",
  id: "id",
  ind: "id",
  ms: "ms",
  may: "ms",
};

function detectSubtitleLanguage(uri: string): string | undefined {
  const name = (uri.split("/").pop() ?? "").split("?")[0];
  const explicit = name.match(/(?:lang|language)[-_]([A-Za-z]{2,3})/i);
  if (explicit) {
    const hit = ISO1_MAP[explicit[1].toLowerCase()];
    if (hit) return hit;
  }
  for (const m of name.matchAll(/[._-]([A-Za-z]{2,3})(?=[._-]|$)/g)) {
    const hit = ISO1_MAP[m[1].toLowerCase()];
    if (hit) return hit;
  }
  return undefined;
}

async function currentNetwork(): Promise<NetworkType> {
  try {
    const s = await NetInfo.fetch();
    if (s.type === "cellular") return "cellular";
    if (s.type === "wifi" || s.type === "ethernet") return "wifi";
    return "none";
  } catch {
    return "wifi";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const STAGE_COPY: Record<SyncStage, string> = {
  connect: "Connecting to the stream…",
  listen: "Listening to the dialogue…",
  analyze: "Matching subtitles…",
  watch: "Listening while you watch…",
};

export function AutoSyncButton({
  sourceInfo,
  contentId,
  subtitleUri,
  subtitleLanguage,
  onSynced,
  startWatch,
  startWatchPosition,
}: Props) {
  const [snap, setSnap] = useState<RunnerState>(runnerState);
  /** P4: a watch-sync apply landed while the fetch scan runs → stop fetching. */
  const watchAppliedRef = useRef(false);

  // Subscribe to the module runner — remounting (sheet reopened) restores
  // live state; unmounting does NOT cancel the run.
  useEffect(() => {
    const l = () => setSnap(runnerState);
    runnerListeners.add(l);
    return () => {
      runnerListeners.delete(l);
    };
  }, []);

  // Watch-first: applied-transition subscription. Session startedAt is
  // bumped by startWatchSession — a value set BEFORE the latest session
  // start is a stale async continuation, never the new session's own
  // baseline; and the live value must MOVE off the start baseline. Together
  // these prevent a fetch-cache-adopted baseline (or a late apply raced
  // against cancel) from falsely rendering the card "Synced" on open.
  useEffect(() => {
    if (snap.status !== "watching" && snap.status !== "scan-offer") return;
    let alive = true;
    const unsub = onWatchProgress(() => {
      if (!alive) return;
      const p = watchSessionProgress();
      if (p.appliedMs != null && p.appliedMs !== watchBaselineAppliedMs) {
        console.log(
          `[SubSync] watch-first: card transition → applied (appliedMs=${p.appliedMs}ms, baseline was ${String(watchBaselineAppliedMs)})`,
        );
        watchBaselineAppliedMs = p.appliedMs;
        if (watchTicker) {
          clearInterval(watchTicker);
          watchTicker = null;
        }
        setRunner({
          status: "applied",
          resultText: null,
          message: null,
          watchedSec: 0,
        });
      }
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [snap.status]);

  // On unmount while running: reassure, don't cancel. (Hard stops — source
  // change, player teardown — are owned by the HevcPlayer-level session.)
  const runningRef = useRef(false);
  useEffect(() => {
    runningRef.current =
      snap.status === "running" || snap.status === "watching";
  });
  useEffect(
    () => () => {
      if (runningRef.current) {
        downloadToast.info(
          "Still syncing — keep watching. It'll apply on its own.",
        );
      }
    },
    [],
  );

  // Connect-stage pulse: a breathing bar reads as active work, not a hang.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (snap.status === "running" && snap.stage === "connect") {
      const a = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 0.35,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ]),
      );
      a.start();
      return () => {
        a.stop();
        pulse.setValue(1);
      };
    }
  }, [snap.status, snap.stage, pulse]);

  const onPress = () => {
    if (snap.status === "running" || snap.status === "watching") {
      cancelRun();
      return;
    }
    // Capture ONCE at tap: everything downstream (watch session, scan
    // anchor) must agree on the same moment — a mid-run seek or the watch
    // session's own re-anchor must not desync the two paths.
    const anchorAtTap = Math.max(0, startWatchPosition?.() ?? 0);
    watchAppliedRef.current = false;
    // Any onSynced call while a run is live means a watch-sync apply landed
    // (the watch path calls the same handler through the shared registry).
    const onSyncedWrapped: Props["onSynced"] = (
      offsetMs,
      confidence,
      rewritten,
    ) => {
      watchAppliedRef.current = true;
      // A watch apply resolves the watch-first flow too.
      if (watchTicker) {
        clearInterval(watchTicker);
        watchTicker = null;
      }
      if (
        runnerState.status === "watching" ||
        runnerState.status === "scan-offer"
      ) {
        setRunner({ status: "applied", resultText: null, message: null });
      }
      onSynced(offsetMs, confidence, rewritten);
    };
    const hooks: RunHooks = {
      sourceInfo,
      contentId,
      subtitleUri,
      subtitleLanguage,
      onSynced: onSyncedWrapped,
      startWatch,
      anchorSec: () => Math.max(0, startWatchPosition?.() ?? 0),
      shouldAbort: () => watchAppliedRef.current,
    };
    if (WATCH_FIRST_TAP) {
      void startWatchFirst(hooks);
    } else {
      void startRun(hooks);
    }
  };

  const running = snap.status === "running";
  const watching = snap.status === "watching";
  const scanOffer = snap.status === "scan-offer";
  const eased = easeProgress(snap.progress);
  const hasSub = !!subtitleUri;

  // Card copy per state — the title is the user's problem, the body is the
  // mechanism/promise, never more than one line each.
  let title: string;
  let titleStyle: TextStyle = styles.title;
  if (running) {
    title = STAGE_COPY[snap.stage];
  } else if (watching) {
    title = "Listening while you watch…";
  } else if (scanOffer) {
    title = "Still out of sync?";
  } else if (snap.status === "applied") {
    title = snap.resultText ?? "Synced";
    titleStyle = styles.titleSuccess;
  } else if (snap.status === "failed") {
    title = "Couldn't sync";
    titleStyle = styles.titleError;
  } else {
    title = hasSub ? "Subtitles out of sync?" : "No subtitle loaded";
  }

  const pillLabel = running
    ? "Cancel"
    : watching
      ? "Stop listening"
      : snap.status === "applied"
        ? "Sync again"
        : snap.status === "failed"
          ? "Try again"
          : scanOffer
            ? "Listen again"
            : "Auto Sync";
  const pillIcon = running
    ? "close-circle"
    : watching
      ? "close-circle"
      : snap.status === "applied"
        ? "checkmark-circle"
        : snap.status === "failed"
          ? "refresh"
          : scanOffer
            ? "sync-outline"
            : "sync-outline";

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={titleStyle} numberOfLines={1}>
          {title}
        </Text>
        {running && snap.stage !== "connect" && (
          <Text style={styles.percent}>{Math.round(eased * 100)}%</Text>
        )}
      </View>

      {running || watching ? (
        <>
          {running && (
            <View style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressBar,
                  {
                    width: `${eased * 100}%`,
                    opacity: snap.stage === "connect" ? pulse : 1,
                  },
                ]}
              />
            </View>
          )}
          {watching && (
            <Text style={styles.watchedLine}>
              {snap.watchedSec > 0
                ? `Heard ${Math.floor(snap.watchedSec / 60)}:${String(snap.watchedSec % 60).padStart(2, "0")} of dialogue so far`
                : "Play the video — I'm listening to the dialogue"}
            </Text>
          )}
          {/* The <1s background promise. */}
          <Text style={styles.cardBody}>
            {watching
              ? "No data used — sync applies the moment it locks on, even if you close this."
              : "Keep watching — sync continues even if you close this. Usually under a minute."}
          </Text>
        </>
      ) : snap.status === "applied" ? (
        <Text style={styles.cardBody}>
          Applied automatically. Slightly off? Use Fine-tune below.
        </Text>
      ) : scanOffer ? (
        <>
          <Text style={styles.cardBody} numberOfLines={2}>
            {snap.message ??
              "Watching didn't lock on yet. Scanning uses some data and takes a couple of minutes."}
          </Text>
          <TouchableOpacity
            style={styles.scanInsteadPill}
            onPress={() => {
              const anchorAtTap = Math.max(0, startWatchPosition?.() ?? 0);
              watchAppliedRef.current = false;
              const wrapped: Props["onSynced"] = (
                offsetMs,
                confidence,
                rewritten,
              ) => {
                watchAppliedRef.current = true;
                onSynced(offsetMs, confidence, rewritten);
              };
              void startRun({
                sourceInfo,
                contentId,
                subtitleUri,
                subtitleLanguage,
                onSynced: wrapped,
                startWatch,
                anchorSec: () => Math.max(0, startWatchPosition?.() ?? 0),
                shouldAbort: () => watchAppliedRef.current,
              });
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Scan the stream to sync subtitles"
          >
            <Ionicons name="download-outline" size={15} color={colors.info} />
            <Text style={styles.scanInsteadText}>Scan the stream instead</Text>
          </TouchableOpacity>
        </>
      ) : snap.status === "failed" ? (
        <Text style={styles.cardBodyError} numberOfLines={2}>
          {snap.message}
        </Text>
      ) : hasSub ? (
        <Text style={styles.cardBody}>
          Auto Sync listens to the video and fixes the timing automatically.
        </Text>
      ) : (
        <Text style={styles.cardBody}>
          Pick a subtitle from the list, or find one online below.
        </Text>
      )}

      <TouchableOpacity
        style={[
          styles.pill,
          (running || watching) && styles.pillCancel,
          !hasSub && !running && !watching && styles.pillDisabled,
        ]}
        onPress={onPress}
        disabled={!hasSub && !running}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={
          running || watching
            ? "Cancel subtitle sync"
            : "Automatically sync subtitles"
        }
      >
        <Ionicons
          name={pillIcon}
          size={17}
          color={
            running || watching
              ? colors.textSecondary
              : snap.status === "applied"
                ? colors.success
                : colors.gold
          }
        />
        <Text
          style={[
            styles.pillText,
            running && { color: colors.textSecondary },
            snap.status === "applied" && { color: colors.success },
          ]}
        >
          {pillLabel}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 10,
    marginHorizontal: 20,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.bgSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    gap: 10,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
    flex: 1,
  },
  titleSuccess: {
    color: colors.success,
    fontSize: 15,
    fontWeight: "700",
    flex: 1,
  },
  titleError: {
    color: colors.error,
    fontSize: 15,
    fontWeight: "700",
    flex: 1,
  },
  percent: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  cardBody: {
    color: colors.textTertiary,
    fontSize: 12.5,
    lineHeight: 17,
  },
  cardBodyError: {
    color: colors.error,
    fontSize: 12.5,
    lineHeight: 17,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.zinc800,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: colors.gold,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(212,162,55,0.45)",
    backgroundColor: "rgba(212,162,55,0.08)",
  },
  pillCancel: {
    borderColor: colors.borderSubtle,
    backgroundColor: "transparent",
  },
  pillDisabled: {
    opacity: 0.4,
  },
  watchedLine: {
    color: colors.info,
    fontSize: 12.5,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  scanInsteadPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(91,156,246,0.4)",
    backgroundColor: "rgba(91,156,246,0.08)",
  },
  scanInsteadText: {
    color: colors.info,
    fontSize: 13.5,
    fontWeight: "700",
  },
  pillText: {
    color: colors.gold,
    fontSize: 14,
    fontWeight: "700",
  },
});
