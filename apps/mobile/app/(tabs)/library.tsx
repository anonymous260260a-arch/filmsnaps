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
import { useRouter } from "expo-router";
import { useDownloadList } from "../../lib/download";
import { getAllBookmarks } from "../../lib/bookmarks";
import { getAggregatedHistory } from "../../lib/watchHistory";
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
                color: "#D4A237",
              }}
            >
              See All
            </Text>
            <ForwardIcon width={14} height={14} color="#D4A237" />
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
  const router = useRouter();
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

  // ── History / Continue Watching ──
  const [historyEntries, setHistoryEntries] = useState<
    Array<{
      latest: WatchProgress;
      fullyWatched: boolean;
    }>
  >([]);
  const [historyMeta, setHistoryMeta] = useState<Record<string, Movie | null>>(
    {},
  );
  const historyLoadedRef = useRef(false);

  // ── Bookmarks / Saved ──
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkMeta, setBookmarkMeta] = useState<
    Record<string, Movie | null>
  >({});
  const bookmarksLoadedRef = useRef(false);

  // ── Refresh ──
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  // ── Load history ──
  const loadHistory = useCallback(async () => {
    if (historyLoadedRef.current && !refreshingRef.current) return;
    try {
      const agg = await getAggregatedHistory();
      const sliced = agg.slice(0, 6);
      setHistoryEntries(sliced);
      const metaMap: Record<string, Movie | null> = {};
      await Promise.all(
        sliced.map(async (entry) => {
          const id = entry.latest.tmdbId;
          if (metaMap[id]) return;
          try {
            if (entry.latest.mediaType === "tv") {
              metaMap[id] = (await tmdbApi.getTVDetails(
                Number(id),
              )) as unknown as Movie;
            } else {
              metaMap[id] = (await tmdbApi.getMovieDetails(
                Number(id),
              )) as Movie;
            }
          } catch {
            metaMap[id] = null;
          }
        }),
      );
      setHistoryMeta((prev) => ({ ...prev, ...metaMap }));
    } catch {}
    historyLoadedRef.current = true;
  }, []);

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
    loadHistory();
  }, [loadHistory]);
  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  // ── Pull-to-refresh ──
  const onRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshing(true);

    historyLoadedRef.current = false;
    bookmarksLoadedRef.current = false;
    setHistoryEntries([]);
    setBookmarks([]);
    loadHistory();
    loadBookmarks();

    setTimeout(() => {
      setIsRefreshing(false);
      refreshingRef.current = false;
    }, 1500);
  }, [loadHistory, loadBookmarks]);

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
        router.push(`/tv/${id}`);
      } else {
        router.push(`/movie/${id}`);
      }
    },
    [router],
  );

  const handleHistoryPress = useCallback(
    (p: WatchProgress) => {
      if (p.mediaType === "tv") {
        router.push(`/watch/tv/${p.tmdbId}/${p.season ?? 1}/${p.episode ?? 1}`);
      } else {
        router.push(`/watch/movie/${p.tmdbId}`);
      }
    },
    [router],
  );

  return (
    <View
      className="flex-1 bg-void"
      style={{ paddingTop: insets.top, backgroundColor: "#070708" }}
    >
      {/* Header */}
      <View className="px-5 pt-4 pb-3 flex-row items-center justify-between">
        <Text
          style={{
            fontFamily: "PlayfairDisplay_700Bold",
            fontSize: 22,
            color: "#F4F4F5",
          }}
        >
          Library
        </Text>
        <TouchableOpacity
          onPress={() => router.push("/settings")}
          activeOpacity={0.7}
          accessibilityLabel="Settings"
          className="w-9 h-9 rounded-full items-center justify-center"
          style={{ backgroundColor: "#1C1C20" }}
        >
          <Ionicons name="settings-outline" size={18} color="#A1A1AA" />
        </TouchableOpacity>
      </View>

      {/* Offline banner */}
      {isOffline && (
        <View
          className="mx-4 mb-3 flex-row items-center px-3 py-2 rounded-lg"
          style={{
            backgroundColor: "rgba(212,162,55,0.1)",
            borderWidth: 0.5,
            borderColor: "rgba(212,162,55,0.2)",
          }}
        >
          <Ionicons
            name="cloud-offline-outline"
            size={14}
            color="#D4A237"
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
              tintColor="#D4A237"
              colors={["#D4A237"]}
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
                onSeeAll={() => router.push("/history")}
              />
              <FlatList
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
                            uri={getImageUrl(poster, "w185")}
                            style={{ width: cardWidth, height: cardHeight }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            className="flex-1 items-center justify-center"
                            style={{ backgroundColor: "#1f1f1f" }}
                          >
                            <Ionicons
                              name={p.mediaType === "tv" ? "tv" : "film"}
                              size={24}
                              color="#3f3f3f"
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
                                ? "#22c55e"
                                : "#D4A237",
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
                                backgroundColor: "rgba(0,0,0,0.75)",
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
                              backgroundColor: "rgba(212,162,55,0.2)",
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
                              backgroundColor: "rgba(34,197,94,0.85)",
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
                  ? () => router.push("/downloads")
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
                      onPress={() => router.push("/downloads")}
                      activeOpacity={0.7}
                      style={{ width: cardWidth }}
                    >
                      <View
                        style={{ width: cardWidth, height: cardHeight }}
                        className="bg-elevated rounded-xl overflow-hidden"
                      >
                        {meta?.poster_path ? (
                          <ProgressiveImage
                            uri={getImageUrl(meta.poster_path, "w185")}
                            style={{ width: cardWidth, height: cardHeight }}
                            resizeMode="cover"
                          />
                        ) : task.posterPath ? (
                          <ProgressiveImage
                            uri={getImageUrl(task.posterPath, "w185")}
                            style={{ width: cardWidth, height: cardHeight }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            className="flex-1 items-center justify-center"
                            style={{ backgroundColor: "#1f1f1f" }}
                          >
                            <Ionicons
                              name="download-outline"
                              size={24}
                              color="#D4A237"
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
                              backgroundColor: "rgba(212,162,55,0.85)",
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
                onPress={() => router.push("/downloads")}
                activeOpacity={0.7}
                className="mx-4"
              >
                <View
                  className="rounded-xl items-center justify-center py-8 px-4"
                  style={{
                    backgroundColor: "#0E0E11",
                    borderWidth: 0.5,
                    borderColor: "#1f1f1f",
                  }}
                >
                  <Ionicons name="download-outline" size={32} color="#3f3f3f" />
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
                onSeeAll={() => router.push("/saved")}
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
                          router.push(`/tv/${b.tmdbId}`);
                        } else {
                          router.push(`/movie/${b.tmdbId}`);
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
                            uri={getImageUrl(poster, "w185")}
                            style={{ width: cardWidth, height: cardHeight }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            className="flex-1 items-center justify-center"
                            style={{ backgroundColor: "#1f1f1f" }}
                          >
                            <Ionicons
                              name="bookmark-outline"
                              size={24}
                              color="#22c55e"
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
                onSeeAll={() => router.push("/history")}
              />
              <View
                className="mx-4 rounded-xl overflow-hidden"
                style={{
                  backgroundColor: "#0E0E11",
                  borderWidth: 0.5,
                  borderColor: "#1f1f1f",
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
                        style={{ backgroundColor: "#141414" }}
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
                            style={{ backgroundColor: "#1f1f1f" }}
                          >
                            <Ionicons
                              name={p.mediaType === "tv" ? "tv" : "film"}
                              size={18}
                              color="#3f3f3f"
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
                            color="#22c55e"
                            style={{ marginLeft: 8 }}
                          />
                        )}
                        <ForwardIcon width={14} height={14} color="#3f3f3f" />
                      </TouchableOpacity>
                    );
                  })
                  .reduce((acc, elem, i, arr) => {
                    if (i > 0) {
                      acc.push(
                        <View
                          key={`div-${i}`}
                          className="h-[1px] mx-4"
                          style={{ backgroundColor: "#1a1a1e" }}
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
