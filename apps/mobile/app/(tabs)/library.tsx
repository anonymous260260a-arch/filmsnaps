/**
 * Library — Personal content collections.
 *
 * Unified segmented view with 4 clean tabs:
 * 1. Continue Watching (rich landscape cards with progress)
 * 2. Saved (3-column poster grid)
 * 3. Downloads (clean offline list with storage indicator)
 * 4. Watch History (chronological timeline list)
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
  RefreshControl,
  FlatList,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useSafeNavigation } from "@/lib/navigation";
import { useSettings } from "@/lib/settings";
import { useFocusEffect } from "expo-router";
import { useDownloadList } from "../../lib/download";
import { tmdbToAnimeIds } from "../../lib/anime/resolve";
import { getAllBookmarks } from "../../lib/bookmarks";
import {
  useWatchHistory,
  watchHistoryStore,
} from "../../lib/watchHistoryStore";
import { tmdbApi } from "../../lib/api";
import { ProgressiveImage } from "../../components/ProgressiveImage";
import { getImageUrl } from "@filmsnaps/shared";
import type { Movie } from "@filmsnaps/shared";
import type { WatchProgress } from "../../lib/watchHistory";
import type { Bookmark } from "../../lib/bookmarks";
import NetInfo from "@react-native-community/netinfo";
import type { DownloadTask } from "../../lib/download";
import { colors } from "../../theme/colors";
import * as Haptics from "expo-haptics";

type TabType = "watching" | "saved" | "downloads" | "history";

const CARD_GAP = 12;

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function LibraryScreen() {
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  const { width: SCREEN_WIDTH } = useWindowDimensions();

  const [activeTab, setActiveTab] = useState<TabType>("watching");

  // Poster dimensions for 3-column grid
  const posterWidth = Math.floor((SCREEN_WIDTH - 32 - CARD_GAP * 2) / 3);
  const posterHeight = Math.round(posterWidth * 1.5);

  const {
    completed: completedDownloads,
    active: activeDownloads,
    paused: pausedDownloads,
  } = useDownloadList();

  const [isOffline, setIsOffline] = useState(false);
  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => {
      setIsOffline(!s.isConnected && !s.isInternetReachable);
    });
    return () => unsub();
  }, []);

  const { entries: storeHistory } = useWatchHistory(
    settings.mode === "anime" ? "anime" : "movie_tv",
  );
  const historyEntries = useMemo(
    () =>
      storeHistory as Array<{ latest: WatchProgress; fullyWatched: boolean }>,
    [storeHistory],
  );
  const historyMeta = useMemo(() => {
    const m: Record<string, Movie | null> = {};
    for (const e of storeHistory) m[e.latest.tmdbId] = e.meta;
    return m;
  }, [storeHistory]);

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkMeta, setBookmarkMeta] = useState<
    Record<string, Movie | null>
  >({});
  const bookmarksLoadedRef = useRef(false);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  const loadBookmarks = useCallback(async () => {
    if (bookmarksLoadedRef.current && !refreshingRef.current) return;
    try {
      const all = await getAllBookmarks();
      setBookmarks(all);
      const metaMap: Record<string, Movie | null> = {};
      await Promise.all(
        all.slice(0, 12).map(async (b) => {
          try {
            if (b.mediaType === "tv") {
              metaMap[b.tmdbId] = (await tmdbApi.getTVDetails(
                Number(b.tmdbId),
              )) as unknown as Movie;
            } else {
              metaMap[b.tmdbId] = (await tmdbApi.getMovieDetails(
                Number(b.tmdbId),
              )) as Movie;
            }
          } catch {
            metaMap[b.tmdbId] = null;
          }
        }),
      );
      setBookmarkMeta((prev) => ({ ...prev, ...metaMap }));
    } catch {}
    bookmarksLoadedRef.current = true;
  }, []);

  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  useFocusEffect(
    useCallback(() => {
      watchHistoryStore.syncProgress().catch(() => {});
    }, []),
  );

  const onRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshing(true);

    bookmarksLoadedRef.current = false;
    loadBookmarks();
    watchHistoryStore.forceRefresh().catch(() => {});

    setTimeout(() => {
      setIsRefreshing(false);
      refreshingRef.current = false;
    }, 1200);
  }, [loadBookmarks]);

  const allDownloads = useMemo(() => {
    return [...activeDownloads, ...pausedDownloads, ...completedDownloads];
  }, [activeDownloads, pausedDownloads, completedDownloads]);

  const handleHistoryPress = useCallback(
    (p: WatchProgress) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const base =
        p.mediaType === "tv"
          ? `/watch/tv/${p.tmdbId}/${p.season ?? 1}/${p.episode ?? 1}`
          : `/watch/movie/${p.tmdbId}`;
      const params = new URLSearchParams({});
      if (p.isAnime === true) {
        params.set("isAnime", "1");
        const ids = tmdbToAnimeIds(p.tmdbId, p.mediaType, p.season, p.episode);
        if (ids) {
          params.set("mid", String(ids.malId));
          if (ids.anilistId != null) params.set("aid", String(ids.anilistId));
        }
      }
      nav.push(params.toString() ? `${base}?${params.toString()}` : base);
    },
    [nav],
  );

  const tabs: {
    id: TabType;
    label: string;
    count: number;
    icon: keyof typeof Ionicons.glyphMap;
  }[] = [
    {
      id: "watching",
      label: "Continue",
      count: historyEntries.length,
      icon: "play-circle-outline",
    },
    {
      id: "saved",
      label: "Saved",
      count: bookmarks.length,
      icon: "bookmark-outline",
    },
    {
      id: "downloads",
      label: "Downloads",
      count: allDownloads.length,
      icon: "cloud-download-outline",
    },
    {
      id: "history",
      label: "History",
      count: historyEntries.length,
      icon: "time-outline",
    },
  ];

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        paddingTop: insets.top,
      }}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 12,
        }}
      >
        <View>
          <Text
            style={{
              fontFamily: "PlayfairDisplay_700Bold",
              fontSize: 24,
              color: colors.textPrimary,
            }}
          >
            Library
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => nav.push("/settings")}
          activeOpacity={0.75}
          accessibilityLabel="Settings"
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 0.5,
            borderColor: colors.borderSubtle,
            backgroundColor: colors.bgSurface,
          }}
        >
          <Ionicons
            name="settings-outline"
            size={17}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      {/* Segmented Top Bar */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
        <View
          style={{
            flexDirection: "row",
            backgroundColor: colors.bgCard,
            borderRadius: 12,
            padding: 3,
            borderWidth: 0.5,
            borderColor: colors.borderSubtle,
          }}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setActiveTab(tab.id);
                }}
                activeOpacity={0.75}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor: isActive ? colors.gold : "transparent",
                  gap: 4,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: "Inter_600SemiBold",
                    color: isActive ? colors.bg : colors.textSecondary,
                  }}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
                {tab.count > 0 && (
                  <View
                    style={{
                      backgroundColor: isActive
                        ? "rgba(0, 0, 0, 0.2)"
                        : "rgba(255, 255, 255, 0.08)",
                      borderRadius: 8,
                      paddingHorizontal: 5,
                      paddingVertical: 1,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 9,
                        fontFamily: "Inter_700Bold",
                        color: isActive ? colors.bg : colors.textTertiary,
                      }}
                    >
                      {tab.count}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Offline banner */}
      {isOffline && (
        <View
          style={{
            marginHorizontal: 16,
            marginBottom: 12,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 10,
            backgroundColor: "rgba(212,162,55,0.1)",
            borderWidth: 0.5,
            borderColor: colors.goldBadge,
          }}
        >
          <Ionicons
            name="cloud-offline-outline"
            size={14}
            color={colors.gold}
            style={{ marginRight: 6 }}
          />
          <Text style={{ color: colors.textSecondary, fontSize: 11, flex: 1 }}>
            Offline mode — downloaded content is available
          </Text>
        </View>
      )}

      {/* ── Tab Content Views ── */}
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.gold}
            colors={[colors.gold]}
          />
        }
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 80 + insets.bottom,
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* 1. Continue Watching Tab */}
        {activeTab === "watching" && (
          <View style={{ flex: 1 }}>
            {historyEntries.length === 0 ? (
              <EmptyTabView
                icon="play-circle-outline"
                title="No active watch sessions"
                subtitle="Start watching any movie or TV show to resume anytime."
                buttonText="Browse Movies & Shows"
                onPress={() => nav.push("/(tabs)")}
              />
            ) : (
              <View style={{ gap: 12 }}>
                {historyEntries.map((item) => {
                  const p = item.latest;
                  const meta = historyMeta[p.tmdbId];
                  const title =
                    (p.mediaType === "tv" ? meta?.name : meta?.title) ??
                    "Untitled";
                  const backdrop = meta?.backdrop_path || meta?.poster_path;
                  const pct = Math.round((p.completed ? 1 : p.percent) * 100);

                  return (
                    <TouchableOpacity
                      key={`${p.mediaType}:${p.tmdbId}`}
                      onPress={() => handleHistoryPress(p)}
                      activeOpacity={0.75}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        backgroundColor: colors.bgCard,
                        borderRadius: 14,
                        borderWidth: 0.5,
                        borderColor: colors.borderSubtle,
                        padding: 10,
                      }}
                    >
                      {/* 16:9 Thumbnail with Progress Overlay */}
                      <View
                        style={{
                          width: 110,
                          height: 62,
                          borderRadius: 8,
                          overflow: "hidden",
                          backgroundColor: colors.bgElevated,
                          position: "relative",
                          justifyContent: "center",
                          alignItems: "center",
                        }}
                      >
                        {backdrop ? (
                          <ProgressiveImage
                            uri={getImageUrl(backdrop, "w300")}
                            style={{ width: 110, height: 62 }}
                            resizeMode="cover"
                          />
                        ) : (
                          <Ionicons
                            name={
                              p.mediaType === "tv"
                                ? "tv-outline"
                                : "film-outline"
                            }
                            size={20}
                            color={colors.textTertiary}
                          />
                        )}

                        {/* Centered Play overlay */}
                        <View
                          style={{
                            position: "absolute",
                            width: 28,
                            height: 28,
                            borderRadius: 14,
                            backgroundColor: "rgba(0,0,0,0.65)",
                            alignItems: "center",
                            justifyContent: "center",
                            borderWidth: 0.5,
                            borderColor: "rgba(255,255,255,0.2)",
                          }}
                        >
                          <Ionicons
                            name="play"
                            size={12}
                            color={colors.gold}
                            style={{ marginLeft: 2 }}
                          />
                        </View>

                        {/* Progress Bar at bottom */}
                        <View
                          style={{
                            position: "absolute",
                            bottom: 0,
                            left: 0,
                            right: 0,
                            height: 2.5,
                            backgroundColor: "rgba(0,0,0,0.6)",
                          }}
                        >
                          <View
                            style={{
                              width: `${pct}%`,
                              height: "100%",
                              backgroundColor: item.fullyWatched
                                ? colors.successGreen
                                : colors.gold,
                            }}
                          />
                        </View>
                      </View>

                      {/* Details Column */}
                      <View style={{ flex: 1, marginLeft: 12, marginRight: 6 }}>
                        <Text
                          style={{
                            fontSize: 14,
                            fontFamily: "Inter_600SemiBold",
                            color: colors.textPrimary,
                          }}
                          numberOfLines={1}
                        >
                          {title}
                        </Text>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 6,
                            marginTop: 4,
                          }}
                        >
                          {p.mediaType === "tv" && p.season != null && (
                            <View
                              style={{
                                backgroundColor: "rgba(255, 255, 255, 0.08)",
                                borderRadius: 4,
                                paddingHorizontal: 5,
                                paddingVertical: 1,
                              }}
                            >
                              <Text
                                style={{
                                  color: colors.gold,
                                  fontSize: 10,
                                  fontFamily: "Inter_600SemiBold",
                                }}
                              >
                                S{p.season} E{p.episode}
                              </Text>
                            </View>
                          )}
                          <Text
                            style={{
                              fontSize: 11,
                              fontFamily: "Inter_400Regular",
                              color: colors.textTertiary,
                            }}
                          >
                            {item.fullyWatched
                              ? "Completed"
                              : `${pct}% watched`}
                          </Text>
                        </View>
                      </View>

                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={colors.textTertiary}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* 2. Saved / Bookmarks Tab */}
        {activeTab === "saved" && (
          <View style={{ flex: 1 }}>
            {bookmarks.length === 0 ? (
              <EmptyTabView
                icon="bookmark-outline"
                title="No saved titles"
                subtitle="Tap the bookmark icon on any movie or TV show to save it here."
                buttonText="Explore Trending"
                onPress={() => nav.push("/(tabs)")}
              />
            ) : (
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: CARD_GAP,
                }}
              >
                {bookmarks.map((b) => {
                  const meta = bookmarkMeta[b.tmdbId];
                  const poster = meta?.poster_path ?? b.posterPath;
                  return (
                    <TouchableOpacity
                      key={b.tmdbId}
                      onPress={() => {
                        if (b.mediaType === "tv") {
                          nav.push(`/tv/${b.tmdbId}`);
                        } else {
                          nav.push(`/movie/${b.tmdbId}`);
                        }
                      }}
                      activeOpacity={0.75}
                      style={{ width: posterWidth }}
                    >
                      <View
                        style={{
                          width: posterWidth,
                          height: posterHeight,
                          borderRadius: 12,
                          overflow: "hidden",
                          backgroundColor: colors.bgElevated,
                          borderWidth: 0.5,
                          borderColor: colors.borderSubtle,
                        }}
                      >
                        {poster ? (
                          <ProgressiveImage
                            uri={getImageUrl(poster, "w342")}
                            style={{
                              width: posterWidth,
                              height: posterHeight,
                            }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            style={{
                              flex: 1,
                              alignItems: "center",
                              justifyContent: "center",
                              backgroundColor: colors.bgSurface,
                            }}
                          >
                            <Ionicons
                              name="bookmark-outline"
                              size={24}
                              color={colors.gold}
                            />
                          </View>
                        )}
                      </View>
                      <Text
                        style={{
                          fontSize: 12,
                          fontFamily: "Inter_500Medium",
                          color: colors.textSecondary,
                          marginTop: 6,
                        }}
                        numberOfLines={1}
                      >
                        {b.title || `ID: ${b.tmdbId}`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* 3. Downloads Tab */}
        {activeTab === "downloads" && (
          <View style={{ flex: 1 }}>
            {allDownloads.length === 0 ? (
              <EmptyTabView
                icon="cloud-download-outline"
                title="No downloads"
                subtitle="Download movies and episodes to watch offline anytime without Wi-Fi."
                buttonText="Manage Downloads"
                onPress={() => nav.push("/downloads")}
              />
            ) : (
              <View style={{ gap: 10 }}>
                {allDownloads.map((task: DownloadTask) => {
                  const meta = historyMeta[task.tmdbId ?? ""];
                  const isActive = activeDownloads.some(
                    (t) => t.id === task.id,
                  );
                  const isPaused = pausedDownloads.some(
                    (t) => t.id === task.id,
                  );

                  return (
                    <TouchableOpacity
                      key={task.id}
                      onPress={() => nav.push("/downloads")}
                      activeOpacity={0.75}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        backgroundColor: colors.bgCard,
                        borderRadius: 14,
                        borderWidth: 0.5,
                        borderColor: colors.borderSubtle,
                        padding: 10,
                      }}
                    >
                      <View
                        style={{
                          width: 44,
                          height: 64,
                          borderRadius: 8,
                          overflow: "hidden",
                          backgroundColor: colors.bgElevated,
                        }}
                      >
                        {meta?.poster_path || task.posterPath ? (
                          <ProgressiveImage
                            uri={getImageUrl(
                              (meta?.poster_path || task.posterPath)!,
                              "w185",
                            )}
                            style={{ width: 44, height: 64 }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            style={{
                              flex: 1,
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Ionicons
                              name="download-outline"
                              size={18}
                              color={colors.gold}
                            />
                          </View>
                        )}
                      </View>

                      <View style={{ flex: 1, marginLeft: 12, marginRight: 8 }}>
                        <Text
                          style={{
                            fontSize: 13,
                            fontFamily: "Inter_600SemiBold",
                            color: colors.textPrimary,
                          }}
                          numberOfLines={1}
                        >
                          {task.title || `ID: ${task.tmdbId}`}
                        </Text>
                        <Text
                          style={{
                            fontSize: 11,
                            fontFamily: "Inter_400Regular",
                            color: isActive
                              ? colors.gold
                              : isPaused
                                ? colors.textSecondary
                                : colors.successGreen,
                            marginTop: 3,
                          }}
                        >
                          {isActive
                            ? "Downloading..."
                            : isPaused
                              ? "Paused"
                              : "Ready to watch"}
                        </Text>
                      </View>

                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={colors.textTertiary}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* 4. Watch History Tab */}
        {activeTab === "history" && (
          <View style={{ flex: 1 }}>
            {historyEntries.length === 0 ? (
              <EmptyTabView
                icon="time-outline"
                title="No watch history"
                subtitle="Your completed and in-progress watches will show up in your history timeline."
                buttonText="Start Watching"
                onPress={() => nav.push("/(tabs)")}
              />
            ) : (
              <View
                style={{
                  backgroundColor: colors.bgCard,
                  borderRadius: 14,
                  borderWidth: 0.5,
                  borderColor: colors.borderSubtle,
                  overflow: "hidden",
                }}
              >
                {historyEntries.map((item, idx) => {
                  const p = item.latest;
                  const meta = historyMeta[p.tmdbId];
                  const title =
                    (p.mediaType === "tv" ? meta?.name : meta?.title) ??
                    "Unknown";
                  const poster = meta?.poster_path;
                  const isLast = idx === historyEntries.length - 1;

                  return (
                    <TouchableOpacity
                      key={`${p.mediaType}:${p.tmdbId}`}
                      onPress={() => handleHistoryPress(p)}
                      activeOpacity={0.75}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        borderBottomWidth: isLast ? 0 : 0.5,
                        borderBottomColor: colors.borderSubtle,
                      }}
                    >
                      {poster ? (
                        <ProgressiveImage
                          uri={getImageUrl(poster, "w92")}
                          style={{
                            width: 36,
                            height: 52,
                            borderRadius: 6,
                            backgroundColor: colors.bgElevated,
                          }}
                          resizeMode="cover"
                        />
                      ) : (
                        <View
                          style={{
                            width: 36,
                            height: 52,
                            borderRadius: 6,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: colors.bgElevated,
                          }}
                        >
                          <Ionicons
                            name={p.mediaType === "tv" ? "tv" : "film"}
                            size={16}
                            color={colors.textTertiary}
                          />
                        </View>
                      )}

                      <View style={{ flex: 1, marginLeft: 12, marginRight: 8 }}>
                        <Text
                          style={{
                            fontSize: 13,
                            fontFamily: "Inter_600SemiBold",
                            color: colors.textPrimary,
                          }}
                          numberOfLines={1}
                        >
                          {title}
                        </Text>
                        <Text
                          style={{
                            fontSize: 11,
                            fontFamily: "Inter_400Regular",
                            color: colors.textTertiary,
                            marginTop: 2,
                          }}
                        >
                          {p.mediaType === "tv" && p.season != null
                            ? `S${p.season} E${p.episode} · `
                            : ""}
                          {formatDate(p.updatedAt)} ·{" "}
                          {Math.round(p.percent * 100)}%
                        </Text>
                      </View>

                      <Ionicons
                        name="play-circle-outline"
                        size={22}
                        color={colors.gold}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function EmptyTabView({
  icon,
  title,
  subtitle,
  buttonText,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  buttonText: string;
  onPress: () => void;
}) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 48,
        paddingHorizontal: 20,
      }}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 16,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 14,
          backgroundColor: "rgba(212, 162, 55, 0.1)",
          borderWidth: 0.5,
          borderColor: colors.goldBadge,
        }}
      >
        <Ionicons name={icon} size={24} color={colors.gold} />
      </View>
      <Text
        style={{
          fontSize: 15,
          fontFamily: "Inter_600SemiBold",
          color: colors.textPrimary,
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          fontSize: 12,
          fontFamily: "Inter_400Regular",
          color: colors.textTertiary,
          textAlign: "center",
          marginTop: 6,
          lineHeight: 18,
          maxWidth: 260,
        }}
      >
        {subtitle}
      </Text>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.8}
        style={{
          marginTop: 18,
          paddingHorizontal: 18,
          paddingVertical: 9,
          borderRadius: 9999,
          backgroundColor: colors.gold,
        }}
      >
        <Text
          style={{
            color: colors.bg,
            fontFamily: "Inter_600SemiBold",
            fontSize: 12,
          }}
        >
          {buttonText}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
