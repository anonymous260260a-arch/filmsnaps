/**
 * AutoSyncButton â€” triggers automatic subtitle synchronization.
 *
 * Runs lib/subtitleSync/autoSync against the currently playing stream and
 * the selected external subtitle file. States:
 *   idle â†’ extracting (progress) â†’ analyzing â†’ applied | failed
 *
 * [SubSync] logs trace the whole pipeline so device logs show what happened.
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
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

/** User-facing copy for gate reasons reported by autoSync. */
const GATE_REASONS: Record<string, string> = {
  hls: "Auto sync isn't available for this HLS stream.",
  live: "Live streams can't be auto-synced.",
  dash: "DASH streams aren't supported for auto sync yet.",
  "mkv-ios":
    "MKV/WebM auto sync isn't supported on iPhone â€” try the downloaded file.",
  drm: "This stream is DRM-protected â€” auto sync isn't possible.",
  "probe-fail":
    "Couldn't inspect the stream URL for auto sync. Try again, or use the downloaded file.",
};

type Props = {
  /** Latest stream info, read at press time (avoids stale closures). */
  sourceInfo: () => AutoSyncSourceInfo;
  /** Stable identity for caching (series/release level — never the URL). */
  contentId: string;
  /** file:// URI of the selected external subtitle — null = nothing to sync. */
  subtitleUri: string | null;
  /** Language of the selected subtitle (from the sheet track list). */
  subtitleLanguage?: string;
  /** Called with the resulting offset in ms when sync succeeds. */
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
  /**
   * Tap-only watch-sync activation (reviewer directive). Invoked on Auto Sync
   * press and on the cellular "Watch-sync instead" path — never auto-started
   * from playback. Returns true when a session was (re)started.
   */
  startWatch?: () => boolean | Promise<boolean>;
};

type State = "idle" | "extracting" | "analyzing" | "applied" | "failed";

function detectFormat(uri: string): SubFormat {
  const ext = uri.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  if (ext === "vtt") return "vtt";
  if (ext === "ass") return "ass";
  if (ext === "ssa") return "ssa";
  if (ext === "sub") return "sub";
  return "srt";
}

/**
 * Best-effort 2-letter language from the subtitle filename, e.g.
 * "95350-EN-Lanterns_S01E01_eng.srt" -> "en", "...-rovers.srt" -> undefined.
 * Matches the ISO-639-1/2 codes the audio tracks report.
 */
/** ISO-639 codes -> the 2-letter code audio tracks report. Only KNOWN codes count,
 *  so scene tags like "WEB-DL"/"AMZN"/"REPACK" are never mistaken for a language. */
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

/**
 * Best-effort language from the subtitle filename (fallback when the sheet
 * does not know it). Handles "-EN-", "_eng.srt", "..._lang_en.srt", ".en.srt".
 */
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

