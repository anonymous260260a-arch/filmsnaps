/**
 * PlayerHub — the tabbed card below the direct player (watch page).
 *
 * One card, segmented tabs, replacing the old floating chips:
 *   [ Episodes ]  [ Servers ]
 *  ─────────────────────────
 *   active tab content
 *
 * - Episodes: web-watch-page-style rows — 16:9 thumb, SxxEyy + title,
 *   runtime, air date, per-episode progress bar, Now playing / Continue /
 *   Watched badges. Season pills on top when the show has multiple seasons.
 * - Servers: the provider list (HDHub, Vidlink, …) with Direct/Embed tags
 *   and the active checkmark. Tapping switches the whole page's server.
 *
 * The HEVC *stream/source* selector is deliberately NOT here — that is an
 * in-player concern and lives in the player chrome (source pill) and the
 * error cards. This hub is page-level chrome only.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../theme/colors";
import type { ProviderDefinition } from "@filmsnaps/shared";
import { getImageUrl } from "@filmsnaps/shared";
import { ProgressiveImage } from "../ProgressiveImage";
import { useSeasonEpisodes, useTVSeasonsOnly } from "../../hooks/useTMDB";
import { getProgress } from "../../lib/watchHistory";
import type { WatchProgress } from "../../lib/watchHistory";
import { trackFeatureUsed } from "../../lib/telemetry";
import type { StreamLink } from "./streamTypes";
import type { ProbeOutcome } from "../../lib/streamValidator";

const THUMB_WIDTH = 96;
const THUMB_HEIGHT = 54;
const EPISODE_ROW_HEIGHT = THUMB_HEIGHT + 22;

type HubTab = "episodes" | "servers" | "sources";

interface PlayerHubProps {
  /** Collapsed state is controlled by the host (so the player can react). */
  /** Whether this title has episodes (TV) — movies show Servers only. */
  showEpisodes: boolean;
  tvId: string | null;
  currentSeason: number;
  currentEpisode: number;
  onSelectEpisode?: (season: number, episode: number) => void;
  /** Provider list (page-level servers, first = active default candidate). */
  providers: ProviderDefinition[];
  currentProviderId: string;
  getProviderName: (p: ProviderDefinition) => string;
  onSelectProvider: (id: string) => void;
  /** True while the active provider is the native direct player. */
  directActive?: boolean;
  /** Default collapse state (default: expanded). */
  defaultCollapsed?: boolean;
  /** HEVC source inspection API (getLinks/select) — renders the Sources tab
   *  and supports programmatic selection when provided. */
  sourceApi?: {
    getLinks: () => StreamLink[];
    getActiveIndex: () => number;
    getStatuses: () => Record<number, ProbeOutcome>;
    getRecommendedIndex: () => number;
    getLastUsedIndex: () => number | undefined;
    select: (index: number) => void;
  } | null;
}

