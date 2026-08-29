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
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams } from "expo-router";
import { useSafeNavigation } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import { getImageUrl, getTrailerKey } from "@filmsnaps/shared";
import { ProgressiveImage } from "../../components/ProgressiveImage";
import { typography } from "../../lib/typography";
import { FilmGrain } from "../../components/FilmGrain";
import { useMovieDetails } from "../../hooks/useTMDB";
import { MediaCarousel } from "../../components/MediaCarousel";
import { CastCarousel } from "../../components/CastCarousel";
import { TrailerModal } from "../../components/TrailerModal";
import { DetailSkeleton } from "../../components/Skeletons";
import { DownloadSheet } from "../../components/DownloadSheet";
import {
  isBookmarked,
  debouncedSaveBookmark,
  debouncedRemoveBookmark,
} from "../../lib/bookmarks";
import { getProgress } from "../../lib/watchHistory";
import { downloadToast } from "../../lib/download";
import { prefetchArtwork } from "../../lib/prefetchArtwork";
import type { WatchProgress } from "../../lib/watchHistory";
import { resolveMovie } from "../../lib/anime/resolve";
import * as Haptics from "expo-haptics";

function formatRuntime(minutes: number): string {
  if (minutes < 1) return "<1m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function MovieDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();
  const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = useWindowDimensions();
  const { data, isLoading } = useMovieDetails(id!);

  const BACKDROP_HEIGHT = Math.min(SCREEN_HEIGHT * 0.42, 350);
  const POSTER_WIDTH = 104;
  const POSTER_OVERLAP = 52;
  const scrollY = useRef(new Animated.Value(0)).current;

  const movie = data;
  const title = movie?.title || movie?.name || "";

  const animeHit = useMemo(() => resolveMovie(id!) ?? null, [id]);

  const [bookmarked, setBookmarked] = useState(false);
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [resumeState, setResumeState] = useState<WatchProgress | null>(null);
  const [downloadSheetOpen, setDownloadSheetOpen] = useState(false);

  useEffect(() => {
    if (id) {
      isBookmarked(id!).then(setBookmarked);
      getProgress(id!, "movie", undefined, undefined, animeHit != null).then(
        (p) => {
          if (p && p.percent > 0) setResumeState(p);
        },
      );
    }
  }, [id, animeHit]);

  const toggleBookmark = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !bookmarked;
    setBookmarked(next);
    if (next) {
      debouncedSaveBookmark({
        tmdbId: id!,
        mediaType: "movie",
        title: movie?.title || movie?.name || "",
        posterPath: movie?.poster_path ?? null,
        year: movie?.release_date?.split("-")[0] ?? "",
        addedAt: Date.now(),
      });
      prefetchArtwork({
        poster_path: movie?.poster_path,
        backdrop_path: movie?.backdrop_path,
      });
      downloadToast.success("Saved to Library", 2500);
    } else {
      debouncedRemoveBookmark(id!);
      downloadToast.info("Removed from Saved", 2000);
    }
  }, [id, bookmarked, movie]);

  const handleShare = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Share.share({
      message: `Check out "${title}" on FilmSnaps 🎬\nhttps://filmsnap-pro.netlify.app/movie/${id}`,
    });
  }, [id, title]);

  const handleDownloadServer = useCallback(
    (server: string) => {
      const qs = new URLSearchParams({
        poster: movie?.poster_path || "",
        backdrop: movie?.backdrop_path || "",
      }).toString();
      nav.push(`/download/${server}/movie/${id}?${qs}`);
    },
    [id, nav, movie?.poster_path, movie?.backdrop_path],
  );

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (!movie) {
    return (
      <View
        className="flex-1 items-center justify-center bg-void"
        style={{ backgroundColor: colors.bg }}
      >
        <Ionicons name="film-outline" size={48} color={colors.textTertiary} />
        <Text className="text-text-secondary mt-3">Movie not found</Text>
      </View>
    );
  }

  const year = movie.release_date?.split("-")[0] ?? "";
  const genres = movie.genres ?? [];
  const trailerKey = getTrailerKey(movie.videos);
  const cast = movie.credits?.cast?.slice(0, 10) ?? [];

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
          {movie.backdrop_path ? (
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
                uri={getImageUrl(movie.backdrop_path, "w780")}
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
            {movie.poster_path ? (
              <ProgressiveImage
                uri={getImageUrl(movie.poster_path, "w342")}
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
                  name="film-outline"
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

              {/* Meta tags: Rating + Year + Runtime */}
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 6,
                }}
              >
                {movie.vote_average != null && movie.vote_average > 0 && (
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
                      ★ {movie.vote_average.toFixed(1)}
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

                {movie.runtime ? (
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
                      name="time-outline"
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
                      {formatRuntime(movie.runtime)}
                    </Text>
                  </View>
                ) : null}
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
                const base = `/watch/movie/${id}`;
                const params = new URLSearchParams(
                  resumeState && resumeState.percent < 0.95
                    ? {
                        t: String(Math.floor(resumeState.currentTime)),
                        backdrop: movie.backdrop_path || "",
                      }
                    : { backdrop: movie.backdrop_path || "" },
                );
                if (animeHit) {
                  params.set("isAnime", "1");
                  params.set("mid", String(animeHit.malId));
                  if (animeHit.anilistId != null)
                    params.set("aid", String(animeHit.anilistId));
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
                    ? `Resume Playback (${Math.round(resumeState.percent * 100)}%)`
                    : "Watch Now"}
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
          {movie.overview ? (
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
                {movie.overview}
              </Text>
              {movie.overview.length > 120 && (
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

          {/* Cast */}
          {cast.length > 0 && <CastCarousel cast={movie.credits.cast} />}

          {/* Similar movies */}
          {movie.similar?.results?.length > 0 && (
            <View className="mt-6">
              <MediaCarousel
                title="Similar Movies"
                data={movie.similar.results}
                onItemPress={(item) => nav.push(`/movie/${item.id}`)}
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
        mediaType="movie"
        tmdbId={id!}
        title={title}
        onSelectServer={handleDownloadServer}
      />
    </View>
  );
}
