import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
import {
  View,
  ScrollView,
  RefreshControl,
  Text,
  ActivityIndicator,
  useWindowDimensions,
  TouchableOpacity,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSafeNavigation } from "@/lib/navigation";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Hero } from "../../components/Hero";
import { MediaCarousel } from "../../components/MediaCarousel";
import { ProgressiveImage } from "../../components/ProgressiveImage";
import { Shimmer } from "../../components/Shimmer";
import { SeeAllButton } from "../../components/SeeAllButton";
import { DeferredContent } from "../../components/DeferredContent";
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
import type { Announcement } from "../../lib/announcements";
import {
  fetchAnnouncements,
  dismissAnnouncement,
} from "../../lib/announcements";
import { AnnouncementBanner } from "../../components/AnnouncementBanner";
import NetInfo from "@react-native-community/netinfo";
import { useSettings } from "../../lib/settings";
import { colors } from "../../theme/colors";
import { typography } from "../../theme/typography";
import { SwipeExemptScrollView } from "../../components/SwipeExemptScroll";

const SKELETON_ITEMS = 3;

// ── Module-level constants (never rebuilt per render) ──
const PROVIDER_LABELS: Record<string, string> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p.displayName ?? p.name]),
);

const SECTION_CONFIG: Record<string, { label: string }> = {
  "trending-movies": { label: "Trending Movies" },
  "trending-tv": { label: "Trending TV" },
  "more-like-this": { label: "More Like This" },
  "continue-watching": { label: "Continue Watching" },
  "popular-movies": { label: "Popular Movies" },
};

