/**
 * Library — Personal content collections.
 *
 * Aggregates Continue Watching, Downloads, Saved items, and Watch History
 * into a single tab. Each section shows a preview carousel/grid with a
 * "→ All" link to the full screen.
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
  FlatList,
  useWindowDimensions,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ForwardIcon } from "../../components/Icons";
import { Ionicons } from "@expo/vector-icons";
import { useSafeNavigation } from "@/lib/navigation";
import { useFocusEffect } from "expo-router";
import { useDownloadList } from "../../lib/download";
import { getAllBookmarks } from "../../lib/bookmarks";
import {
  useWatchHistory,
  watchHistoryStore,
} from "../../lib/watchHistoryStore";
import { tmdbApi } from "../../lib/api";
import { MediaCard } from "../../components/MediaCard";
import { ProgressiveImage } from "../../components/ProgressiveImage";
import { getImageUrl, PROVIDERS } from "@filmsnaps/shared";
import { typography } from "../../lib/typography";
import { EmptyState } from "../../components/EmptyState";
import type { Movie } from "@filmsnaps/shared";
import type { WatchProgress } from "../../lib/watchHistory";
import type { Bookmark } from "../../lib/bookmarks";
import NetInfo from "@react-native-community/netinfo";
import type { DownloadTask } from "../../lib/download";
import { SwipeExemptFlatList } from "../../components/SwipeExemptScroll";
import { colors } from "../../theme/colors";

const ITEM_WIDTH_COEFF = (width: number) => (width - 48) / 3;
const CARD_GAP = 10;

// ── Provider label lookup ──

const providerLabelMap: Record<string, string> = {};
for (const p of PROVIDERS) {
  providerLabelMap[p.id] = p.displayName ?? p.name;
}

// ── Helpers ──

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

// ── Section Header ──

function SectionHeader({
  title,
  onSeeAll,
}: {
  title: string;
  onSeeAll?: () => void;
}) {
  return (
    <View className="flex-row items-center justify-between px-4 mb-3">
      <Text style={typography.heading}>{title}</Text>
      {onSeeAll && (
        <TouchableOpacity onPress={onSeeAll} activeOpacity={0.7}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text
              style={{
                fontFamily: "Inter_500Medium",
                fontSize: 12,
                color: colors.gold,
              }}
            >
              See All
            </Text>
            <ForwardIcon width={14} height={14} color={colors.gold} />
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Empty Section ──

function EmptyLibrary() {
  return (
    <EmptyState
      icon="albums-outline"
      title="Your library is empty"
      message="Movies and shows you watch, download, or save will appear here."
    />
  );
}

// ── Main Screen ──

export default function LibraryScreen() {
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const cardWidth = ITEM_WIDTH_COEFF(SCREEN_WIDTH);
  const cardHeight = cardWidth * 1.5;

  const {
    completed: completedDownloads,
    active: activeDownloads,
    paused: pausedDownloads,
  } = useDownloadList();

  // ── Offline state ──
  const [isOffline, setIsOffline] = useState(false);
  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => {
      setIsOffline(!s.isConnected && !s.isInternetReachable);
    });
    return () => unsub();
  }, []);

  // ── History / Continue Watching — subscribe to the local-first singleton ──
  const { entries: storeHistory } = useWatchHistory();
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

  // ── Bookmarks / Saved ──
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkMeta, setBookmarkMeta] = useState<
    Record<string, Movie | null>
  >({});
  const bookmarksLoadedRef = useRef(false);

  // ── Refresh ──
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  // ── Load bookmarks ──
  const loadBookmarks = useCallback(async () => {
    if (bookmarksLoadedRef.current && !refreshingRef.current) return;
    try {
      const all = await getAllBookmarks();
      const sliced = all.slice(0, 6);
      setBookmarks(sliced);
      const metaMap: Record<string, Movie | null> = {};
      await Promise.all(
        sliced.map(async (b) => {
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

  // Keep history progress fresh after returning from a watch session.
  useFocusEffect(
    useCallback(() => {
      watchHistoryStore.syncProgress().catch(() => {});
    }, []),
  );

  // ── Pull-to-refresh ──
  const onRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshing(true);

    bookmarksLoadedRef.current = false;
    setBookmarks([]);
    loadBookmarks();
    // History is served by the shared store; forceRefresh re-enriches it.
    watchHistoryStore.forceRefresh().catch(() => {});

    setTimeout(() => {
      setIsRefreshing(false);
      refreshingRef.current = false;
    }, 1500);
  }, [loadBookmarks]);

  // ── Derive downloads for preview ──
  const downloadPreviews = useMemo(() => {
    // Show active + paused first, then completed
    const inProgress = [...activeDownloads, ...pausedDownloads];
    const previews = [...inProgress, ...completedDownloads];
    return previews.slice(0, 6);
  }, [activeDownloads, pausedDownloads, completedDownloads]);

  // FIX: Downloads section is always rendered (including empty state),
  // so it must NOT gate the ScrollView. Only history/bookmarks gate.
  const hasContent = historyEntries.length > 0 || bookmarks.length > 0;

  // ── Navigation ──
  const handleMediaPress = useCallback(
    (item: Movie) => {
      const mediaType = item.media_type || "movie";
      const id = item.id;
      if (mediaType === "tv") {
        nav.push(`/tv/${id}`);
      } else {
        nav.push(`/movie/${id}`);
      }
    },
    [nav],
  );

  const handleHistoryPress = useCallback(
    (p: WatchProgress) => {
      if (p.mediaType === "tv") {
        nav.push(`/watch/tv/${p.tmdbId}/${p.season ?? 1}/${p.episode ?? 1}`);
      } else {
        nav.push(`/watch/movie/${p.tmdbId}`);
      }
    },
    [nav],
  );

  return (
    <View
      className="flex-1 bg-void"
      style={{ paddingTop: insets.top, backgroundColor: colors.bg }}
    >
      {/* Header */}
      <View className="px-5 pt-4 pb-3 flex-row items-center justify-between">
        <Text
          style={{
            fontFamily: "PlayfairDisplay_700Bold",
            fontSize: 22,
            color: colors.textPrimary,
          }}
        >
          Library
        </Text>
        <TouchableOpacity
          onPress={() => nav.push("/settings")}
          activeOpacity={0.7}
          accessibilityLabel="Settings"
          className="w-9 h-9 rounded-full items-center justify-center"
          style={{ backgroundColor: colors.skeletonBg }}
        >
          <Ionicons
            name="settings-outline"
            size={18}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      {/* Offline banner */}
      {isOffline && (
        <View
          className="mx-4 mb-3 flex-row items-center px-3 py-2 rounded-lg"
          style={{
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
          <Text className="text-zinc-400 text-xs flex-1">
            Offline — downloads and saved content below
          </Text>
        </View>
      )}

      {!hasContent && downloadPreviews.length === 0 ? (
        <EmptyLibrary />
      ) : (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.gold}
              colors={[colors.gold]}
            />
          }
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingBottom: 72 + insets.bottom + 16,
          }}
        >
          {/* ── Continue Watching ── */}
          {historyEntries.length > 0 && (
            <View className="mb-6">
              <SectionHeader
                title="Continue Watching"
                onSeeAll={() => nav.push("/history")}
              />
              <SwipeExemptFlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, gap: CARD_GAP }}
                data={historyEntries}
                keyExtractor={(item) =>
                  `${item.latest.mediaType}:${item.latest.tmdbId}`
                }
                renderItem={({ item }) => {
                  const p = item.latest;
                  const meta = historyMeta[p.tmdbId];
                  const title =
                    (p.mediaType === "tv" ? meta?.name : meta?.title) ?? "";
                  const poster = meta?.poster_path;

                  return (
                    <TouchableOpacity
                      onPress={() => handleHistoryPress(p)}
                      activeOpacity={0.7}
                      style={{ width: cardWidth }}
                    >
                      <View
                        style={{ width: cardWidth, height: cardHeight }}
                        className="bg-elevated rounded-xl overflow-hidden"
                      >
                        {poster ? (
                          <ProgressiveImage
                            uri={getImageUrl(poster, "w342")}
                            style={{ width: cardWidth, height: cardHeight }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            className="flex-1 items-center justify-center"
                            style={{ backgroundColor: colors.bgTop }}
                          >
                            <Ionicons
                              name={p.mediaType === "tv" ? "tv" : "film"}
                              size={24}
                              color={colors.iconMuted}
                            />
                          </View>
                        )}

                        {/* Progress bar */}
                        <View
                          style={{
                            position: "absolute",
                            bottom: 0,
                            left: 0,
                            right: 0,
                            height: 3,
                            backgroundColor: "rgba(255,255,255,0.1)",
                          }}
                        >
                          <View
                            style={{
                              width: `${Math.round((p.completed ? 1 : p.percent) * 100)}%`,
                              height: "100%",
                              backgroundColor: item.fullyWatched
                                ? colors.successGreen
                                : colors.gold,
                            }}
                          />
                        </View>

                        {/* Episode badge for TV */}
                        {p.mediaType === "tv" &&
                          p.season != null &&
                          p.episode != null && (
                            <View
                              style={{
                                position: "absolute",
                                top: 4,
                                left: 4,
                                backgroundColor: colors.black75,
                                borderRadius: 3,
                                paddingHorizontal: 4,
                                paddingVertical: 1,
                              }}
                            >
                              <Text className="text-white text-[9px] font-bold">
                                S{p.season}:E{p.episode}
                              </Text>
                            </View>
                          )}

                        {/* Provider label */}
                        {p.providerId ? (
                          <View
                            style={{
                              position: "absolute",
                              bottom: 6,
                              left: 4,
                              backgroundColor: colors.goldBadge,
                              borderRadius: 3,
                              paddingHorizontal: 4,
                              paddingVertical: 1,
                              maxWidth: cardWidth - 8,
                            }}
                          >
                            <Text
                              className="text-primary text-[8px] font-bold"
                              numberOfLines={1}
                            >
                              {providerLabelMap[p.providerId] ?? p.providerId}
                            </Text>
                          </View>
                        ) : null}

                        {/* Completed badge */}
                        {item.fullyWatched && (
                          <View
                            style={{
                              position: "absolute",
                              top: 4,
                              right: 4,
                              backgroundColor: colors.greenBadge,
                              borderRadius: 10,
                              width: 18,
                              height: 18,
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Ionicons name="checkmark" size={12} color="#fff" />
                          </View>
                        )}
                      </View>
                      <Text
                        className="text-text-secondary text-[11px] mt-1.5"
                        numberOfLines={1}
                      >
                        {title || `ID: ${p.tmdbId}`}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
              />
            </View>
          )}

          {/* ── Downloads ── */}
          <View className="mb-6">
            <SectionHeader
              title="Downloads"
              onSeeAll={
                downloadPreviews.length > 0
                  ? () => nav.push("/downloads")
                  : undefined
              }
            />
            {downloadPreviews.length > 0 ? (
              <View className="flex-row px-4" style={{ gap: CARD_GAP }}>
                {downloadPreviews.slice(0, 3).map((task: DownloadTask) => {
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
                      activeOpacity={0.7}
                      style={{ width: cardWidth }}
                    >
                      <View
                        style={{ width: cardWidth, height: cardHeight }}
                        className="bg-elevated rounded-xl overflow-hidden"
                      >
                        {meta?.poster_path ? (
                          <ProgressiveImage
                            uri={getImageUrl(meta.poster_path, "w342")}
                            style={{ width: cardWidth, height: cardHeight }}
                            resizeMode="cover"
                          />
                        ) : task.posterPath ? (
                          <ProgressiveImage
                            uri={getImageUrl(task.posterPath, "w342")}
                            style={{ width: cardWidth, height: cardHeight }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            className="flex-1 items-center justify-center"
                            style={{ backgroundColor: colors.bgTop }}
                          >
                            <Ionicons
                              name="download-outline"
                              size={24}
                              color={colors.gold}
                            />
                          </View>
                        )}

                        {/* Status badge */}
                        {isActive && (
                          <View
                            style={{
                              position: "absolute",
                              top: 4,
                              left: 4,
                              backgroundColor: colors.goldBadgeSolid,
                              borderRadius: 3,
                              paddingHorizontal: 4,
                              paddingVertical: 1,
                            }}
                          >
                            <Text className="text-void text-[9px] font-bold">
                              Downloading
                            </Text>
                          </View>
                        )}
                        {isPaused && (
                          <View
                            style={{
                              position: "absolute",
                              top: 4,
                              left: 4,
                              backgroundColor: "rgba(255,255,255,0.2)",
                              borderRadius: 3,
                              paddingHorizontal: 4,
                              paddingVertical: 1,
                            }}
                          >
                            <Text className="text-white text-[9px] font-bold">
                              Paused
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text
                        className="text-text-secondary text-[11px] mt-1.5"
                        numberOfLines={1}
                      >
                        {task.title || `ID: ${task.tmdbId}`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => nav.push("/downloads")}
                activeOpacity={0.7}
                className="mx-4"
              >
                <View
                  className="rounded-xl items-center justify-center py-8 px-4"
                  style={{
                    backgroundColor: colors.bgSurface,
                    borderWidth: 0.5,
                    borderColor: colors.bgTop,
                  }}
                >
                  <Ionicons
                    name="download-outline"
                    size={32}
                    color={colors.iconMuted}
                  />
                  <Text
                    className="text-zinc-500 text-sm mt-3 text-center"
                    style={{ fontFamily: "Inter_500Medium" }}
                  >
                    No downloads yet
                  </Text>
                  <Text className="text-zinc-600 text-xs mt-1 text-center">
                    Your downloaded movies and shows will appear here.{"\n"}Tap
                    to start downloading.
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          </View>

          {/* ── Saved / Bookmarks ── */}
          {bookmarks.length > 0 && (
            <View className="mb-6">
              <SectionHeader
                title="Saved"
                onSeeAll={() => nav.push("/saved")}
              />
              <View className="flex-row px-4" style={{ gap: CARD_GAP }}>
                {bookmarks.slice(0, 3).map((b) => {
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
                      activeOpacity={0.7}
                      style={{ width: cardWidth }}
                    >
                      <View
                        style={{ width: cardWidth, height: cardHeight }}
                        className="bg-elevated rounded-xl overflow-hidden"
                      >
                        {poster ? (
                          <ProgressiveImage
                            uri={getImageUrl(poster, "w342")}
                            style={{ width: cardWidth, height: cardHeight }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            className="flex-1 items-center justify-center"
                            style={{ backgroundColor: colors.bgTop }}
                          >
                            <Ionicons
                              name="bookmark-outline"
                              size={24}
                              color={colors.successGreen}
                            />
                          </View>
                        )}
                      </View>
                      <Text
                        className="text-text-secondary text-[11px] mt-1.5"
                        numberOfLines={1}
                      >
                        {b.title || `ID: ${b.tmdbId}`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* ── History ── */}
          {historyEntries.length > 0 && (
            <View className="mb-6">
              <SectionHeader
                title="History"
                onSeeAll={() => nav.push("/history")}
              />
              <View
                className="mx-4 rounded-xl overflow-hidden"
                style={{
                  backgroundColor: colors.bgSurface,
                  borderWidth: 0.5,
                  borderColor: colors.bgTop,
                }}
              >
                {historyEntries
                  .slice(0, 5)
                  .map((item, idx) => {
                    const p = item.latest;
                    const meta = historyMeta[p.tmdbId];
                    const title =
                      (p.mediaType === "tv" ? meta?.name : meta?.title) ??
                      "Unknown";
                    const poster = meta?.poster_path;

                    return (
                      <TouchableOpacity
                        key={`${p.mediaType}:${p.tmdbId}`}
                        onPress={() => handleHistoryPress(p)}
                        activeOpacity={0.7}
                        className="flex-row items-center px-4 py-3"
                        style={{ backgroundColor: colors.bgCard }}
                      >
                        {poster ? (
                          <ProgressiveImage
                            uri={getImageUrl(poster, "w92")}
                            style={{ width: 40, height: 60, borderRadius: 4 }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            className="w-10 h-[60px] rounded items-center justify-center"
                            style={{ backgroundColor: colors.bgTop }}
                          >
                            <Ionicons
                              name={p.mediaType === "tv" ? "tv" : "film"}
                              size={18}
                              color={colors.iconMuted}
                            />
                          </View>
                        )}
                        <View className="flex-1 ml-3">
                          <Text
                            className="text-zinc-200 text-sm font-bold"
                            numberOfLines={1}
                            style={{ fontFamily: "Inter_600SemiBold" }}
                          >
                            {title}
                          </Text>
                          <Text className="text-zinc-500 text-xs mt-0.5">
                            {p.mediaType === "tv"
                              ? `S${p.season ?? "?"}:E${p.episode ?? "?"} · `
                              : ""}
                            {formatDate(p.updatedAt)}
                          </Text>
                        </View>
                        {item.fullyWatched && (
                          <Ionicons
                            name="checkmark-circle"
                            size={16}
                            color={colors.successGreen}
                            style={{ marginLeft: 8 }}
                          />
                        )}
                        <ForwardIcon
                          width={14}
                          height={14}
                          color={colors.iconMuted}
                        />
                      </TouchableOpacity>
                    );
                  })
                  .reduce((acc, elem, i, arr) => {
                    if (i > 0) {
                      acc.push(
                        <View
                          key={`div-${i}`}
                          className="h-[1px] mx-4"
                          style={{ backgroundColor: colors.bgActiveDrag }}
                        />,
                      );
                    }
                    acc.push(elem);
                    return acc;
                  }, [] as React.ReactNode[])}
              </View>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}
