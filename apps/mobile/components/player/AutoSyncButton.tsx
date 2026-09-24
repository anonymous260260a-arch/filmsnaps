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

type SyncStage = "connect" | "listen" | "analyze";
type RunnerStatus = "idle" | "running" | "applied" | "failed";

type RunnerState = {
  status: RunnerStatus;
  stage: SyncStage;
  /** Raw 0..1 from the engine — the UI applies the perceived-speed easing. */
  progress: number;
  /** Success line (e.g. "Synced +52.49s"). */
  resultText: string | null;
  /** Info / error line. */
  message: string | null;
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
};

let runnerState: RunnerState = INITIAL;
const runnerListeners = new Set<() => void>();
let runToken = 0;
let allowBytesNextAttempt = false;

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

function cancelRun() {
  runToken++; // invalidate any in-flight run's continuations
  if (runnerState.status === "running") {
    cancelAutoSync();
  }
  setRunner({
    status: "idle",
    stage: "connect",
    progress: 0,
    resultText: null,
    message: null,
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

  // On unmount while running: reassure, don't cancel. (Hard stops — source
  // change, player teardown — are owned by the HevcPlayer-level session.)
  const runningRef = useRef(false);
  useEffect(() => {
    runningRef.current = snap.status === "running";
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
    if (snap.status === "running") {
      cancelRun();
      return;
    }
    // Capture ONCE at tap: everything downstream (watch session, scan
    // anchor) must agree on the same moment — a mid-run seek or the watch
    // session's own re-anchor must not desync the two paths.
    const anchorAtTap = Math.max(0, startWatchPosition?.() ?? 0);
    watchAppliedRef.current = false;
    // Any onSynced call while the fetch scan runs means a watch-sync apply
    // landed (the watch path calls the same handler through the shared
    // registry) — the user's scene is synced, so the scan should stop
    // before its next window instead of downloading audio nobody needs.
    const onSyncedWrapped: Props["onSynced"] = (
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
      onSynced: onSyncedWrapped,
      startWatch,
      anchorSec: () => anchorAtTap,
      shouldAbort: () => watchAppliedRef.current,
    });
  };

  const running = snap.status === "running";
  const eased = easeProgress(snap.progress);
  const hasSub = !!subtitleUri;

  // Card copy per state — the title is the user's problem, the body is the
  // mechanism/promise, never more than one line each.
  let title: string;
  let titleStyle: TextStyle = styles.title;
  if (running) {
    title = STAGE_COPY[snap.stage];
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
    : snap.status === "applied"
      ? "Sync again"
      : snap.status === "failed"
        ? "Try again"
        : "Auto Sync";

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

      {running ? (
        <>
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
          {/* The <1s background promise. */}
          <Text style={styles.cardBody}>
            Keep watching — sync continues even if you close this. Usually under
            a minute.
          </Text>
        </>
      ) : snap.status === "applied" ? (
        <Text style={styles.cardBody}>
          Applied automatically. Slightly off? Use Fine-tune below.
        </Text>
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
          running && styles.pillCancel,
          !hasSub && !running && styles.pillDisabled,
        ]}
        onPress={onPress}
        disabled={!hasSub && !running}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={
          running ? "Cancel subtitle sync" : "Automatically sync subtitles"
        }
      >
        <Ionicons
          name={
            running
              ? "close-circle"
              : snap.status === "applied"
                ? "checkmark-circle"
                : snap.status === "failed"
                  ? "refresh"
                  : "sync-outline"
          }
          size={17}
          color={
            running
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
  pillText: {
    color: colors.gold,
    fontSize: 14,
    fontWeight: "700",
  },
});