export function AutoSyncButton({
  sourceInfo,
  contentId,
  subtitleUri,
  subtitleLanguage,
  onSynced,
  startWatch,
}: Props) {
  const [state, setState] = useState<State>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);
  /** G3: one-shot flag — set when the user accepts the cellular byte dialog. */
  const allowConfirmBytesRef = useRef(false);

  const beginWatchSession = useCallback(async () => {
    if (!startWatch) return false;
    try {
      const ok = await startWatch();
      if (ok) {
        console.log("[SubSync] watch: session started from Auto Sync tap");
      }
      return ok;
    } catch (e: any) {
      console.log(`[SubSync] watch: start failed: ${e?.message ?? e}`);
      return false;
    }
  }, [startWatch]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelAutoSync();
    };
  }, []);

  const run = useCallback(async () => {
    if (state === "extracting" || state === "analyzing") {
      console.log("[SubSync] cancel requested by user");
      cancelAutoSync();
      if (mounted.current) {
        setState("idle");
        setMessage(null);
      }
      return;
    }

    // Tap-only activation: opening Auto Sync arms the live watch session
    // (production default). The fetch scan below still runs for its own path.
    await beginWatchSession();

    if (!subtitleUri) {
      setState("failed");
      setMessage("Load a subtitle (online) first — sync needs a file.");
      return;
    }

    const info = sourceInfo();
    // DASH stays out of scope; HLS (.m3u8) is now supported (probed in canAutoSync).
    if (isHlsOrDash(info.uri) && /\.mpd($|\?)/i.test(info.uri)) {
      setState("failed");
      setMessage("Auto sync doesn't support DASH streams yet.");
      console.log("[SubSync] gated: DASH stream");
      return;
    }

    setState("extracting");
    setProgress(0);
    setMessage(null);
    const t0 = Date.now();
    const kind: SourceKind = detectKind(info.uri);
    console.log(
      `[SubSync] start: contentId=${contentId} kind=${kind} container=${info.container} ` +
        `dur=${info.durationSec.toFixed(0)}s sub=${subtitleUri.split("/").pop()}`,
    );

    try {
      const subText = await new File(subtitleUri).text();
      const format = detectFormat(subtitleUri);
      const network = await currentNetwork();
      console.log(`[SubSync] subtitle ${format}, network=${network}`);

      const source: SourceRef = {
        contentId,
        kind,
        container: info.container,
        resolve: async () => {
          // Latest values â€” a link switch mid-run resolves to the new URL.
          const latest = sourceInfo();
          return { uri: latest.uri, headers: latest.headers };
        },
      };

      const outcome: SyncOutcome = await autoSync({
        source,
        durationSec: info.durationSec,
        subtitleText: subText,
        subtitleFormat: format,
        subtitleCacheKey: subtitleUri.split("/").pop() ?? "sub",
        subtitleUri,
        subtitleLanguage:
          subtitleLanguage ?? detectSubtitleLanguage(subtitleUri),
        network,
        platform: Platform.OS === "ios" ? "ios" : "android",
        allowConfirmBytes: allowConfirmBytesRef.current,
        onProgress: (p, stage) => {
          if (!mounted.current) return;
          setProgress(p);
          if (stage === "analyze") setState("analyzing");
        },
      });

      if (!mounted.current) return;
      console.log(
        `[SubSync] outcome: ${JSON.stringify(outcome)} in ${Date.now() - t0}ms`,
      );

      switch (outcome.type) {
        case "offset":
          setState("applied");
          setMessage(
            outcome.notice ??
              `Synced ${outcome.offsetMs > 0 ? "+" : "−"}${Math.abs(outcome.offsetMs / 1000).toFixed(2)}s` +
                (outcome.confidence < 0.6 ? " — low confidence, verify" : ""),
          );
          // I-2: fetch-path correction (notice present) also surfaces as a toast
          // so the outcome is visible after the sheet closes. First-apply and
          // plain offsets stay on the button (sheet is open during fetch).
          if (outcome.notice) {
            downloadToast.info(outcome.notice);
          }
          onSynced(outcome.offsetMs, outcome.confidence, outcome.rewritten);
          break;
        case "rewritten":
          setState("applied");
          setMessage("Subtitle file rewritten (drift corrected).");
          break;
        case "kept":
          setState("failed");
          setMessage("Couldn't improve on the existing sync — keeping it");
          break;
        case "failed":
          setState("failed");
          setMessage(GATE_REASONS[outcome.reason] ?? outcome.reason);
          break;
        case "cancelled":
          setState("idle");
          setMessage(null);
          break;
        case "confirm-bybytes": {
          // G3: dialog is Continue/Cancel — never default-deny.
          // Stage D adds a third path: skip the fetch scan entirely and let
          // the live watch-sync session (already running on the playback PCM
          // tap) produce the offset without pulling extra bytes.
          setState("idle");
          setMessage(null);
          const mb = outcome.projectedMb;
          const rerun = () => {
            allowConfirmBytesRef.current = true;
            void run();
          };
          Alert.alert(
            "Large download on cellular",
            `Auto sync needs about ${mb} MB of mobile data for this scan. Continue?`,
            [
              { text: "Cancel", style: "cancel" },
              { text: "Continue", onPress: rerun },
              {
                text: "Watch-sync instead (no extra data)",
                onPress: () => {
                  console.log(
                    "[SubSync] cellular: user chose watch-sync piggyback (skip fetch scan)",
                  );
                  void beginWatchSession();
                  if (mounted.current) {
                    setState("idle");
                    setMessage(
                      "Skipped download — watch-sync will apply an offset from live playback.",
                    );
                  }
                },
              },
            ],
            { cancelable: true },
          );
          break;
        }
      }
    } catch (e: any) {
      console.log(`[SubSync] error: ${e?.message ?? e}`);
      if (mounted.current) {
        setState("failed");
        setMessage(e?.message ?? "unknown error");
      }
    } finally {
      // One-shot: a confirmed cellular run must not silently re-authorize
      // the next attempt (user is asked again if the next window is large).
      allowConfirmBytesRef.current = false;
    }
  }, [state, subtitleUri, sourceInfo, contentId, onSynced, beginWatchSession]);

  const iconName =
    state === "idle"
      ? "sync-outline"
      : state === "extracting"
        ? "close-circle"
        : state === "analyzing"
          ? "hourglass-outline"
          : state === "applied"
            ? "checkmark-circle"
            : "alert-circle";

  const iconColor =
    state === "applied"
      ? "#2ecc71"
      : state === "failed"
        ? colors.error
        : state === "extracting"
          ? colors.gold
          : colors.textSecondary;

  const busy = state === "extracting" || state === "analyzing";

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.button, busy && styles.buttonActive]}
        onPress={run}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Automatically sync subtitles"
      >
        <Ionicons name={iconName as any} size={18} color={iconColor} />
        <Text style={[styles.buttonText, { color: iconColor }]}>
          {state === "idle"
            ? "Auto Sync"
            : state === "extracting"
              ? `Listeningâ€¦ ${(progress * 100).toFixed(0)}%`
              : state === "analyzing"
                ? "Analyzingâ€¦"
                : state === "applied"
                  ? "Synced"
                  : "Failed"}
        </Text>
      </TouchableOpacity>

      {busy && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressBar, { width: `${progress * 100}%` }]} />
        </View>
      )}

      {message && !busy && (
        <Text
          style={[
            styles.message,
            state === "applied" && styles.messageSuccess,
            state === "failed" && styles.messageError,
          ]}
        >
          {message}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 10,
    marginHorizontal: 20,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: colors.bgSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  buttonActive: {
    borderColor: colors.gold,
    backgroundColor: "rgba(212,162,55,0.08)",
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  progressTrack: {
    marginTop: 6,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.bgElevated,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    backgroundColor: colors.gold,
    borderRadius: 2,
  },
  message: {
    marginTop: 6,
    fontSize: 12,
    color: colors.textSecondary,
  },
  messageSuccess: {
    color: "#2ecc71",
  },
  messageError: {
    color: colors.error,
  },
});
