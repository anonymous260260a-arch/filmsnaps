/**
 * SubtitleSheet — bottom sheet for selecting subtitle tracks.
 * Works with PlayerAdapter interface (not raw expo-video player).
 *
 * Also carries the subtitle sync stepper: shifts embedded-subtitle
 * timestamps natively (vendored extractor) and persists the value
 * per series (lib/subtitlePrefs) so users dial it once per show.
 *
 * The "Load subtitles online" section searches through the web app's
 * /api/subtitles proxy (Subdl → Wyzie chain, keys stay server-side) and
 * hands the downloaded file to the player as a sidecar track. Embedded
 * tracks are always listed first — online ones are the fallback.
 *
 * Layout: one ScrollView holds everything below the header so the sheet
 * always scrolls (embedded tracks + online results together), with the
 * selected track marked by a checkmark. Landscape opens it as a centered
 * card instead of a full-width bottom sheet.
 */

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import type { PlayerAdapter } from "./types";
import {
  getSubtitleOffset,
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

interface SubtitleSheetProps {
  visible: boolean;
  player: PlayerAdapter;
  /** Series identity for persisting the offset (e.g. "tv:12345"). */
  storageKey?: string;
  /** When present, enables the "Load subtitles online" section. */
  onlineSearch?: SubtitleSearchQuery;
  onClose: () => void;
}

const SYNC_STEP_S = 0.5;
/** Online results render in chunks — mounting hundreds of rows at once stalls the JS thread. */
const RESULTS_STEP = 10;

// ── [SubPerf] open-latency instrumentation ──
let sheetRequestedAt = 0;

/** Called by PlayerOverlay when the user taps the CC button. */
export function markSubtitleSheetRequested(): void {
  sheetRequestedAt = Date.now();
  console.log("[SubPerf] sheet open requested");
}

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

function SubtitleSheetInner({
  visible,
  player,
  storageKey,
  onlineSearch,
  onClose,
}: SubtitleSheetProps) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  // Track list is a native read — refresh it on open, not on every render
  // (the parent overlay would otherwise re-run this at time-update rate).
  const [trackVersion, setTrackVersion] = useState(0);
  const tracks = React.useMemo(
    () => player.getSubtitleTracks(),
    [player, trackVersion],
  );
  const embeddedTracks = tracks.filter((t) => !t.isExternal);
  const externalTracks = tracks.filter((t) => t.isExternal);
  const [syncSeconds, setSyncSeconds] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [onlineResults, setOnlineResults] = useState<OnlineSubtitle[]>([]);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [visibleResults, setVisibleResults] = useState(RESULTS_STEP);

  // Re-read the persisted offset + current selection each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    if (sheetRequestedAt) {
      console.log(
        `[SubPerf] sheet visible ${Date.now() - sheetRequestedAt}ms after click`,
      );
      sheetRequestedAt = 0;
    }
    let cancelled = false;
    setTrackVersion((v) => v + 1);
    if (storageKey) {
      getSubtitleOffset(storageKey)
        .then((v) => {
          if (!cancelled) setSyncSeconds(v);
        })
        .catch(() => {});
    } else {
      setSyncSeconds(0);
    }
    setSelectedId(player.getSelectedSubtitleTrackId?.() ?? null);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, storageKey]);

  const runSearch = async () => {
    if (!onlineSearch) return;
    setSearching(true);
    setOnlineError(null);
    try {
      const t0 = Date.now();
      const results = await searchSubtitles(onlineSearch);
      console.log(
        `[SubPerf] search took ${Date.now() - t0}ms, ${results.length} results`,
      );
      setOnlineResults(results);
      setVisibleResults(RESULTS_STEP);
      if (results.length === 0)
        setOnlineError("No subtitles found for this title.");
    } catch {
      // Subdl/Wyzie problems are handled server-side (our API proxy holds the
      // keys) — from here they just look unavailable.
      setOnlineError("Subtitles are unavailable right now.");
      setOnlineResults([]);
    } finally {
      setSearching(false);
    }
  };

  const openOnlineSection = () => {
    const next = !onlineOpen;
    setOnlineOpen(next);
    if (next && onlineResults.length === 0 && !searching && onlineSearch) {
      runSearch();
    }
  };

  /** Selections keep the sheet open — the checkmark is the feedback. */
  const selectTrack = (trackId: string) => {
    player.setSubtitleTrack(trackId);
    setSelectedId(trackId === "off" ? null : trackId);
    // Explicit "Off" overrides a cached online-subtitle choice for this title.
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
        console.log(`[SubtitleSheet] sidecar selected: ${trackId}`);
        setSelectedId(trackId);
        // Remember the choice — auto-attached next time this title plays.
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
      console.log(`[SubtitleSheet] online subtitle failed: ${msg}`);
      if (msg.includes("Sidecar subtitles unsupported")) {
        // JS reloaded onto a dev client built before the native sidecar patch.
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

  const applySync = (next: number) => {
    setSyncSeconds(next);
    player.setSubtitleOffset?.(next * 1000);
    if (storageKey) persistSubtitleOffset(storageKey, next);
  };

  // ── [SubPerf] render frequency + JS-thread stall probe (visible only) ──
  const renderCountRef = React.useRef(0);
  if (visible) {
    renderCountRef.current += 1;
    console.log(`[SubPerf] sheet render #${renderCountRef.current}`);
  }
  React.useEffect(() => {
    if (!visible) return;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      if (now - last > 700) {
        console.log(`[SubPerf] JS thread stall: ${now - last}ms between ticks`);
      }
      last = now;
    }, 300);
    return () => clearInterval(id);
  }, [visible]);

  const syncSupported = typeof player.setSubtitleOffset === "function";

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
        {/* Swallows taps on the sheet so blank areas don't dismiss it */}
        <TouchableOpacity
          style={[styles.sheet, isLandscape && styles.sheetLandscape]}
          activeOpacity={1}
          onPress={() => {}}
        >
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Subtitles</Text>
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
            {/* Subtitle sync stepper (only when the player supports the offset) */}
            {syncSupported && (
              <>
                <View style={styles.syncRow}>
                  <View style={styles.syncInfo}>
                    <Text style={styles.syncLabel}>Subtitle Sync</Text>
                    <Text style={styles.syncHint}>
                      Subtitles early? Shift them later (+). Persisted for this
                      series.
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.syncBtn}
                    onPress={() => applySync(syncSeconds - SYNC_STEP_S)}
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
                    onPress={() => applySync(syncSeconds + SYNC_STEP_S)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Subtitles 0.5 seconds later"
                  >
                    <Ionicons name="add" size={18} color={colors.textPrimary} />
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
                <View style={styles.separator} />
              </>
            )}

            {/* Off — selected when no track is active */}
            <TrackRow
              selected={selectedId === null}
              language="Off"
              name="Disable subtitles"
              onPress={() => selectTrack("off")}
            />

            {/* In-file tracks */}
            {embeddedTracks.map((item) => (
              <TrackRow
                key={item.id}
                selected={selectedId === item.id}
                language={item.language || "Unknown"}
                name={item.label}
                onPress={() => selectTrack(item.id)}
              />
            ))}

            {/* Loaded online tracks — visually distinct from in-file ones */}
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

            {/* ── Online subtitles — below embedded, embedded preferred ── */}
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
                    Load subtitles online
                  </Text>
                  <Ionicons
                    name={onlineOpen ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.textTertiary}
                  />
                </TouchableOpacity>
                {embeddedTracks.length === 0 && !onlineOpen && (
                  <Text style={styles.onlineHint}>
                    No embedded subtitles in this file — search online below.
                  </Text>
                )}

                {onlineOpen && (
                  <View style={styles.onlineBody}>
                    {searching && (
                      <View style={styles.onlineStatusRow}>
                        <ActivityIndicator size="small" color={colors.gold} />
                        <Text style={styles.onlineStatusText}>Searching…</Text>
                      </View>
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

            {embeddedTracks.length === 0 && !onlineSearch && (
              <View style={styles.emptyState}>
                <Ionicons name="text" size={48} color={colors.emptyIcon} />
                <Text style={styles.emptyText}>No subtitles available</Text>
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
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
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
  syncRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 10,
  },
  syncInfo: {
    flex: 1,
  },
  syncLabel: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
  syncHint: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
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
  onlineStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  onlineStatusText: {
    color: colors.textTertiary,
    fontSize: 13,
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

// Memoized: the parent overlay re-renders on seek/pause/state changes — the
// sheet should only re-render when its own props (visible, player, key) change.
export const SubtitleSheet = React.memo(SubtitleSheetInner);