export default function HomeScreen() {
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const refreshing = useRef(false);

  const {
    data: trendingMovies,
    refetch: refetchMovies,
    isLoading: loadingMovies,
  } = useTrendingMovies();
  const {
    data: trendingTV,
    refetch: refetchTV,
    isLoading: loadingTV,
  } = useTrendingTV();
  const {
    data: popularMovies,
    refetch: refetchPopular,
    isLoading: loadingPopular,
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

  // ── Announcements (loaded with lowest priority, never blocks UI) ──
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const announcementsFetchedRef = useRef(false);

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
  const heroItem = useMemo(() => {
    const results = trendingMovies?.results ?? [];
    const curated = results.find(
      (m: Movie) =>
        (m.vote_average ?? 0) >= 7.0 &&
        (m.vote_count ?? 0) >= 500 &&
        m.backdrop_path,
    );
    return curated ?? results[0];
  }, [trendingMovies]);

  // ── Skeleton card dimensions (matches MediaCarousel) ──
  const itemWidth = useMemo(() => (SCREEN_WIDTH - 48) / 3, [SCREEN_WIDTH]);
  const itemHeight = useMemo(() => itemWidth * 1.5, [itemWidth]);

  // ── Pull-to-refresh ──
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ── Settings ──
  const { settings } = useSettings();
  const { active: activeDownloads, completed: completedDownloads } =
    useDownloadList();

  // ── Scroll padding (useMemo instead of useRef so it updates reactively) ──
  const bannerHeight = 48;
  const tabBarHeight = 72;
  const bottomPadding = Math.max(insets.bottom, 8);
  const scrollPaddingStyle = useMemo(
    () => ({
      paddingBottom:
        activeDownloads.length > 0
          ? tabBarHeight + bannerHeight + 16 + bottomPadding
          : tabBarHeight + 16 + bottomPadding,
    }),
    [activeDownloads.length, bottomPadding],
  );

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
    } catch (e) {
      console.warn("[Home] loadHistory failed:", e);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // ── Fetch announcements (lowest priority — deferred until after main data) ──
  useEffect(() => {
    if (announcementsFetchedRef.current) return;
    announcementsFetchedRef.current = true;

    // Use a microtask delay so announcements never compete with initial hero/sections
    const handle = requestAnimationFrame(() => {
      setTimeout(async () => {
        try {
          const result = await fetchAnnouncements();
          if (result.length > 0) {
            setAnnouncements(result);
          }
        } catch {
          // Silent — never block UI
        }
      }, 1500); // 1.5s delay to let everything else load first
    });

    return () => cancelAnimationFrame(handle);
  }, []);

  const handleDismissAnnouncement = useCallback((id: string) => {
    dismissAnnouncement(id).catch(() => {});
    setAnnouncements((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const onRefresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    setIsRefreshing(true);

    historyLoadedRef.current = false;
    setHistoryEntries([]);

    // Wait for actual completion instead of a hardcoded timeout
    await Promise.allSettled([
      refetchMovies(),
      refetchTV(),
      refetchPopular(),
      loadHistory(),
    ]);

    // Also refresh announcements in background
    try {
      const fresh = await fetchAnnouncements({ force: true });
      setAnnouncements(fresh);
    } catch {}

    setIsRefreshing(false);
    refreshing.current = false;
  }, [refetchMovies, refetchTV, refetchPopular, loadHistory]);

  // ── Navigation ──
  const handleSeeAllTrendingMovies = useCallback(() => {
    nav.push("/list/trending-movies");
  }, [nav]);

  const handleSeeAllTrendingTV = useCallback(() => {
    nav.push("/list/trending-tv");
  }, [nav]);

  const handleSeeAllPopularMovies = useCallback(() => {
    nav.push("/list/popular-movies");
  }, [nav]);

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
        nav.push(`/tv/${id}`);
      } else {
        queryClient.prefetchQuery({
          queryKey: ["movie", id],
          queryFn: () => tmdbApi.getMovieDetails(id),
          staleTime: 1000 * 60 * 60,
        });
        nav.push(`/movie/${id}`);
      }
    },
    [nav, queryClient],
  );

  const handleWatchPress = useCallback(
    (item: Movie) => {
      nav.push(`/watch/movie/${item.id}`);
    },
    [nav],
  );

  // ── Memoised section ordering ──
  const orderedSections = useMemo(() => {
    const order: Record<string, number> = {};
    settings.homeRowOrder.forEach((id: string, i: number) => {
      order[id] = i;
    });
    return Object.keys(SECTION_CONFIG).sort(
      (a, b) => (order[a] ?? 999) - (order[b] ?? 999),
    );
  }, [settings.homeRowOrder]);

  // ── Render each section ──
  const renderSection = useCallback(
    (id: string) => {
      switch (id) {
        case "trending-movies":
          return trendingMovies ? (
            <MediaCarousel
              title={SECTION_CONFIG["trending-movies"].label}
              data={trendingMovies.results ?? []}
              onItemPress={handleMoviePress}
              onSeeAll={handleSeeAllTrendingMovies}
            />
          ) : (
            <View className="mb-6 px-4">
              <Shimmer
                width={144}
                height={20}
                borderRadius={4}
                style={{ marginBottom: 12 }}
              />
              <View className="flex-row" style={{ gap: 10 }}>
                {Array.from({ length: SKELETON_ITEMS }).map((_, i) => (
                  <Shimmer
                    key={i}
                    width={itemWidth}
                    height={itemHeight}
                    borderRadius={12}
                  />
                ))}
              </View>
            </View>
          );

        case "trending-tv":
          return trendingTV ? (
            <MediaCarousel
              title={SECTION_CONFIG["trending-tv"].label}
              data={trendingTV.results ?? []}
              onItemPress={handleMoviePress}
              onSeeAll={handleSeeAllTrendingTV}
            />
          ) : (
            <View className="mb-6 px-4">
              <Shimmer
                width={144}
                height={20}
                borderRadius={4}
                style={{ marginBottom: 12 }}
              />
              <View className="flex-row" style={{ gap: 10 }}>
                {Array.from({ length: SKELETON_ITEMS }).map((_, i) => (
                  <Shimmer
                    key={i}
                    width={itemWidth}
                    height={itemHeight}
                    borderRadius={12}
                  />
                ))}
              </View>
            </View>
          );

        case "more-like-this":
          return moreLikeThis?.length > 0 ? (
            <DeferredContent fallback={null} delayMs={200}>
              <MediaCarousel
                title={SECTION_CONFIG["more-like-this"].label}
                data={moreLikeThis}
                onItemPress={handleMoviePress}
              />
            </DeferredContent>
          ) : null;

        case "continue-watching":
          return historyEntries.length > 0 ? (
            <DeferredContent fallback={null} delayMs={400}>
              <ContinueWatchingSection
                historyEntries={historyEntries}
                historyMeta={historyMeta}
                nav={nav}
                SCREEN_WIDTH={SCREEN_WIDTH}
                providerLabelMap={PROVIDER_LABELS}
              />
            </DeferredContent>
          ) : null;

        case "popular-movies":
          return popularMovies ? (
            <DeferredContent fallback={null} delayMs={600}>
              <MediaCarousel
                title={SECTION_CONFIG["popular-movies"].label}
                data={popularMovies.results ?? []}
                onItemPress={handleMoviePress}
                onSeeAll={handleSeeAllPopularMovies}
              />
            </DeferredContent>
          ) : (
            <View className="mb-6 px-4">
              <Shimmer
                width={144}
                height={20}
                borderRadius={4}
                style={{ marginBottom: 12 }}
              />
              <View className="flex-row" style={{ gap: 10 }}>
                {Array.from({ length: SKELETON_ITEMS }).map((_, i) => (
                  <Shimmer
                    key={i}
                    width={itemWidth}
                    height={itemHeight}
                    borderRadius={12}
                  />
                ))}
              </View>
            </View>
          );

        default:
          return null;
      }
    },
    [
      trendingMovies,
      trendingTV,
      popularMovies,
      moreLikeThis,
      historyEntries,
      historyMeta,
      handleMoviePress,
      handleSeeAllTrendingMovies,
      handleSeeAllTrendingTV,
      handleSeeAllPopularMovies,
      nav,
      SCREEN_WIDTH,
      itemWidth,
      itemHeight,
    ],
  );

  // ── Skeleton (full-screen when all three queries first load) ──
  if (loadingMovies && loadingTV && loadingPopular) {
    return (
      <View
        className="flex-1 bg-void"
        style={{ paddingTop: insets.top, backgroundColor: colors.bg }}
      >
        {/* Hero skeleton */}
        <View
          style={{
            width: SCREEN_WIDTH,
            height: SCREEN_WIDTH * 0.56,
            backgroundColor: colors.skeletonBgAlt,
          }}
        />
        {/* Sections skeleton */}
        {[1, 2].map((s) => (
          <View key={s} className="mb-6 px-4 mt-4">
            <Shimmer
              width={144}
              height={20}
              borderRadius={4}
              style={{ marginBottom: 12 }}
            />
            <View className="flex-row mt-3" style={{ gap: 10 }}>
              {Array.from({ length: SKELETON_ITEMS }).map((_, i) => (
                <Shimmer
                  key={i}
                  width={itemWidth}
                  height={itemHeight}
                  borderRadius={12}
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
      style={{ paddingTop: insets.top, backgroundColor: colors.bg }}
    >
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
        contentContainerStyle={scrollPaddingStyle}
      >
        {/* ── Header with navigation affordances ── */}
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
                  color: colors.gold,
                }}
              >
                FilmSnaps
              </Text>
            </View>
          </View>

          {/* Right: Actions */}
          <View className="flex-row items-center" style={{ gap: 16 }}>
            <TouchableOpacity
              onPress={() => nav.push("/search")}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Search"
              accessibilityHint="Opens search screen"
            >
              <Ionicons
                name="search-outline"
                size={22}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => nav.push("/settings")}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              accessibilityHint="Opens settings screen"
            >
              <Ionicons
                name="settings-outline"
                size={22}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Offline Hero Rail ── */}
        {isOffline ? (
          <View className="mb-6 px-4">
            <View
              style={{
                borderRadius: 16,
                backgroundColor: "rgba(251,191,36,0.08)",
                borderWidth: 1,
                borderColor: "rgba(251,191,36,0.2)",
                padding: 20,
                marginBottom: 16,
              }}
            >
              <View className="flex-row items-center mb-1">
                <Ionicons
                  name="cloud-offline-outline"
                  size={18}
                  color={colors.offline}
                  style={{ marginRight: 8 }}
                />
                <Text
                  style={{
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 15,
                    color: colors.textPrimary,
                  }}
                >
                  You're offline
                </Text>
              </View>
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: 13,
                  lineHeight: 18,
                  marginTop: 2,
                }}
              >
                {completedDownloads.length > 0
                  ? `${completedDownloads.length} title${completedDownloads.length > 1 ? "s" : ""} ready to watch below.`
                  : "Connect to the internet to browse, or download titles ahead of time."}
              </Text>
            </View>

            {completedDownloads.length > 0 ? (
              <View>
                <Text
                  style={{
                    fontFamily: "PlayfairDisplay_700Bold",
                    fontSize: 18,
                    color: colors.textPrimary,
                    marginBottom: 12,
                  }}
                >
                  Downloaded
                </Text>
                <View className="flex-row flex-wrap" style={{ gap: 10 }}>
                  {completedDownloads.slice(0, 6).map((d) => (
                    <TouchableOpacity
                      key={d.id}
                      onPress={() => nav.push("/downloads")}
                      activeOpacity={0.7}
                      style={{ width: (SCREEN_WIDTH - 48 - 20) / 3 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${d.title || d.fileName} download`}
                    >
                      <View
                        style={{
                          width: "100%",
                          aspectRatio: 2 / 3,
                          borderRadius: 10,
                          backgroundColor: colors.bgElevated,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons
                          name="film-outline"
                          size={22}
                          color={colors.iconSecondary}
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
                  onPress={() => nav.push("/downloads")}
                  className="mt-3"
                  activeOpacity={0.7}
                >
                  <Text
                    style={{
                      color: colors.gold,
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
                    color: colors.textTertiary,
                    fontSize: 13,
                    fontFamily: "Inter_400Regular",
                  }}
                >
                  No downloads ready
                </Text>
                <Text
                  style={{
                    color: colors.textDisabled,
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

        {/* ── Hero — always first, never reordered ── */}
        {heroItem ? (
          <Hero item={heroItem} onWatchPress={handleWatchPress} />
        ) : !loadingMovies ? (
          <View
            className="w-full"
            style={{
              height: SCREEN_WIDTH * 0.62,
              backgroundColor: colors.skeletonBgAlt,
            }}
          />
        ) : null}

        {/* ── Announcements banner (non-blocking, between Hero and sections) ── */}
        {announcements.length > 0 && (
          <DeferredContent fallback={null} delayMs={100}>
            {announcements.map((ann) => (
              <AnnouncementBanner
                key={ann.id}
                announcement={ann}
                onDismiss={handleDismissAnnouncement}
              />
            ))}
          </DeferredContent>
        )}

        {/* ── Remaining sections ordered by settings.homeRowOrder ── */}
        {orderedSections.map((id) => (
          <View key={id}>{renderSection(id)}</View>
        ))}
      </ScrollView>
    </View>
  );
}

// ── Continue Watching Section (extracted to avoid nesting FlatList in ScrollView) ──

interface ContinueWatchingSectionProps {
  historyEntries: Array<{
    latest: WatchProgress;
    fullyWatched: boolean;
  }>;
  historyMeta: Record<string, Movie | null>;
  nav: ReturnType<typeof useSafeNavigation>;
  SCREEN_WIDTH: number;
  providerLabelMap: Record<string, string>;
}

function ContinueWatchingSection({
  historyEntries,
  historyMeta,
  nav,
  SCREEN_WIDTH,
  providerLabelMap,
}: ContinueWatchingSectionProps) {
  const cardWidth = (SCREEN_WIDTH - 48) / 3;
  const cardHeight = cardWidth * 1.5;

  return (
    <View className="mb-6">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 mb-3">
        <Text style={typography.heading}>Continue Watching</Text>
        <SeeAllButton onPress={() => nav.push("/history")} />
      </View>

      {/* Horizontal ScrollView — replaces FlatList to avoid nesting warning.
          Wrapped in SwipeExemptScrollView so swiping it scrolls the row
          instead of cycling tabs. */}
      <SwipeExemptScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
        accessibilityRole="list"
        accessibilityLabel="Continue watching items"
      >
        {historyEntries.map((item) => {
          const p = item.latest;
          const meta = historyMeta[p.tmdbId];
          const title = (p.mediaType === "tv" ? meta?.name : meta?.title) ?? "";
          const poster = meta?.poster_path;

          return (
            <TouchableOpacity
              key={`${p.mediaType}:${p.tmdbId}`}
              onPress={() => {
                if (p.mediaType === "tv") {
                  nav.push(
                    `/watch/tv/${p.tmdbId}/${p.season ?? 1}/${p.episode ?? 1}`,
                  );
                } else {
                  nav.push(`/watch/movie/${p.tmdbId}`);
                }
              }}
              activeOpacity={0.7}
              style={{ width: cardWidth }}
              accessibilityRole="button"
              accessibilityLabel={`Continue watching ${title}`}
              accessibilityHint={`Opens ${title} at your last watched position`}
            >
              <View style={{ width: cardWidth, height: cardHeight }}>
                {/* Poster image */}
                {poster ? (
                  <ProgressiveImage
                    uri={getImageUrl(poster, "w185")}
                    style={{
                      width: cardWidth,
                      height: cardHeight,
                      borderRadius: 12,
                    }}
                    resizeMode="cover"
                  />
                ) : (
                  <View
                    className="flex-1 items-center justify-center rounded-xl"
                    style={{ backgroundColor: colors.bgTop }}
                  >
                    <Ionicons
                      name={p.mediaType === "tv" ? "tv" : "film"}
                      size={24}
                      color={colors.iconMuted}
                    />
                  </View>
                )}

                {/* Progress bar — 4px, themed */}
                <View
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 4,
                    backgroundColor: colors.progressTrackAlt,
                    borderBottomLeftRadius: 12,
                    borderBottomRightRadius: 12,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      width: `${Math.round((p.completed ? 1 : p.percent) * 100)}%`,
                      height: "100%",
                      backgroundColor: item.fullyWatched
                        ? colors.successGreen
                        : colors.gold,
                      borderRadius: 2,
                    }}
                  />
                </View>

                {/* Gradient overlay at bottom so progress bar doesn't float */}
                <View
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 40,
                    backgroundColor: "transparent",
                  }}
                  pointerEvents="none"
                />

                {/* TV episode badge */}
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

                {/* Provider badge */}
                {p.providerId ? (
                  <View
                    style={{
                      position: "absolute",
                      bottom: 10,
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
                      style={{ color: colors.gold }}
                    >
                      {providerLabelMap[p.providerId] ?? p.providerId}
                    </Text>
                  </View>
                ) : null}

                {/* Fully watched checkmark */}
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

              {/* Title */}
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: 11,
                  fontFamily: "Inter_400Regular",
                  marginTop: 6,
                }}
                numberOfLines={1}
              >
                {title || `ID: ${p.tmdbId}`}
              </Text>
            </TouchableOpacity>
          );
        })}
      </SwipeExemptScrollView>
    </View>
  );
}
