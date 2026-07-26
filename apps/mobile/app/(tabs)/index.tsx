import React, { useCallback, useRef, useState, useEffect } from "react";
import {
  View,
  ScrollView,
  RefreshControl,
  Text,
  ActivityIndicator,
  useWindowDimensions,
  FlatList,
  TouchableOpacity,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ForwardIcon } from "../../components/Icons";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Hero } from "../../components/Hero";
import { MediaCarousel } from "../../components/MediaCarousel";
import { ProgressiveImage } from "../../components/ProgressiveImage";
import {
  useTrendingMovies,
  useTrendingTV,
  usePopularMovies,
  useMoreLikeThis,
} from "../../hooks/useTMDB";
import { tmdbApi } from "../../lib/api";
import { useDownloadList } from "../../lib/download";
import { getAggregatedHistory } from "../../lib/watchHistory";
import { getImageUrl, PROVIDERS } from "@filmsnaps/shared";
import type { Movie } from "@filmsnaps/shared";
import type { WatchProgress } from "../../lib/watchHistory";
import NetInfo from "@react-native-community/netinfo";

const SKELETON_ITEMS = 3;

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const refreshing = useRef(false);

  const {
    data: trendingMovies,
    refetch: refetchMovies,
    isLoading: loadingMovies,
    isFetching: fetchingMovies,
  } = useTrendingMovies();
  const {
    data: trendingTV,
    refetch: refetchTV,
    isLoading: loadingTV,
    isFetching: fetchingTV,
  } = useTrendingTV();
  const {
    data: popularMovies,
    refetch: refetchPopular,
    isLoading: loadingPopular,
    isFetching: fetchingPopular,
  } = usePopularMovies();

  // ── History entries (must be declared before useMoreLikeThis) ──
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

  // ── Offline detection ──
  const [isOffline, setIsOffline] = useState(false);
  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => {
      setIsOffline(!s.isConnected && !s.isInternetReachable);
    });
    return () => unsub();
  }, []);

  // More Like This — genre-based recommendations from last-watched item
  const { data: moreLikeThis } = useMoreLikeThis(historyEntries);

  // Curate hero: prefer quality content with good ratings and enough votes
  const heroItem = React.useMemo(() => {
    const results = trendingMovies?.results ?? [];
    const curated = results.find(
      (m: Movie) =>
        (m.vote_average ?? 0) >= 7.0 &&
        (m.vote_count ?? 0) >= 500 &&
        m.backdrop_path,
    );
    return curated ?? results[0];
  }, [trendingMovies]);

  // â”€â”€ Skeleton card dimensions (matches MediaCarousel) â”€â”€
  const itemWidth = (SCREEN_WIDTH - 48) / 3;
  const itemHeight = itemWidth * 1.5;

  // â”€â”€ Pull-to-refresh â”€â”€
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  // â”€â”€ History entries â”€â”€
  const { active: activeDownloads } = useDownloadList();

  // Stable reference for contentContainerStyle — prevents ScrollView re-mount on re-render
  const bannerHeight = 48;
  const tabBarHeight = 72;
  const bottomPadding = Math.max(insets.bottom, 8);
  const scrollBottomPadding =
    activeDownloads.length > 0
      ? tabBarHeight + bannerHeight + 16 + bottomPadding
      : tabBarHeight + 16 + bottomPadding;
  const scrollPaddingStyle = useRef({
    paddingBottom: scrollBottomPadding,
  }).current;

  // Provider display name lookup for Continue Watching

  const providerLabelMap = useRef<Record<string, string>>({});
  if (Object.keys(providerLabelMap.current).length === 0) {
    for (const p of PROVIDERS) {
      providerLabelMap.current[p.id] = p.displayName ?? p.name;
    }
  }

  const loadHistory = useCallback(async () => {
    if (historyLoadedRef.current) return;
    try {
      const agg = await getAggregatedHistory();
      // Take last 6 for the home page
      const sliced = agg.slice(0, 6);
      setHistoryEntries(sliced);
      // Fetch TMDB metadata
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
      historyLoadedRef.current = true;
    } catch {}
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const onRefresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    setIsRefreshing(true);
    // Fire all refetches independently â€” sections pop in as they arrive
    refetchMovies();
    refetchTV();
    refetchPopular();
    // Reload history
    historyLoadedRef.current = false;
    setHistoryEntries([]);
    loadHistory();
    // Wait a bit then hide the indicator (content updates progressively)
    setTimeout(() => {
      setIsRefreshing(false);
      refreshing.current = false;
    }, 1500);
  }, [refetchMovies, refetchTV, refetchPopular, loadHistory]);

  // â”€â”€ Navigation â”€â”€

  const handleSeeAllTrendingMovies = useCallback(() => {
    router.push("/list/trending-movies");
  }, [router]);

  const handleSeeAllTrendingTV = useCallback(() => {
    router.push("/list/trending-tv");
  }, [router]);

  const handleSeeAllPopularMovies = useCallback(() => {
    router.push("/list/popular-movies");
  }, [router]);

  const handleMoviePress = useCallback(
    (item: Movie) => {
      const mediaType = item.media_type || "movie";
      const id = item.id;

      if (mediaType === "tv") {
        queryClient.prefetchQuery({
          queryKey: ["tv", id],
          queryFn: () => tmdbApi.getTVDetails(id),
          staleTime: 1000 * 60 * 60,
        });
        router.prefetch(`/tv/${id}`);
        router.push(`/tv/${id}`);
      } else {
        queryClient.prefetchQuery({
          queryKey: ["movie", id],
          queryFn: () => tmdbApi.getMovieDetails(id),
          staleTime: 1000 * 60 * 60,
        });
        router.prefetch(`/movie/${id}`);
        router.push(`/movie/${id}`);
      }
    },
    [router, queryClient],
  );

  const handleWatchPress = useCallback(
    (item: Movie) => {
      router.push(`/watch/movie/${item.id}`);
    },
    [router],
  );

  if (loadingMovies && loadingTV && loadingPopular) {
    return (
      <View
        className="flex-1 bg-void"
        style={{ paddingTop: insets.top, backgroundColor: "#070708" }}
      >
        {/* Hero skeleton */}
        <View
          style={{
            width: SCREEN_WIDTH,
            height: SCREEN_WIDTH * 0.56,
            backgroundColor: "#141414",
          }}
        />
        {/* Sections skeleton */}
        {[1, 2].map((s) => (
          <View key={s} className="mb-6 px-4 mt-4">
            <View
              className="w-36 h-5 bg-subtle rounded"
              style={{ backgroundColor: "#1C1C20" }}
            />
            <View className="flex-row mt-3" style={{ gap: 10 }}>
              {Array.from({ length: SKELETON_ITEMS }).map((_, i) => (
                <View
                  key={i}
                  style={{
                    width: itemWidth,
                    height: itemHeight,
                    borderRadius: 12,
                    backgroundColor: "#1C1C20",
                  }}
                />
              ))}
            </View>
          </View>
        ))}
      </View>
    );
  }

  return (
    <View
      className="flex-1 bg-void"
      style={{ paddingTop: insets.top, backgroundColor: "#070708" }}
    >
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
        contentContainerStyle={scrollPaddingStyle}
      >
        {/* Header */}
        <View className="px-5 py-4 flex-row items-center justify-between">
          <View className="flex-row items-center">
            <Image
              source={require("../../assets/icon.png")}
              style={{ width: 36, height: 36, borderRadius: 12 }}
              accessibilityLabel="FilmSnaps logo"
            />
            <View className="ml-3">
              <Text
                style={{
                  fontFamily: "PlayfairDisplay_700Bold",
                  fontSize: 20,
                  color: "#D4A237",
                }}
              >
                FilmSnaps
              </Text>
              <Text
                className="text-text-secondary text-xs"
                style={{ color: "#A1A1AA" }}
              >
                Discover & Watch
              </Text>
            </View>
          </View>
        </View>

        {/* ── Offline Hero Rail ── */}
        {isOffline ? (
          <View className="mb-6 px-4">
            <View className="bg-zinc-900/80 rounded-2xl p-5 mb-4 border border-zinc-800">
              <View className="flex-row items-center mb-1">
                <Ionicons
                  name="cloud-offline-outline"
                  size={18}
                  color="#D4A237"
                  style={{ marginRight: 8 }}
                />
                <Text
                  style={{
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 15,
                    color: "#F4F4F5",
                  }}
                >
                  You're offline
                </Text>
              </View>
              <Text
                className="text-zinc-400 text-xs mb-3"
                style={{ marginLeft: 26 }}
              >
                Here's what's ready to watch
              </Text>
            </View>

            {completedDownloads.length > 0 ? (
              <View>
                <Text
                  className="text-text-primary text-lg font-bold mb-3"
                  style={{
                    fontFamily: "PlayfairDisplay_700Bold",
                    fontSize: 18,
                    color: "#F4F4F5",
                  }}
                >
                  Downloaded
                </Text>
                <View className="flex-row flex-wrap" style={{ gap: 10 }}>
                  {completedDownloads.slice(0, 6).map((d) => (
                    <TouchableOpacity
                      key={d.id}
                      onPress={() => router.push("/downloads")}
                      activeOpacity={0.7}
                      style={{ width: (SCREEN_WIDTH - 48 - 20) / 3 }}
                    >
                      <View
                        style={{
                          width: "100%",
                          aspectRatio: 2 / 3,
                          borderRadius: 10,
                          backgroundColor: "#1C1C20",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons
                          name="film-outline"
                          size={22}
                          color="#52525B"
                        />
                      </View>
                      <Text
                        className="text-zinc-400 text-[10px] mt-1.5"
                        numberOfLines={1}
                      >
                        {d.title || d.fileName}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity
                  onPress={() => router.push("/downloads")}
                  className="mt-3"
                  activeOpacity={0.7}
                >
                  <Text
                    style={{
                      color: "#D4A237",
                      fontSize: 12,
                      fontFamily: "Inter_500Medium",
                    }}
                  >
                    View all downloads →
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View className="items-center py-6">
                <Text
                  style={{
                    color: "#52525B",
                    fontSize: 13,
                    fontFamily: "Inter_400Regular",
                  }}
                >
                  No downloads ready
                </Text>
                <Text
                  style={{
                    color: "#3f3f3f",
                    fontSize: 11,
                    fontFamily: "Inter_400Regular",
                    marginTop: 2,
                  }}
                >
                  Download movies and shows when you're online
                </Text>
              </View>
            )}
          </View>
        ) : null}

        {/* Hero section â€” appears as soon as trendingMovies arrives */}
        {heroItem ? (
          <Hero item={heroItem} onWatchPress={handleWatchPress} />
        ) : !loadingMovies ? (
          <View
            className="w-full bg-elevated"
            style={{ height: SCREEN_WIDTH * 0.62 }}
          />
        ) : null}

        {/* Trending Movies â€” skeleton until data loads */}
        {trendingMovies ? (
          <MediaCarousel
            title="Trending Movies"
            data={trendingMovies.results ?? []}
            onItemPress={handleMoviePress}
            onSeeAll={handleSeeAllTrendingMovies}
          />
        ) : (
          <View className="mb-6 px-4">
            <View className="w-36 h-5 bg-subtle rounded mb-3" />
            <View className="flex-row" style={{ gap: 10 }}>
              {Array.from({ length: SKELETON_ITEMS }).map((_, i) => (
                <View
                  key={i}
                  className="bg-subtle rounded-xl"
                  style={{ width: itemWidth, height: itemHeight }}
                />
              ))}
            </View>
          </View>
        )}

        {/* Trending TV */}
        {trendingTV ? (
          <MediaCarousel
            title="Trending TV"
            data={trendingTV.results ?? []}
            onItemPress={handleMoviePress}
            onSeeAll={handleSeeAllTrendingTV}
          />
        ) : (
          <View className="mb-6 px-4">
            <View className="w-36 h-5 bg-subtle rounded mb-3" />
            <View className="flex-row" style={{ gap: 10 }}>
              {Array.from({ length: SKELETON_ITEMS }).map((_, i) => (
                <View
                  key={i}
                  className="bg-subtle rounded-xl"
                  style={{ width: itemWidth, height: itemHeight }}
                />
              ))}
            </View>
          </View>
        )}

        {/* More Like This — genre-based recs from last-watched item */}
        {moreLikeThis?.length > 0 && (
          <MediaCarousel
            title="More Like This"
            data={moreLikeThis}
            onItemPress={handleMoviePress}
          />
        )}

        {/* Continue Watching / History */}
        {historyEntries.length > 0 && (
          <View className="mb-6">
            <View className="flex-row items-center justify-between px-4 mb-3">
              <Text
                className="text-text-primary text-lg font-bold"
                style={{
                  fontFamily: "PlayfairDisplay_700Bold",
                  fontSize: 20,
                  color: "#F4F4F5",
                }}
              >
                Continue Watching
              </Text>
              <TouchableOpacity
                onPress={() => router.push("/history")}
                activeOpacity={0.7}
                style={{ flexDirection: "row", alignItems: "center" }}
              >
                <Text className="text-primary text-xs font-semibold">
                  See All
                </Text>
                <ForwardIcon
                  width={12}
                  height={12}
                  color="#D4A237"
                  style={{ marginLeft: 4 }}
                />
              </TouchableOpacity>
            </View>
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
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
                const cardWidth = (SCREEN_WIDTH - 48) / 3;
                const cardHeight = cardWidth * 1.5;

                return (
                  <TouchableOpacity
                    onPress={() => {
                      if (p.mediaType === "tv") {
                        router.push(
                          `/watch/tv/${p.tmdbId}/${p.season ?? 1}/${p.episode ?? 1}`,
                        );
                      } else {
                        router.push(`/watch/movie/${p.tmdbId}`);
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
                            name={p.mediaType === "tv" ? "tv" : "film"}
                            size={24}
                            color="#3f3f3f"
                          />
                        </View>
                      )}
                      {/* Progress bar at bottom */}
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
                            {providerLabelMap.current[p.providerId] ??
                              p.providerId}
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

        {/* Popular Movies */}
        {popularMovies ? (
          <MediaCarousel
            title="Popular Movies"
            data={popularMovies.results ?? []}
            onItemPress={handleMoviePress}
            onSeeAll={handleSeeAllPopularMovies}
          />
        ) : (
          <View className="mb-6 px-4">
            <View className="w-36 h-5 bg-subtle rounded mb-3" />
            <View className="flex-row" style={{ gap: 10 }}>
              {Array.from({ length: SKELETON_ITEMS }).map((_, i) => (
                <View
                  key={i}
                  className="bg-subtle rounded-xl"
                  style={{ width: itemWidth, height: itemHeight }}
                />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
