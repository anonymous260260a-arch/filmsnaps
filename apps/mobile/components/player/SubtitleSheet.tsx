/**
 * SubtitleSheet — bottom sheet for selecting subtitle tracks.
 * Works with PlayerAdapter interface (not raw expo-video player).
 *
 * UX structure (novice-first; read top-to-bottom as the user's task order):
 *   1. Track list — the primary task is SELECTION. Off / embedded / online.
 *   2. Auto Sync card — the FIX task. Its title states the user's problem;
 *      one line of mechanism; one button. Runs in the background and says so.
 *   3. Fine-tune timing — expert tool, collapsed by default, only shown when
 *      a track is selected (nothing to shift otherwise). Auto-opens when an
 *      auto-sync applies (that's when "nudge" becomes relevant).
 *   4. Find subtitles online — auto-expands when the video has no tracks
 *      (the novice's first need). Skeleton rows while searching.
 * A status chip under the header shows the active sync state at a glance.
 *
 * Business logic (sidecar rewrite stepper, auto-sync apply, watch session,
 * online search/download) is unchanged — this pass is layout, copy, and
 * perceived-speed presentation only.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Animated,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import type { PlayerAdapter } from "./types";
import {
  getSubtitleOffset,
  getAutoSyncPrefs,
  setAutoSyncPrefs,
  setSubtitleOffset as persistSubtitleOffset,
} from "../../lib/subtitlePrefs";
import {
  searchSubtitles,
  downloadSubtitle,
  type OnlineSubtitle,
  type SubtitleSearchQuery,
} from "../../lib/subtitleSearch";
import {
  saveSubtitleChoice,
  clearSubtitleChoice,
} from "../../lib/subtitleCache";
import { AutoSyncButton, type AutoSyncSourceInfo } from "./AutoSyncButton";
import {
  registerWatchApplyHandler,
  startWatchSession,
} from "../../lib/subtitleSync/watchSync";
import { parseSubtitles } from "../../lib/subtitleSync/parseSubtitles";
import {
  ensurePristineSidecar,
  formatFromUri,
  mimeTypeForFormat,
  writeShiftedSubtitleFile,
} from "../../lib/subtitleSync/applySync";

interface SubtitleSheetProps {
  visible: boolean;
  player: PlayerAdapter;
  /** Series identity for persisting the offset (e.g. "tv:12345"). */
  storageKey?: string;
  /** When present, enables the "Load subtitles online" section. */
  onlineSearch?: SubtitleSearchQuery;
  /** When present, enables the Auto Sync card. */
  autoSync?: {
    contentId: string;
    /** Latest stream info, read at press time. */
    sourceInfo: () => AutoSyncSourceInfo;
    /** file:// URI of the auto-attached online subtitle (fallback for sync). */
    getDefaultSubtitleUri?: () => string | null;
  };
  onClose: () => void;
}

const SYNC_STEP_S = 0.5;
/** Online results render in chunks — mounting hundreds of rows at once stalls the JS thread. */
const RESULTS_STEP = 10;

function formatOffset(seconds: number): string {
  if (seconds === 0) return "Off";
  return `${seconds > 0 ? "+" : "−"}${Math.abs(seconds).toFixed(1)}s`;
}

interface TrackRowProps {
  selected: boolean;
  language: string;
  name: string;
  onPress: () => void;
  /** Trailing element (e.g. download spinner for online results). */
  right?: React.ReactNode;
  disabled?: boolean;
  singleLineName?: boolean;
  /** Sidecar track loaded from an external file — cloud icon + ONLINE pill. */
  external?: boolean;
}

