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
  Animated,
  TouchableOpacity,
  useWindowDimensions,
  Platform,
  Share,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeNavigation } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import { getImageUrl, getTrailerKey } from "@filmsnaps/shared";
import { ProgressiveImage } from "../../components/ProgressiveImage";
import { FilmGrain } from "../../components/FilmGrain";
import { useTVDetails } from "../../hooks/useTMDB";
import { MediaCarousel } from "../../components/MediaCarousel";
import { CastCarousel } from "../../components/CastCarousel";
import { TrailerModal } from "../../components/TrailerModal";
import { DetailSkeleton } from "../../components/Skeletons";
import { DownloadSheet } from "../../components/DownloadSheet";
import { useMediaDownloadState } from "../../lib/download/context";
import { SeasonPicker } from "../../components/SeasonPicker";
import {
  isBookmarked,
  debouncedSaveBookmark,
  debouncedRemoveBookmark,
} from "../../lib/bookmarks";
import { getResumePoint } from "../../lib/watchHistory";
import { downloadToast } from "../../lib/download";
import { prefetchArtwork } from "../../lib/prefetchArtwork";
import type { WatchProgress } from "../../lib/watchHistory";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { resolveShowIds } from "../../lib/anime/resolve";

export default function TVDetailScreen() {
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const { id } = useLocalSearchParams<{ id: string }>();
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();
  const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = useWindowDimensions();
  const { data, isLoading } = useTVDetails(id!);

  const BACKDROP_HEIGHT = Math.min(SCREEN_HEIGHT * 0.42, 350);
  const POSTER_WIDTH = 104;
  const POSTER_OVERLAP = 52;
  const scrollY = useRef(new Animated.Value(0)).current;

  const show = data;
  const title = show?.name || show?.title || "";

  const animeHit = useMemo(() => (id ? resolveShowIds(id) : null), [id]);
  const isAnime = animeHit != null;

  const [bookmarked, setBookmarked] = useState(false);
  const [resumeState, setResumeState] = useState<WatchProgress | null>(null);
  const [downloadSheetOpen, setDownloadSheetOpen] = useState(false);
  const downloadSummary = useMediaDownloadState("tv", String(id));

  useEffect(() => {
    if (id) {
      isBookmarked(id!).then(setBookmarked);
      getResumePoint(id!, "tv").then((p) => {
        if (p) setResumeState(p);
      });
    }
  }, [id]);

  const toggleBookmark = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !bookmarked;
    setBookmarked(next);
    if (next) {
      debouncedSaveBookmark({
        tmdbId: id!,
        mediaType: "tv",
        title: show?.name || show?.title || "",
        posterPath: show?.poster_path ?? null,
        year: show?.first_air_date?.split("-")[0] ?? "",
        addedAt: Date.now(),
      });
      prefetchArtwork({
        poster_path: show?.poster_path,
        backdrop_path: show?.backdrop_path,
      });
      downloadToast.success("Saved to Library", 2500);
    } else {
      debouncedRemoveBookmark(id!);
      downloadToast.info("Removed from Saved", 2000);
    }
  }, [id, bookmarked, show]);

  const handleShare = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Share.share({
      message: `Check out "${title}" on FilmSnaps 🎬\nhttps://filmsnap-pro.netlify.app/tv/${id}`,
    });
  }, [id, title]);

  const handleDownloadServer = useCallback(
    (server: string) => {
      const qs = new URLSearchParams({
        poster: show?.poster_path || "",
        backdrop: show?.backdrop_path || "",
      }).toString();
      nav.push(`/download/${server}/tv/${id}?${qs}`);
    },
    [id, nav, show?.poster_path, show?.backdrop_path],
  );

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (!show) {
    return (
      <View
        className="flex-1 items-center justify-center bg-void"
        style={{ backgroundColor: colors.bg }}
      >
        <Ionicons name="tv-outline" size={48} color={colors.textTertiary} />
        <Text className="text-text-secondary mt-3">Show not found</Text>
      </View>
    );
  }

  const year = show.first_air_date?.split("-")[0] ?? "";
  const genres = show.genres ?? [];
  const trailerKey = getTrailerKey(show.videos);
  const cast = show.credits?.cast?.slice(0, 10) ?? [];
  const seasonCount =
    show.seasons?.filter((s: any) => s.season_number > 0).length ?? 0;

  return (
    <View className="flex-1 bg-void" style={{ backgroundColor: colors.bg }}>
      {/* ── Floating Top Glass Navigation Bar ── */}
      <View
        style={{
          position: "absolute",
          top: insets.top + 8,
          left: 16,
          right: 16,
          zIndex: 20,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Back Button */}
        <TouchableOpacity
          onPress={() => nav.goBack({ fallback: "/(tabs)" })}
          activeOpacity={0.75}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            backgroundColor: "rgba(14, 14, 17, 0.75)",
            borderWidth: 0.5,
            borderColor: "rgba(255, 255, 255, 0.15)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>

        {/* Right actions: Bookmark & Share */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <TouchableOpacity
            onPress={toggleBookmark}
            activeOpacity={0.75}
            accessibilityLabel={
              bookmarked ? "Saved in library" : "Save to library"
            }
            accessibilityRole="button"
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: bookmarked
                ? "rgba(212, 162, 55, 0.2)"
                : "rgba(14, 14, 17, 0.75)",
              borderWidth: 0.5,
              borderColor: bookmarked
                ? colors.gold
                : "rgba(255, 255, 255, 0.15)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons
              name={bookmarked ? "bookmark" : "bookmark-outline"}
              size={18}
              color={bookmarked ? colors.gold : colors.textPrimary}
            />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleShare}
            activeOpacity={0.75}
            accessibilityLabel="Share"
            accessibilityRole="button"
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: "rgba(14, 14, 17, 0.75)",
              borderWidth: 0.5,
              borderColor: "rgba(255, 255, 255, 0.15)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons
              name="share-outline"
              size={18}
              color={colors.textPrimary}
            />
          </TouchableOpacity>
        </View>
      </View>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
        scrollEventThrottle={16}
      >
        {/* Backdrop with film grain */}
        <View
          style={{
            width: SCREEN_WIDTH,
            height: BACKDROP_HEIGHT,
            position: "relative",
          }}
        >
          {show.backdrop_path ? (
            <Animated.View
              style={{
                position: "absolute",
                width: SCREEN_WIDTH,
                height: BACKDROP_HEIGHT,
                transform: [
                  {
                    translateY: scrollY.interpolate({
                      inputRange: [-100, 0, 100],
                      outputRange: [-30, 0, -30],
                      extrapolate: "clamp",
                    }),
                  },
                ],
                opacity: scrollY.interpolate({
                  inputRange: [0, BACKDROP_HEIGHT * 0.5],
                  outputRange: [1, 0.85],
                  extrapolate: "clamp",
                }),
              }}
            >
              <ProgressiveImage
                uri={getImageUrl(show.backdrop_path, "w780")}
                style={{ width: SCREEN_WIDTH, height: BACKDROP_HEIGHT }}
                resizeMode="cover"
              />
            </Animated.View>
          ) : (
            <View
              style={{
                backgroundColor: colors.bgElevated,
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
              }}
            />
          )}

          {/* Film grain overlay */}
          <FilmGrain opacity={0.03} />

          {/* Cinematic gradient fade */}
          <LinearGradient
            colors={[
              "rgba(7,7,8,0)",
              "rgba(7,7,8,0)",
              "rgba(7,7,8,0.50)",
              "rgba(7,7,8,0.95)",
            ]}
            locations={[0, 0.35, 0.68, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: BACKDROP_HEIGHT * 0.7,
            }}
            pointerEvents="none"
          />
        </View>

        {/* Content Section */}
        <View className="px-4" style={{ marginTop: -POSTER_OVERLAP }}>
          {/* Poster + Info row */}
          <View className="flex-row items-center">
            {/* Elevated Poster */}
            {show.poster_path ? (
              <ProgressiveImage
                uri={getImageUrl(show.poster_path, "w342")}
                style={{
                  width: POSTER_WIDTH,
                  height: POSTER_WIDTH * 1.5,
                  borderRadius: 12,
                  borderWidth: 0.5,
                  borderColor: colors.borderSubtle,
                  ...Platform.select({
                    ios: {
                      shadowColor: "#000",
                      shadowOffset: { width: 0, height: 8 },
                      shadowOpacity: 0.55,
                      shadowRadius: 14,
                    },
                    android: { elevation: 12 },
                  }),
                }}
                resizeMode="cover"
              />
            ) : (
              <View
                className="items-center justify-center"
                style={{
                  width: POSTER_WIDTH,
                  height: POSTER_WIDTH * 1.5,
                  borderRadius: 12,
                  backgroundColor: colors.bgElevated,
                  borderWidth: 0.5,
                  borderColor: colors.borderSubtle,
                }}
              >
                <Ionicons
                  name="tv-outline"
                  size={28}
                  color={colors.textTertiary}
                />
              </View>
            )}

            {/* Info to the right of poster */}
            <View style={{ flex: 1, marginLeft: 18, justifyContent: "center" }}>
              <Text
                style={{
                  fontSize: 18,
                  lineHeight: 22,
                  fontFamily: "Inter_600SemiBold",
                  color: colors.textPrimary,
                  marginBottom: 6,
                }}
                numberOfLines={2}
              >
                {title}
              </Text>

              {/* Meta tags: Rating + Year + Seasons */}
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 6,
                }}
              >
                {show.vote_average != null && show.vote_average > 0 && (
                  <View
                    style={{
                      backgroundColor: "rgba(212,162,55,0.15)",
                      borderRadius: 6,
                      paddingHorizontal: 7,
                      paddingVertical: 2,
                      flexDirection: "row",
                      alignItems: "center",
                      borderWidth: 0.5,
                      borderColor: "rgba(212,162,55,0.3)",
                    }}
                  >
                    <Text
                      style={{
                        color: colors.gold,
                        fontSize: 11,
                        fontFamily: "Inter_600SemiBold",
                      }}
                    >
                      ★ {show.vote_average.toFixed(1)}
                    </Text>
                  </View>
                )}

                {year ? (
                  <View
                    style={{
                      backgroundColor: "rgba(255, 255, 255, 0.08)",
                      borderRadius: 6,
                      paddingHorizontal: 7,
                      paddingVertical: 2,
                    }}
                  >
                    <Text
                      style={{
                        color: colors.textSecondary,
                        fontSize: 11,
                        fontFamily: "Inter_500Medium",
                      }}
                    >
                      {year}
                    </Text>
                  </View>
                ) : null}

                {seasonCount > 0 && (
                  <View
                    style={{
                      backgroundColor: "rgba(255, 255, 255, 0.08)",
                      borderRadius: 6,
                      paddingHorizontal: 7,
                      paddingVertical: 2,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    <Ionicons
                      name="layers-outline"
                      size={12}
                      color={colors.textTertiary}
                    />
                    <Text
                      style={{
                        color: colors.textSecondary,
                        fontSize: 11,
                        fontFamily: "Inter_500Medium",
                      }}
                    >
                      {seasonCount} {seasonCount === 1 ? "Season" : "Seasons"}
                    </Text>
                  </View>
                )}
              </View>

              {/* Genre badges */}
              {genres.length > 0 && (
                <View className="flex-row flex-wrap" style={{ gap: 4 }}>
                  {genres.slice(0, 3).map((g: { id: number; name: string }) => (
                    <View
                      key={g.id}
                      style={{
                        backgroundColor: colors.bgElevated,
                        borderRadius: 6,
                        paddingHorizontal: 7,
                        paddingVertical: 2,
                        borderWidth: 0.5,
                        borderColor: colors.borderSubtle,
                      }}
                    >
                      <Text
                        style={{
                          color: colors.textSecondary,
                          fontSize: 10,
                          fontFamily: "Inter_500Medium",
                        }}
                      >
                        {g.name}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>

          {/* ── Action Buttons: Primary Watch + Secondary Quick Actions ── */}
          <View style={{ marginTop: 18 }}>
            {/* Primary Watch/Resume CTA */}
            <TouchableOpacity
              onPress={() => {
                const s = resumeState?.season ?? 1;
                const e = resumeState?.episode ?? 1;
                const base = `/watch/tv/${id}/${s}/${e}`;
                const params = new URLSearchParams(
                  resumeState &&
                    resumeState.percent > 0 &&
                    resumeState.percent < 0.95
                    ? {
                        t: String(Math.floor(resumeState.currentTime)),
                        backdrop: show.backdrop_path || "",
                      }
                    : { backdrop: show.backdrop_path || "" },
                );
                const hit = isAnime && id ? resolveShowIds(id, s) : null;
                if (hit) {
                  params.set("isAnime", "1");
                  params.set("mid", String(hit.malId));
                  if (hit.anilistId != null)
                    params.set("aid", String(hit.anilistId));
                  params.set("audio", "sub");
                }
                nav.push(`${base}?${params.toString()}`);
              }}
              activeOpacity={0.88}
              style={{
                backgroundColor: colors.gold,
                borderRadius: 12,
                paddingVertical: 14,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                ...Platform.select({
                  ios: {
                    shadowColor: colors.gold,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.35,
                    shadowRadius: 10,
                  },
                  android: { elevation: 6 },
                }),
              }}
            >
              <Ionicons
                name="play"
                size={18}
                color={colors.bg}
                style={{ marginRight: 8 }}
              />
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 15,
                  color: colors.bg,
                }}
              >
                {resumeState && resumeState.percent >= 0.95
                  ? "Watch Again"
                  : resumeState && resumeState.percent > 0
                    ? `Resume S${resumeState.season} E${resumeState.episode}`
                    : "Play S1 E1"}
              </Text>
            </TouchableOpacity>

            {/* Secondary Action Row: Trailer & Download */}
            <View className="flex-row items-center mt-3" style={{ gap: 10 }}>
              {trailerKey ? (
                <TouchableOpacity
                  onPress={() => setTrailerOpen(true)}
                  activeOpacity={0.75}
                  style={{
                    flex: 1,
                    backgroundColor: "rgba(14, 14, 17, 0.8)",
                    borderWidth: 1,
                    borderColor: colors.borderSubtle,
                    borderRadius: 12,
                    paddingVertical: 11,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <Ionicons name="logo-youtube" size={16} color="#FF0000" />
                  <Text
                    style={{
                      color: colors.textPrimary,
                      fontSize: 13,
                      fontFamily: "Inter_500Medium",
                    }}
                  >
                    Trailer
                  </Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                onPress={() => setDownloadSheetOpen(true)}
                activeOpacity={0.75}
                style={{
                  flex: 1,
                  backgroundColor: "rgba(14, 14, 17, 0.8)",
                  borderWidth: 1,
                  borderColor: colors.borderSubtle,
                  borderRadius: 12,
                  paddingVertical: 11,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <Ionicons
                  name="download-outline"
                  size={16}
                  color={colors.gold}
                />
                <Text
                  style={{
                    color: colors.textPrimary,
                    fontSize: 13,
                    fontFamily: "Inter_500Medium",
                  }}
                >
                  Download
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Overview */}
          {show.overview ? (
            <View className="mt-6">
              <Text
                style={{
                  fontSize: 15,
                  fontFamily: "Inter_600SemiBold",
                  marginBottom: 8,
                  color: colors.textPrimary,
                }}
              >
                Overview
              </Text>
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: 14,
                  lineHeight: 21,
                  fontFamily: "Inter_400Regular",
                }}
                numberOfLines={overviewExpanded ? undefined : 3}
              >
                {show.overview}
              </Text>
              {show.overview.length > 120 && (
                <TouchableOpacity
                  onPress={() => setOverviewExpanded(!overviewExpanded)}
                  activeOpacity={0.7}
                  style={{ marginTop: 4 }}
                >
                  <Text
                    style={{
                      color: colors.gold,
                      fontSize: 12,
                      fontFamily: "Inter_500Medium",
                    }}
                  >
                    {overviewExpanded ? "Show less" : "Read more"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}

          {/* Season picker (TV only) */}
          <SeasonPicker
            tmdbId={id!}
            title={show.name}
            posterPath={show.poster_path}
            downloadSummary={downloadSummary}
            seasons={(show.seasons ?? [])
              .filter((s: any) => s.season_number > 0 && s.episode_count > 0)
              .map((s: any) => ({
                seasonNumber: s.season_number,
                episodeCount: s.episode_count,
                name: s.name ?? `Season ${s.season_number}`,
              }))}
            initialSeason={resumeState?.season ?? 1}
            backdropPath={show.backdrop_path}
          />

          {/* Cast */}
          {cast.length > 0 && <CastCarousel cast={show.credits.cast} />}

          {/* Similar shows */}
          {show.similar?.results?.length > 0 && (
            <View className="mt-6">
              <MediaCarousel
                title="Similar Shows"
                data={show.similar.results}
                onItemPress={(item) => nav.push(`/tv/${item.id}`)}
              />
            </View>
          )}

          <View style={{ height: 60 }} />
        </View>
      </Animated.ScrollView>

      {/* Trailer Modal */}
      <TrailerModal
        videoKey={trailerKey}
        open={trailerOpen}
        onClose={() => setTrailerOpen(false)}
      />

      {/* Quality Picker Sheet */}
      <DownloadSheet
        visible={downloadSheetOpen}
        onClose={() => setDownloadSheetOpen(false)}
        mediaType="tv"
        tmdbId={id!}
        title={title}
        onSelectServer={handleDownloadServer}
      />
    </View>
  );
}