function formatRuntime(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function PlayerHub({
  showEpisodes,
  tvId,
  currentSeason,
  currentEpisode,
  onSelectEpisode,
  providers,
  currentProviderId,
  getProviderName,
  onSelectProvider,
  directActive = false,
  defaultCollapsed = false,
  sourceApi = null,
}: PlayerHubProps) {
  // Collapse state (chevron button; host can also force it)
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  // Snapshot the HEVC source list — re-read on each render (cheap) so probe
  // statuses stay live while the tab is open.
  const links = sourceApi?.getLinks() ?? [];
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<HubTab>(showEpisodes ? "episodes" : "servers");
  const [season, setSeason] = useState(currentSeason);
  const seasonScrollRef = useRef<ScrollView>(null);
  const seasonPillX = useRef<Record<number, number>>({});
  const episodeListRef = useRef<FlatList>(null);

  // Follow the playing season
  useEffect(() => {
    setSeason(currentSeason);
  }, [currentSeason]);

  // ── Episode data (only fetched when the tab is shown / TV) ──
  const episodesEnabled = showEpisodes && tab === "episodes" && !!tvId;
  const {
    data: seasonData,
    isLoading,
    isError,
  } = useSeasonEpisodes(
    episodesEnabled ? tvId! : "",
    episodesEnabled ? season : 0,
  );
  const { data: tvData } = useTVSeasonsOnly(showEpisodes && tvId ? tvId : "");

  const episodes = (seasonData?.episodes as any[]) ?? [];
  const seasons =
    (tvData?.seasons as any[])
      ?.filter((s: any) => s.season_number > 0 && s.episode_count > 0)
      ?.map((s: any) => s.season_number) ?? [];

  // Per-episode watch progress (same store the library/history use)
  const [episodeProgress, setEpisodeProgress] = useState<
    Record<string, WatchProgress>
  >({});
  useEffect(() => {
    if (!tvId || !episodesEnabled || episodes.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        episodes.map((ep: any, i: number) => {
          const epNum = ep.episode_number ?? i + 1;
          return getProgress(tvId, "tv", season, epNum)
            .then((p) => ({ epNum, p }))
            .catch(() => ({ epNum, p: null }));
        }),
      );
      if (cancelled) return;
      const map: Record<string, WatchProgress> = {};
      for (const r of results) {
        if (r.p) map[`${season}:${r.epNum}`] = r.p;
      }
      setEpisodeProgress(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [tvId, season, episodesEnabled, episodes]);

  // Scroll the episode list to the currently-playing episode (mirrors
  // EpisodeRail) so a deep episode (e.g. #20) is in view the moment the tab
  // opens — and follows along when next-episode advances. Only when this
  // pane's list is actually mounted and showing the playing season.
  useEffect(() => {
    if (collapsed || tab !== "episodes" || !showEpisodes) return;
    if (season !== currentSeason || episodes.length === 0) return;
    const t = setTimeout(() => {
      const idx = episodes.findIndex(
        (ep: any, i: number) => (ep.episode_number ?? i + 1) === currentEpisode,
      );
      if (idx >= 0 && episodeListRef.current) {
        episodeListRef.current.scrollToIndex({
          index: idx,
          viewPosition: 0.25,
          animated: false,
        });
      }
    }, 90);
    return () => clearTimeout(t);
  }, [
    collapsed,
    tab,
    showEpisodes,
    season,
    currentSeason,
    currentEpisode,
    episodes,
  ]);

  return (
    <View
      style={[styles.cardWrap, { marginBottom: insets.bottom + 8 }]}
      accessibilityRole="tablist"
    >
      {/* ── Tab bar + collapse chevron (order: collapse · Episodes · Servers · Sources) ── */}
      <View style={styles.tabRow} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.collapseButton}
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            trackFeatureUsed("hub_collapse_toggled", "player");
            setCollapsed((c) => !c);
          }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={collapsed ? "Expand panel" : "Collapse panel"}
          accessibilityState={{ expanded: !collapsed }}
        >
          <Ionicons
            name={collapsed ? "chevron-up" : "chevron-down"}
            size={18}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
        {showEpisodes && (
          <TouchableOpacity
            style={[styles.tab, tab === "episodes" && styles.tabActive]}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              trackFeatureUsed("hub_tab_changed", "player");
              setTab("episodes");
            }}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === "episodes" }}
            accessibilityLabel="Episodes"
          >
            <Ionicons
              name="list-outline"
              size={15}
              color={tab === "episodes" ? colors.gold : colors.textTertiary}
            />
            <Text
              style={[
                styles.tabText,
                tab === "episodes" && styles.tabTextActive,
              ]}
            >
              Episodes
            </Text>
          </TouchableOpacity>
        )}{" "}
        <TouchableOpacity
          style={[styles.tab, tab === "servers" && styles.tabActive]}
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            trackFeatureUsed("hub_tab_changed", "player");
            setTab("servers");
          }}
          activeOpacity={0.7}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === "servers" }}
          accessibilityLabel="Servers"
        >
          <Ionicons
            name="server-outline"
            size={15}
            color={tab === "servers" ? colors.gold : colors.textTertiary}
          />
          <Text
            style={[styles.tabText, tab === "servers" && styles.tabTextActive]}
          >
            Servers
          </Text>
        </TouchableOpacity>
        {sourceApi && (
          <TouchableOpacity
            style={[styles.tab, tab === "sources" && styles.tabActive]}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              trackFeatureUsed("quality_manual_override", "player", {
                fromTab: "hub_sources_tab",
                surface: "direct",
              });
              setTab("sources");
            }}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === "sources" }}
            accessibilityLabel="Sources"
          >
            <Ionicons
              name="film-outline"
              size={15}
              color={tab === "sources" ? colors.gold : colors.textTertiary}
            />
            <Text
              style={[
                styles.tabText,
                tab === "sources" && styles.tabTextActive,
              ]}
            >
              Sources
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Tab content (hidden while collapsed) ── */}
      {!collapsed && tab === "episodes" && showEpisodes && (
        <>
          <View style={styles.divider} />
          <View style={styles.episodesPane}>
            {/* Season pills */}
            {seasons.length > 1 && (
              <ScrollView
                ref={seasonScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.seasonRow}
                style={styles.seasonScroll}
              >
                {seasons.map((s: number) => {
                  const isSelected = s === season;
                  return (
                    <TouchableOpacity
                      key={s}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        setSeason(s);
                      }}
                      onLayout={(e) => {
                        seasonPillX.current[s] = e.nativeEvent.layout.x;
                      }}
                      activeOpacity={0.7}
                      style={[
                        styles.seasonPill,
                        isSelected && styles.seasonPillActive,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Season ${s}`}
                      accessibilityState={{ selected: isSelected }}
                    >
                      <Text
                        style={[
                          styles.seasonPillText,
                          isSelected && styles.seasonPillTextActive,
                        ]}
                      >
                        Season {s}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {isLoading ? (
              <View style={styles.paneState}>
                <ActivityIndicator size="small" color={colors.gold} />
              </View>
            ) : isError ? (
              <View style={styles.paneState}>
                <Ionicons
                  name="alert-circle-outline"
                  size={22}
                  color={colors.error}
                />
                <Text style={styles.paneStateText}>
                  Failed to load episodes for this season
                </Text>
              </View>
            ) : episodes.length === 0 ? (
              <View style={styles.paneState}>
                <Ionicons
                  name="tv-outline"
                  size={22}
                  color={colors.textTertiary}
                />
                <Text style={styles.paneStateText}>No episodes found</Text>
              </View>
            ) : (
              <FlatList
                ref={episodeListRef}
                data={episodes}
                keyExtractor={(ep: any, index: number) =>
                  String(ep.id ?? index)
                }
                style={styles.episodeList}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                  paddingBottom: 8,
                  paddingHorizontal: 12,
                }}
                initialNumToRender={8}
                maxToRenderPerBatch={8}
                windowSize={7}
                removeClippedSubviews
                getItemLayout={(_, index) => ({
                  length: EPISODE_ROW_HEIGHT,
                  offset: EPISODE_ROW_HEIGHT * index,
                  index,
                })}
                renderItem={({ item: ep, index }) => {
                  const epNum = ep.episode_number ?? index + 1;
                  const isActive =
                    season === currentSeason && epNum === currentEpisode;
                  const prog = episodeProgress[`${season}:${epNum}`];
                  const hasProgress =
                    prog && !prog.completed && prog.percent > 0.05;
                  const isCompleted = prog?.completed;
                  return (
                    <TouchableOpacity
                      onPress={() => {
                        if (isActive) return;
                        Haptics.impactAsync(
                          Haptics.ImpactFeedbackStyle.Light,
                        ).catch(() => {});
                        trackFeatureUsed("episode_manual_pick", "player");
                        onSelectEpisode?.(season, epNum);
                      }}
                      activeOpacity={isActive ? 1 : 0.7}
                      style={[
                        styles.episodeRow,
                        isActive && styles.episodeRowActive,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Episode ${epNum}: ${ep.name ?? ""}${isActive ? ", now playing" : ""}`}
                    >
                      {/* 16:9 thumb */}
                      <View style={styles.episodeThumb}>
                        {ep.still_path ? (
                          <ProgressiveImage
                            uri={getImageUrl(ep.still_path, "w300")}
                            style={StyleSheet.absoluteFill}
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            style={[
                              StyleSheet.absoluteFill,
                              styles.episodeThumbFallback,
                            ]}
                          />
                        )}
                        {isActive && (
                          <View style={styles.playingBadge}>
                            <Ionicons name="play" size={9} color={colors.bg} />
                            <Text style={styles.playingBadgeText}>Playing</Text>
                          </View>
                        )}
                        {!isActive && hasProgress && (
                          <View style={styles.thumbProgressWrap}>
                            <View
                              style={[
                                styles.thumbProgressFill,
                                {
                                  width: `${Math.min(100, prog.percent * 100)}%`,
                                },
                              ]}
                            />
                          </View>
                        )}
                      </View>

                      {/* Text block */}
                      <View style={styles.episodeInfo}>
                        <View style={styles.episodeTopRow}>
                          <Text style={styles.episodeNumber} numberOfLines={1}>
                            E{String(epNum).padStart(2, "0")}
                          </Text>
                          <Text style={styles.episodeTitle} numberOfLines={1}>
                            {ep.name ?? `Episode ${epNum}`}
                          </Text>
                          {isCompleted && (
                            <Ionicons
                              name="checkmark-circle"
                              size={14}
                              color={colors.gold}
                            />
                          )}
                        </View>
                        {ep.runtime ? (
                          <Text style={styles.episodeMeta} numberOfLines={1}>
                            {formatRuntime(ep.runtime * 60)}
                            {ep.air_date ? ` · ${ep.air_date}` : ""}
                          </Text>
                        ) : ep.air_date ? (
                          <Text style={styles.episodeMeta} numberOfLines={1}>
                            {ep.air_date}
                          </Text>
                        ) : null}
                        {hasProgress && (
                          <View style={styles.rowProgressTrack}>
                            <View
                              style={[
                                styles.rowProgressFill,
                                {
                                  width: `${Math.min(100, prog.percent * 100)}%`,
                                },
                              ]}
                            />
                          </View>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        </>
      )}
      {!collapsed && tab === "servers" && (
        <>
          <View style={styles.divider} />
          <ScrollView
            style={styles.serverList}
            contentContainerStyle={{ paddingBottom: 8, paddingHorizontal: 12 }}
            showsVerticalScrollIndicator={false}
          >
            {providers.map((p) => {
              const isActive = p.id === currentProviderId;
              const isDirectType = p.type === "direct" || p.id === "direct";
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => {
                    if (isActive) return;
                    Haptics.impactAsync(
                      Haptics.ImpactFeedbackStyle.Light,
                    ).catch(() => {});
                    trackFeatureUsed("server_manual_pick", "player", {
                      fromTab: "servers",
                      surface: "direct",
                    });
                    onSelectProvider(p.id);
                  }}
                  activeOpacity={isActive ? 1 : 0.7}
                  style={[styles.serverRow, isActive && styles.serverRowActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`Server ${getProviderName(p)}${isActive ? ", currently active" : ""}`}
                >
                  <View
                    style={[
                      styles.serverIcon,
                      isActive && styles.serverIconActive,
                    ]}
                  >
                    <Ionicons
                      name={isDirectType ? "flash-outline" : "globe-outline"}
                      size={16}
                      color={isActive ? colors.gold : colors.textSecondary}
                    />
                  </View>
                  <View style={styles.serverInfo}>
                    <Text
                      style={[
                        styles.serverName,
                        isActive && styles.serverNameActive,
                      ]}
                      numberOfLines={1}
                    >
                      {getProviderName(p)}
                    </Text>
                    {p.note ? (
                      <Text style={styles.serverNote} numberOfLines={1}>
                        {p.note}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.serverTag}>
                    <Text
                      style={[
                        styles.serverTagText,
                        isDirectType && styles.serverTagTextDirect,
                      ]}
                    >
                      {isDirectType ? "Direct" : "Embed"}
                    </Text>
                  </View>
                  {isActive && (
                    <Ionicons
                      name="checkmark-circle"
                      size={18}
                      color={colors.gold}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      )}
      {!collapsed && tab === "sources" && sourceApi && (
        <>
          <View style={styles.divider} />
          <ScrollView
            contentContainerStyle={{ paddingBottom: 8, paddingHorizontal: 12 }}
            showsVerticalScrollIndicator={false}
          >
            {links.length === 0 ? (
              <View style={styles.paneState}>
                <Ionicons
                  name="film-outline"
                  size={22}
                  color={colors.textTertiary}
                />
                <Text style={styles.paneStateText}>No sources available</Text>
              </View>
            ) : (
              links.map((link, idx) => {
                const isActive = idx === sourceApi.getActiveIndex();
                const isRecommended = idx === sourceApi.getRecommendedIndex();
                const isLastUsed = idx === sourceApi.getLastUsedIndex();
                const status = sourceApi.getStatuses()[idx];
                const langs = (link.name ?? "").toLowerCase();
                const langTag = langs.includes("multi")
                  ? "Multi"
                  : langs.includes("hindi")
                    ? "Hindi"
                    : langs.includes("english")
                      ? "English"
                      : null;
                return (
                  <TouchableOpacity
                    key={`${idx}-${link.url?.slice(-16) ?? idx}`}
                    onPress={() => {
                      if (isActive) return;
                      Haptics.impactAsync(
                        Haptics.ImpactFeedbackStyle.Light,
                      ).catch(() => {});
                      trackFeatureUsed("quality_manual_override", "player", {
                        fromTab: "sources",
                        surface: "direct",
                      });
                      sourceApi.select(idx);
                    }}
                    activeOpacity={isActive ? 1 : 0.7}
                    style={[
                      styles.serverRow,
                      isActive && styles.serverRowActive,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Source ${idx + 1}: ${link.quality ?? "unknown quality"}${status === "valid" ? ", verified" : status === "dead" ? ", failed" : ", unverified"}${isActive ? ", currently playing" : ""}`}
                  >
                    <View
                      style={[
                        styles.serverIcon,
                        isActive && styles.serverIconActive,
                      ]}
                    >
                      <Text style={styles.sourceIndexText}>{idx + 1}</Text>
                    </View>
                    <View style={styles.serverInfo}>
                      <View style={styles.episodeTopRow}>
                        <Text
                          style={[
                            styles.serverName,
                            isActive && styles.serverNameActive,
                          ]}
                          numberOfLines={1}
                        >
                          {link.quality ?? "Source"}
                        </Text>
                        {isRecommended && !isActive && (
                          <View
                            style={[styles.serverTag, styles.recommendedTag]}
                          >
                            <Text
                              style={[
                                styles.serverTagText,
                                styles.serverTagTextDirect,
                              ]}
                            >
                              Best
                            </Text>
                          </View>
                        )}
                        {isLastUsed && !isActive && !isRecommended && (
                          <View style={styles.serverTag}>
                            <Text style={styles.serverTagText}>Last used</Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.episodeTopRow}>
                        {status ? (
                          <>
                            <Ionicons
                              name={
                                status === "valid"
                                  ? "checkmark-circle"
                                  : status === "dead"
                                    ? "close-circle"
                                    : "help-circle"
                              }
                              size={12}
                              color={
                                status === "valid"
                                  ? colors.gold
                                  : status === "dead"
                                    ? colors.error
                                    : colors.textTertiary
                              }
                            />
                            <Text style={styles.serverNote}>
                              {status === "valid"
                                ? "Verified"
                                : status === "dead"
                                  ? "Failed"
                                  : "Unverified"}
                            </Text>
                          </>
                        ) : (
                          <Text style={styles.serverNote}>Checking…</Text>
                        )}
                        {langTag ? (
                          <Text style={styles.serverNote}>· {langTag}</Text>
                        ) : null}
                      </View>
                    </View>
                    {isActive && (
                      <Ionicons
                        name="play-circle"
                        size={20}
                        color={colors.gold}
                      />
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Outer wrapper owns the breathing room between the player and the hub —
  // the rounded card sits inside it. (Joining them flush flattened the
  // design; this restores the visual separation.)
  cardWrap: {
    flex: 1,
    paddingHorizontal: 10,
    paddingTop: 10,
  },
  card: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: 20,
    overflow: "hidden",
  },
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 6,
  },
  collapseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  tabActive: {
    backgroundColor: colors.goldBadge,
  },
  tabText: {
    color: colors.textTertiary,
    fontSize: 13,
    fontWeight: "700",
  },
  tabTextActive: {
    color: colors.gold,
  },
  seasonRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  seasonScroll: {
    flexGrow: 0,
  },
  seasonPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  seasonPillActive: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  seasonPillText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  seasonPillTextActive: {
    color: colors.bg,
  },
  episodesPane: {
    flex: 1,
    minHeight: 0,
  },
  paneState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 32,
  },
  paneStateText: {
    color: colors.textSecondary,
    fontSize: 12.5,
    textAlign: "center",
    paddingHorizontal: 24,
  },
  episodeList: {
    flex: 1,
  },
  episodeRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bgSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: 8,
    marginBottom: 8,
    height: EPISODE_ROW_HEIGHT,
  },
  episodeRowActive: {
    backgroundColor: "rgba(212,162,55,0.08)",
    borderColor: "rgba(212,162,55,0.4)",
  },
  episodeThumb: {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: colors.bgSubtle,
    marginRight: 10,
  },
  episodeThumbFallback: {
    backgroundColor: colors.bgSubtle,
  },
  playingBadge: {
    position: "absolute",
    left: 4,
    bottom: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.gold,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  playingBadgeText: {
    color: colors.bg,
    fontSize: 8.5,
    fontWeight: "800",
  },
  thumbProgressWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  thumbProgressFill: {
    height: "100%",
    backgroundColor: colors.gold,
  },
  episodeInfo: {
    flex: 1,
    gap: 3,
  },
  episodeTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  episodeNumber: {
    color: colors.gold,
    fontSize: 11.5,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  episodeTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  episodeMeta: {
    color: colors.textTertiary,
    fontSize: 11,
  },
  rowProgressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },
  rowProgressFill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: colors.gold,
  },
  serverList: {
    flex: 1,
    // Guard: when the watch page's ScrollWrapper hosts the hub, "flex:1" can
    // collapse to 0 and ScrollView loses ALL touch handling — tabs render but
    // don't respond. A hard minimum keeps the list interactive everywhere.
    minHeight: 120,
  },
  serverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.bgSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: 12,
    marginBottom: 8,
  },
  serverRowActive: {
    backgroundColor: "rgba(212,162,55,0.08)",
    borderColor: "rgba(212,162,55,0.4)",
  },
  serverIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.bgSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  serverIconActive: {
    backgroundColor: colors.goldBadge,
  },
  serverInfo: {
    flex: 1,
    gap: 2,
  },
  serverName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  serverNameActive: {
    color: colors.gold,
  },
  serverNote: {
    color: colors.textTertiary,
    fontSize: 11,
  },
  serverTag: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: colors.bgSubtle,
  },
  serverTagText: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  serverTagTextDirect: {
    color: colors.gold,
  },
  recommendedTag: {
    backgroundColor: colors.goldBadge,
  },
  sourceIndexText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  divider: {
    height: 1,
    backgroundColor: colors.zinc800,
    marginTop: 8,
  },
});