function TrackRow({
  selected,
  language,
  name,
  onPress,
  right,
  disabled,
  singleLineName,
  external,
}: TrackRowProps) {
  return (
    <TouchableOpacity
      style={[styles.trackItem, selected && styles.trackItemSelected]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Ionicons
        name={
          selected
            ? "checkmark-circle"
            : external
              ? "cloud-outline"
              : "ellipse-outline"
        }
        size={20}
        color={selected ? colors.gold : colors.textTertiary}
      />
      <View style={styles.trackInfo}>
        <View style={styles.languageRow}>
          <Text
            style={[styles.trackLanguage, selected && styles.trackTextSelected]}
            numberOfLines={1}
          >
            {language}
          </Text>
          {external && (
            <View style={styles.onlinePill}>
              <Text style={styles.onlinePillText}>ONLINE</Text>
            </View>
          )}
        </View>
        <Text
          style={[styles.trackName, selected && styles.trackTextSelected]}
          numberOfLines={singleLineName ? 1 : undefined}
        >
          {name}
        </Text>
      </View>
      {right}
    </TouchableOpacity>
  );
}

/** Skeleton placeholder row — placeholders make search feel faster than a spinner. */
function SearchSkeleton({ anim }: { anim: Animated.Value }) {
  return (
    <View style={styles.trackItem}>
      <Animated.View style={[styles.skelCircle, { opacity: anim }]} />
      <View style={styles.trackInfo}>
        <Animated.View
          style={[styles.skelLine, { width: "32%", opacity: anim }]}
        />
        <Animated.View
          style={[styles.skelLine, { width: "78%", opacity: anim }]}
        />
      </View>
    </View>
  );
}

function SubtitleSheetInner({
  visible,
  player,
  storageKey,
  onlineSearch,
  autoSync,
  onClose,
}: SubtitleSheetProps) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const [trackVersion, setTrackVersion] = useState(0);
  const tracks = React.useMemo(
    () => player.getSubtitleTracks(),
    [player, trackVersion],
  );
  const embeddedTracks = tracks.filter((t) => !t.isExternal);
  const externalTracks = tracks.filter((t) => t.isExternal);
  const [syncSeconds, setSyncSeconds] = useState(0);
  const [autoOffsetMs, setAutoOffsetMs] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedTrackLanguage =
    tracks.find((t) => t.id === selectedId)?.language || undefined;
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [onlineResults, setOnlineResults] = useState<OnlineSubtitle[]>([]);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [visibleResults, setVisibleResults] = useState(RESULTS_STEP);
  const [fineTuneOpen, setFineTuneOpen] = useState(false);
  const externalFileRef = React.useRef<Map<string, string>>(new Map());
  const autoExpandedOnline = useRef(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setTrackVersion((v) => v + 1);
    autoExpandedOnline.current = false;
    if (storageKey) {
      getSubtitleOffset(storageKey)
        .then((v) => {
          if (!cancelled) {
            setSyncSeconds(v);
            // Something to fine-tune already? Open the expert drawer for the
            // user who came back to adjust — stay closed for first-timers.
            if (v !== 0) setFineTuneOpen(true);
          }
        })
        .catch(() => {});
      getAutoSyncPrefs(storageKey)
        .then((p) => {
          if (!cancelled) {
            setAutoOffsetMs(p.autoOffsetMs);
            if (p.autoOffsetMs !== 0) setFineTuneOpen(true);
          }
        })
        .catch(() => {});
    } else {
      setSyncSeconds(0);
      setAutoOffsetMs(0);
      setFineTuneOpen(false);
    }
    setSelectedId(player.getSelectedSubtitleTrackId?.() ?? null);
    setSyncError(null);

    // Novice path: video has no subtitle tracks at all → the online section
    // IS the task. Open it (and search) instead of making the user discover
    // a collapsed header that says nothing to them.
    const current = player.getSubtitleTracks();
    if (onlineSearch && current.length === 0 && !autoExpandedOnline.current) {
      autoExpandedOnline.current = true;
      setOnlineOpen(true);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, storageKey]);

  // Skeleton shimmer while searching.
  const shimmer = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    if (!searching) return;
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 0.9,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0.4,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    );
    a.start();
    return () => a.stop();
  }, [searching, shimmer]);

  const runSearch = async () => {
    if (!onlineSearch) return;
    setSearching(true);
    setOnlineError(null);
    try {
      const results = await searchSubtitles(onlineSearch);
      setOnlineResults(results);
      setVisibleResults(RESULTS_STEP);
      if (results.length === 0)
        setOnlineError("No subtitles found for this title.");
    } catch {
      setOnlineError("Subtitles are unavailable right now.");
      setOnlineResults([]);
    } finally {
      setSearching(false);
    }
  };

  // Auto-open triggers the search directly (the toggle handler is for taps).
  useEffect(() => {
    if (
      visible &&
      onlineOpen &&
      onlineResults.length === 0 &&
      !searching &&
      onlineSearch &&
      autoExpandedOnline.current
    ) {
      void runSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, onlineOpen]);

  const openOnlineSection = () => {
    const next = !onlineOpen;
    setOnlineOpen(next);
    if (next && onlineResults.length === 0 && !searching && onlineSearch) {
      runSearch();
    }
  };

  const selectTrack = (trackId: string) => {
    player.setSubtitleTrack(trackId);
    setSelectedId(trackId === "off" ? null : trackId);
    if (trackId === "off" && onlineSearch) {
      clearSubtitleChoice(onlineSearch);
    }
  };

  const pickOnline = async (sub: OnlineSubtitle) => {
    if (addingId) return;
    setAddingId(sub.id);
    setOnlineError(null);
    try {
      const cacheKey = `${onlineSearch?.tmdbId ?? "x"}-${sub.language}-${sub.releaseName}`;
      const downloaded = await downloadSubtitle(sub, cacheKey);
      const trackId = await player.addExternalSubtitle?.(
        downloaded.uri,
        downloaded.mimeType,
        downloaded.language,
        downloaded.label,
      );
      if (trackId) {
        externalFileRef.current.set(trackId, downloaded.uri);
        setSelectedId(trackId);
        if (onlineSearch) {
          saveSubtitleChoice(onlineSearch, {
            uri: downloaded.uri,
            mimeType: downloaded.mimeType,
            language: downloaded.language,
            label: downloaded.label,
          });
        }
        onClose();
      } else {
        setOnlineError("Downloaded, but the player didn't accept this file.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Sidecar subtitles unsupported")) {
        setOnlineError(
          "Needs an app rebuild (native sidecar support missing).",
        );
      } else if (msg === "DOWNLOAD_EMPTY" || msg === "DOWNLOAD_NOT_SUBTITLE") {
        setOnlineError("That file didn't arrive as a subtitle — try another.");
      } else {
        setOnlineError(`Download failed — ${msg.slice(0, 80)}`);
      }
    } finally {
      setAddingId(null);
    }
  };

  const syncSecondsRef = useRef(0);
  const sidecarRewriteTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [syncError, setSyncError] = useState<string | null>(null);
  const sidecarOpChain = useRef<Promise<unknown>>(Promise.resolve());

  const bumpSync = (delta: number) => {
    applySync(syncSecondsRef.current + delta);
  };

  const enqueueSidecarOp = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = sidecarOpChain.current.then(fn, fn);
    sidecarOpChain.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const sidecarTarget = (): string | null =>
    (selectedId ? externalFileRef.current.get(selectedId) : undefined) ??
    autoSync?.getDefaultSubtitleUri?.() ??
    null;

  const describeSidecar = (uri: string) => ({
    uri,
    mimeType: mimeTypeForFormat(formatFromUri(uri)),
    language: selectedTrackLanguage,
    label: uri.split("/").pop(),
  });

  const readdSidecar = async (
    next: { uri: string; mimeType: string; language?: string; label?: string },
    prev: {
      uri: string;
      mimeType: string;
      language?: string;
      label?: string;
    } | null,
    context: string,
  ): Promise<string | null> => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await sleep(250);
      try {
        player.clearExternalSubtitles?.();
        const trackId = await player.addExternalSubtitle?.(
          next.uri,
          next.mimeType,
          next.language,
          next.label,
        );
        if (trackId) {
          if (attempt > 1) {
            console.log(
              `[SubSync] ${context}: re-add ok on attempt ${attempt}/3 (track ${trackId})`,
            );
          }
          externalFileRef.current.set(trackId, next.uri);
          player.setSubtitleTrack?.(trackId);
          setSelectedId(trackId);
          setTrackVersion((v) => v + 1);
          setSyncError(null);
          return trackId;
        }
        console.log(
          `[SubSync] ${context}: re-add attempt ${attempt}/3 returned no track id`,
        );
      } catch (e) {
        console.log(
          `[SubSync] ${context}: re-add attempt ${attempt}/3 failed: ${(e as Error)?.message ?? e}`,
        );
      }
    }
    if (prev) {
      try {
        player.clearExternalSubtitles?.();
        const prevId = await player.addExternalSubtitle?.(
          prev.uri,
          prev.mimeType,
          prev.language,
          prev.label,
        );
        if (prevId) {
          externalFileRef.current.set(prevId, prev.uri);
          player.setSubtitleTrack?.(prevId);
          setSelectedId(prevId);
          setTrackVersion((v) => v + 1);
          console.log(
            `[SubSync] ${context}: rolled back to previous sidecar (track ${prevId}): ${prev.uri}`,
          );
        } else {
          console.log(
            `[SubSync] ${context}: rollback also failed - no track id`,
          );
        }
      } catch (e) {
        console.log(
          `[SubSync] ${context}: rollback failed: ${(e as Error)?.message ?? e}`,
        );
      }
    }
    setSyncError("Couldn't adjust — try again");
    return null;
  };

  const rewriteSidecarForOffset = async () => {
    const target = sidecarTarget();
    if (!target) return;
    const pristine = await ensurePristineSidecar(target);
    if (!pristine) {
      console.log(
        "[SubSync] stepper: no pristine sidecar available - falling back to the native offset",
      );
      player.setSubtitleOffset?.(autoOffsetMs + syncSecondsRef.current * 1000);
      return;
    }
    const format = formatFromUri(target);
    const cues = parseSubtitles(pristine.text, format);
    const totalSec = (autoOffsetMs + syncSecondsRef.current * 1000) / 1000;
    if (cues.length === 0) return;
    const uri = await writeShiftedSubtitleFile(
      cues,
      totalSec,
      format,
      pristine.uri,
    );
    if (!uri) return;
    console.log(
      `[SubSync] stepper: rewriting sidecar total=${totalSec.toFixed(2)}s ` +
        `(auto=${autoOffsetMs}ms manual=${syncSecondsRef.current}s) from ${target} -> ${uri}`,
    );
    try {
      await enqueueSidecarOp(() =>
        readdSidecar(
          {
            uri,
            mimeType: mimeTypeForFormat(format),
            language: selectedTrackLanguage,
            label: uri.split("/").pop(),
          },
          describeSidecar(target),
          "stepper",
        ),
      );
      console.log(
        `[SubSync] stepper applied ${totalSec.toFixed(2)}s to the sidecar file: ${uri}`,
      );
    } catch (e) {
      console.log(
        `[SubSync] stepper re-add failed: ${(e as Error)?.message ?? e}`,
      );
      setSyncError("Couldn't adjust — try again");
    }
  };

  const applySync = (next: number) => {
    setSyncSeconds(next);
    syncSecondsRef.current = next;
    if (storageKey) persistSubtitleOffset(storageKey, next);
    if (sidecarTarget()) {
      if (sidecarRewriteTimer.current)
        clearTimeout(sidecarRewriteTimer.current);
      sidecarRewriteTimer.current = setTimeout(() => {
        void rewriteSidecarForOffset();
      }, 600);
      return;
    }
    player.setSubtitleOffset?.(autoOffsetMs + next * 1000);
  };

  const handleAutoSynced = async (
    offsetMs: number,
    _confidence: number,
    rewritten?: {
      uri: string;
      mimeType: string;
      language?: string;
      label?: string;
    },
    _kind?: "first" | "refine",
  ) => {
    setAutoOffsetMs(offsetMs);
    // An apply just happened — "nudge" is now the relevant follow-up, so
    // surface the fine-tune drawer at exactly that moment.
    setFineTuneOpen(true);
    if (rewritten) {
      const prevTarget = sidecarTarget();
      try {
        const trackId = await enqueueSidecarOp(() =>
          readdSidecar(
            rewritten,
            prevTarget ? describeSidecar(prevTarget) : null,
            "auto-sync",
          ),
        );
        if (trackId) {
          console.log(
            `[SubSync] applied shifted subtitle (track ${trackId}): ${rewritten.uri}`,
          );
          if (onlineSearch) {
            saveSubtitleChoice(onlineSearch, {
              uri: rewritten.uri,
              mimeType: rewritten.mimeType,
              language: rewritten.language ?? selectedTrackLanguage ?? "",
              label: rewritten.label ?? "",
            });
          }
        } else {
          console.log("[SubSync] re-add returned no track id");
        }
      } catch (e) {
        console.log(
          `[SubSync] re-add shifted subtitle failed: ${(e as Error)?.message ?? e}`,
        );
        setSyncError("Couldn't adjust — try again");
      }
    } else {
      player.setSubtitleOffset?.(offsetMs + syncSeconds * 1000);
    }
    if (storageKey) {
      setAutoSyncPrefs(storageKey, { autoOffsetMs: offsetMs, autoScale: 1 });
    }
  };

  useEffect(() => {
    if (!autoSync) return;
    const unreg = registerWatchApplyHandler(handleAutoSynced);
    return unreg;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSync, storageKey, selectedTrackLanguage, onlineSearch]);

  const syncSupported = typeof player.setSubtitleOffset === "function";

  const autoSyncSubtitleUri =
    (selectedId ? externalFileRef.current.get(selectedId) : undefined) ??
    autoSync?.getDefaultSubtitleUri?.() ??
    null;

  const startWatchSessionFromTap = async (): Promise<boolean> => {
    if (!autoSync) return false;
    const subUri =
      autoSyncSubtitleUri ?? autoSync.getDefaultSubtitleUri?.() ?? null;
    return startWatchSession({
      contentId: autoSync.contentId,
      subtitleCacheKey: autoSync.contentId,
      fromSec: Math.max(0, player.getCurrentTime()),
      durationSec: player.getDuration(),
      getSubtitleUri: () => subUri,
      getPosition: () => player.getCurrentTime(),
    });
  };

  // One-glance state under the header: what's applied right now.
  const syncChip = (() => {
    if (selectedId === null) return null;
    const parts: string[] = [];
    if (autoOffsetMs !== 0)
      parts.push(
        `auto ${autoOffsetMs > 0 ? "+" : "−"}${Math.abs(autoOffsetMs / 1000).toFixed(1)}s`,
      );
    if (syncSeconds !== 0) parts.push(`manual ${formatOffset(syncSeconds)}`);
    return parts.length ? `Sync: ${parts.join(" · ")}` : null;
  })();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          style={[styles.sheet, isLandscape && styles.sheetLandscape]}
          activeOpacity={1}
          onPress={() => {}}
        >
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.headerTitle}>Subtitles</Text>
              {syncChip && <Text style={styles.headerChip}>{syncChip}</Text>}
            </View>
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {/* 1. SELECTION — the primary task, first on screen. */}
            <TrackRow
              selected={selectedId === null}
              language="Off"
              name="Disable subtitles"
              onPress={() => selectTrack("off")}
            />

            {embeddedTracks.map((item) => (
              <TrackRow
                key={item.id}
                selected={selectedId === item.id}
                language={item.language || "Unknown"}
                name={item.label}
                onPress={() => selectTrack(item.id)}
              />
            ))}

            {externalTracks.length > 0 && (
              <>
                <View style={styles.separator} />
                <Text style={styles.sectionLabel}>LOADED FROM ONLINE</Text>
                {externalTracks.map((item) => (
                  <TrackRow
                    key={item.id}
                    selected={selectedId === item.id}
                    language={item.language || "Unknown"}
                    name={item.label}
                    external
                    onPress={() => selectTrack(item.id)}
                  />
                ))}
              </>
            )}

            {/* 2. FIX — the Auto Sync card states the problem, the mechanism,
                and the keep-watching promise in one glance. */}
            {syncSupported && autoSync && (
              <>
                <View style={styles.separator} />
                <AutoSyncButton
                  sourceInfo={autoSync.sourceInfo}
                  contentId={autoSync.contentId}
                  subtitleUri={autoSyncSubtitleUri}
                  subtitleLanguage={selectedTrackLanguage}
                  onSynced={handleAutoSynced}
                  startWatch={startWatchSessionFromTap}
                  startWatchPosition={() =>
                    Math.max(0, player.getCurrentTime())
                  }
                />
              </>
            )}

            {/* 3. FINE-TUNE — expert tool, hidden until relevant. */}
            {syncSupported && selectedId !== null && (
              <>
                <TouchableOpacity
                  style={styles.fineTuneHeader}
                  onPress={() => setFineTuneOpen((o) => !o)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Fine-tune subtitle timing"
                >
                  <Ionicons
                    name="options-outline"
                    size={15}
                    color={colors.textTertiary}
                  />
                  <Text style={styles.fineTuneHeaderText}>
                    Fine-tune timing
                  </Text>
                  <Ionicons
                    name={fineTuneOpen ? "chevron-up" : "chevron-down"}
                    size={14}
                    color={colors.textTertiary}
                  />
                </TouchableOpacity>
                {fineTuneOpen && (
                  <View>
                    <Text style={styles.fineTuneHint}>
                      Only if it's slightly off — nudge by ½ second. Saved for
                      this series.
                    </Text>
                    <View style={styles.syncRow}>
                      <TouchableOpacity
                        style={styles.syncBtn}
                        onPress={() => bumpSync(-SYNC_STEP_S)}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel="Subtitles 0.5 seconds earlier"
                      >
                        <Ionicons
                          name="remove"
                          size={18}
                          color={colors.textPrimary}
                        />
                      </TouchableOpacity>
                      <Text style={styles.syncValue}>
                        {formatOffset(syncSeconds)}
                      </Text>
                      <TouchableOpacity
                        style={styles.syncBtn}
                        onPress={() => bumpSync(SYNC_STEP_S)}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel="Subtitles 0.5 seconds later"
                      >
                        <Ionicons
                          name="add"
                          size={18}
                          color={colors.textPrimary}
                        />
                      </TouchableOpacity>
                      {syncSeconds !== 0 && (
                        <TouchableOpacity
                          style={styles.syncReset}
                          onPress={() => applySync(0)}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel="Reset subtitle sync"
                        >
                          <Ionicons
                            name="refresh"
                            size={16}
                            color={colors.textSecondary}
                          />
                        </TouchableOpacity>
                      )}
                    </View>
                    {syncError && (
                      <Text style={styles.syncError}>{syncError}</Text>
                    )}
                  </View>
                )}
              </>
            )}

            {/* 4. FIND — online search; auto-opened when there's nothing else. */}
            {onlineSearch && (
              <>
                <View style={styles.separator} />
                <TouchableOpacity
                  style={styles.onlineHeader}
                  onPress={openOnlineSection}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Load subtitles online"
                >
                  <Ionicons
                    name={
                      onlineOpen
                        ? "remove-circle-outline"
                        : "add-circle-outline"
                    }
                    size={18}
                    color={colors.gold}
                  />
                  <Text style={styles.onlineHeaderText}>
                    Find subtitles online
                  </Text>
                  <Ionicons
                    name={onlineOpen ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.textTertiary}
                  />
                </TouchableOpacity>
                {embeddedTracks.length === 0 &&
                  externalTracks.length === 0 &&
                  !onlineOpen && (
                    <Text style={styles.onlineHint}>
                      This video has no built-in subtitles — search online.
                    </Text>
                  )}

                {onlineOpen && (
                  <View style={styles.onlineBody}>
                    {searching && (
                      <>
                        <Text style={styles.onlineStatusText}>
                          Searching subtitle sites…
                        </Text>
                        <SearchSkeleton anim={shimmer} />
                        <SearchSkeleton anim={shimmer} />
                        <SearchSkeleton anim={shimmer} />
                        <SearchSkeleton anim={shimmer} />
                      </>
                    )}

                    {!searching && onlineError && (
                      <Text style={styles.onlineError}>{onlineError}</Text>
                    )}

                    {!searching &&
                      onlineResults
                        .slice(0, visibleResults)
                        .map((item) => (
                          <TrackRow
                            key={item.id}
                            selected={selectedId === item.id}
                            language={`${item.language}${item.hi ? " · CC" : ""}`}
                            name={item.releaseName}
                            singleLineName
                            disabled={!!addingId}
                            right={
                              addingId === item.id ? (
                                <ActivityIndicator
                                  size="small"
                                  color={colors.gold}
                                />
                              ) : (
                                <Ionicons
                                  name="cloud-download-outline"
                                  size={18}
                                  color={colors.textTertiary}
                                />
                              )
                            }
                            onPress={() => pickOnline(item)}
                          />
                        ))}

                    {!searching && onlineResults.length > visibleResults && (
                      <TouchableOpacity
                        style={styles.showMoreBtn}
                        onPress={() =>
                          setVisibleResults((v) => v + RESULTS_STEP)
                        }
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel="Show more subtitle results"
                      >
                        <Text style={styles.showMoreText}>
                          Show{" "}
                          {Math.min(
                            RESULTS_STEP,
                            onlineResults.length - visibleResults,
                          )}{" "}
                          more ({onlineResults.length - visibleResults} hidden)
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </>
            )}

            {embeddedTracks.length === 0 &&
              externalTracks.length === 0 &&
              !onlineSearch && (
                <View style={styles.emptyState}>
                  <Ionicons name="text" size={48} color={colors.emptyIcon} />
                  <Text style={styles.emptyText}>
                    No subtitles in this video
                  </Text>
                </View>
              )}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "70%",
    overflow: "hidden",
  },
  sheetLandscape: {
    width: 440,
    alignSelf: "center",
    maxHeight: "92%",
    marginBottom: 12,
    borderRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.zinc800,
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
  },
  headerChip: {
    color: colors.textTertiary,
    fontSize: 11.5,
    marginTop: 2,
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    paddingBottom: 32,
  },
  trackItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginHorizontal: 8,
    borderRadius: 10,
  },
  trackItemSelected: {
    backgroundColor: colors.bgSubtle,
  },
  trackInfo: {
    flex: 1,
  },
  languageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  onlinePill: {
    backgroundColor: "rgba(212,162,55,0.15)",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  onlinePillText: {
    color: colors.gold,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 2,
  },
  trackLanguage: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
  trackName: {
    color: colors.textTertiary,
    fontSize: 13,
    marginTop: 1,
  },
  trackTextSelected: {
    color: colors.gold,
  },
  skelCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.skeletonBg,
  },
  skelLine: {
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.skeletonBg,
  },
  fineTuneHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  fineTuneHeaderText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  fineTuneHint: {
    color: colors.textTertiary,
    fontSize: 11.5,
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  syncRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 10,
  },
  syncBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgSubtle,
  },
  syncValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    minWidth: 44,
    textAlign: "center",
  },
  syncReset: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  syncError: {
    color: colors.error,
    fontSize: 12,
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  separator: {
    height: 1,
    backgroundColor: colors.zinc800,
    marginVertical: 4,
    marginHorizontal: 20,
  },
  onlineHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  onlineHeaderText: {
    flex: 1,
    color: colors.gold,
    fontSize: 14,
    fontWeight: "600",
  },
  onlineHint: {
    color: colors.textTertiary,
    fontSize: 12,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  onlineBody: {
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  onlineStatusText: {
    color: colors.textTertiary,
    fontSize: 13,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 2,
  },
  onlineError: {
    color: colors.textTertiary,
    fontSize: 13,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  showMoreBtn: {
    alignItems: "center",
    paddingVertical: 10,
    marginHorizontal: 8,
    marginTop: 2,
    marginBottom: 4,
    borderRadius: 10,
    backgroundColor: colors.bgSubtle,
  },
  showMoreText: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: "600",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 36,
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 14,
    marginTop: 10,
  },
});

export const SubtitleSheet = React.memo(SubtitleSheetInner);
