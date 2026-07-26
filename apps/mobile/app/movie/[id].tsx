import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Animated,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { BackIcon, ShareIcon } from "../../components/Icons";
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
import type { Movie } from "@filmsnaps/shared";
import * as Haptics from "expo-haptics";
import { Share } from "react-native";

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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = useWindowDimensions();
  const { data, isLoading } = useMovieDetails(id!);

  const BACKDROP_HEIGHT = Math.min(SCREEN_HEIGHT * 0.4, 340);
  const POSTER_WIDTH = 100;
  const POSTER_OVERLAP = 56;
  const scrollY = useRef(new Animated.Value(0)).current;

  const movie = data;
  const title = movie?.title || movie?.name || "";

  const [bookmarked, setBookmarked] = useState(false);
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [resumeState, setResumeState] = useState<WatchProgress | null>(null);
  const [downloadSheetOpen, setDownloadSheetOpen] = useState(false);

  useEffect(() => {
    if (id) {
      isBookmarked(id!).then(setBookmarked);
      getProgress(id!, "movie").then((p) => {
        if (p && p.percent > 0) setResumeState(p);
      });
    }
  }, [id]);

  const toggleBookmark = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !bookmarked;
    setBookmarked(next); // optimistic
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
      downloadToast.success(
        "Saved to Library · View in your Library tab",
        3000,
      );
    } else {
      debouncedRemoveBookmark(id!);
      downloadToast.info("Removed from Saved", 2000);
    }
  }, [id, bookmarked, movie]);

  const handleShare = useCallback(() => {
    Share.share({
      message: `Check out "${title}" on FilmSnaps 🎬\nhttps://filmsnaps.app/movie/${id}`,
    });
  }, [id, title]);

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (!movie) {
    return (
      <View
        className="flex-1 items-center justify-center bg-void"
        style={{ backgroundColor: "#070708" }}
      >
        <Ionicons name="film-outline" size={48} color="#52525B" />
        <Text className="text-text-secondary mt-3">Movie not found</Text>
      </View>
    );
  }

  const year = movie.release_date?.split("-")[0] ?? "";
  const genres = movie.genres ?? [];
  const trailerKey = getTrailerKey(movie.videos);
  const cast = movie.credits?.cast?.slice(0, 10) ?? [];

  return (
    <View className="flex-1 bg-void" style={{ backgroundColor: "#070708" }}>
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
                backgroundColor: "#16161A",
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
              }}
            />
          )}

          {/* Film grain overlay */}
          <FilmGrain opacity={0.04} />

          {/* ── Cinematic gradient — replaces the flat 0.85 slab ──
      Top 35% is fully clear so the backdrop shines.
      Darkens smoothly into the void for the poster-overlap zone.
  */}
          <LinearGradient
            colors={[
              "rgba(7,7,8,0)",
              "rgba(7,7,8,0)",
              "rgba(7,7,8,0.50)",
              "rgba(7,7,8,0.92)",
            ]}
            locations={[0, 0.35, 0.68, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: BACKDROP_HEIGHT * 0.65,
            }}
            pointerEvents="none"
          />
        </View>

        {/* Trailer chip on backdrop */}
        {trailerKey && (
          <TouchableOpacity
            onPress={() => setTrailerOpen(true)}
            activeOpacity={0.7}
            style={{
              position: "absolute",
              bottom: 12,
              right: 16,
              zIndex: 5,
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: "rgba(0,0,0,0.7)",
              borderRadius: 20,
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderWidth: 0.5,
              borderColor: "rgba(255,255,255,0.1)",
            }}
          >
            <Ionicons name="play" size={10} color="#F4F4F5" />
            <Text
              style={{
                color: "#F4F4F5",
                fontSize: 10,
                fontFamily: "Inter_500Medium",
                marginLeft: 4,
              }}
            >
              Trailer
            </Text>
          </TouchableOpacity>
        )}

        {/* Pill-shaped back button */}
        <View
          style={{
            position: "absolute",
            top: insets.top + 12,
            left: 16,
            zIndex: 10,
          }}
        >
          <TouchableOpacity
            onPress={() => router.back()}
            activeOpacity={0.7}
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: "rgba(8,8,8,0.7)",
              borderRadius: 20,
              paddingHorizontal: 12,
              paddingVertical: 6,
            }}
          >
            <BackIcon width={18} height={18} color="#F4F4F5" />
            <Text
              style={{
                color: "#F4F4F5",
                fontSize: 12,
                marginLeft: 2,
                fontFamily: "Inter_500Medium",
              }}
            >
              Back
            </Text>
          </TouchableOpacity>
        </View>

        {/* Content — starts below backdrop */}
        <View className="px-4" style={{ marginTop: -POSTER_OVERLAP }}>
          {/* Poster + Info row */}
          <View className="flex-row">
            {/* Poster — overlapping the backdrop by 40px */}
            {movie.poster_path ? (
              <ProgressiveImage
                uri={getImageUrl(movie.poster_path, "w342")}
                style={{
                  width: POSTER_WIDTH,
                  height: POSTER_WIDTH * 1.5,
                  borderRadius: 8,
                  ...Platform.select({
                    ios: {
                      shadowColor: "#000",
                      shadowOffset: { width: 0, height: 8 },
                      shadowOpacity: 0.55,
                      shadowRadius: 16,
                    },
                    android: { elevation: 14 },
                  }),
                }}
                resizeMode="cover"
              />
            ) : (
              <View
                className="rounded-xl items-center justify-center"
                style={{
                  width: POSTER_WIDTH,
                  height: POSTER_WIDTH * 1.5,
                  backgroundColor: "#16161A",
                }}
              >
                <Ionicons name="film-outline" size={28} color="#52525B" />
              </View>
            )}

            {/* Info to the right of poster */}
            <View className="flex-1 ml-3 justify-end pb-1">
              <Text
                style={[typography.title, { fontSize: 18, lineHeight: 22 }]}
                numberOfLines={2}
              >
                {title}
              </Text>
              {year ? (
                <Text
                  style={[
                    typography.caption,
                    { marginTop: 2, color: "#A1A1AA" },
                  ]}
                >
                  {year}
                </Text>
              ) : null}

              {/* Genre badges — elevated bg */}
              {genres.length > 0 && (
                <View className="flex-row flex-wrap mt-2" style={{ gap: 4 }}>
                  {genres.slice(0, 3).map((g: { id: number; name: string }) => (
                    <View
                      key={g.id}
                      style={{
                        backgroundColor: "#16161A",
                        borderRadius: 4,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                      }}
                    >
                      <Text
                        style={{
                          color: "#A1A1AA",
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

              {/* Gold rating pill — unified brand accent */}
              {movie.vote_average != null && (
                <View className="flex-row items-center mt-2">
                  <View
                    style={{
                      backgroundColor: "rgba(212,162,55,0.15)",
                      borderRadius: 4,
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      flexDirection: "row",
                      alignItems: "center",
                      borderWidth: 0.5,
                      borderColor: "rgba(212,162,55,0.3)",
                    }}
                  >
                    <Text
                      style={{
                        color: "#D4A237",
                        fontSize: 11,
                        fontWeight: "700",
                        marginRight: 3,
                      }}
                    >
                      ★ {movie.vote_average.toFixed(1)}
                    </Text>
                  </View>
                  {movie.runtime ? (
                    <View className="flex-row items-center ml-3">
                      <Ionicons name="time-outline" size={14} color="#52525B" />
                      <Text className="text-text-tertiary text-sm ml-1">
                        {formatRuntime(movie.runtime)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              )}
            </View>
          </View>

          {/* Overview — expandable */}
          {movie.overview ? (
            <View className="mt-6">
              <Text
                style={[
                  typography.title,
                  { marginBottom: 8, color: "#F4F4F5" },
                ]}
              >
                Overview
              </Text>
              <Text
                style={[typography.body, { fontSize: 15, lineHeight: 22 }]}
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
                      color: "#D4A237",
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

          {/* ── Row 1: Primary action + Download + Bookmark + Share ── */}
          <View className="flex-row mt-6" style={{ gap: 10 }}>
            <TouchableOpacity
              onPress={() => {
                const base = `/watch/movie/${id}`;
                const qs =
                  resumeState && resumeState.percent < 0.95
                    ? `?t=${Math.floor(resumeState.currentTime)}&backdrop=${movie.backdrop_path || ""}`
                    : `?backdrop=${movie.backdrop_path || ""}`;
                router.push(`${base}${qs}`);
              }}
              activeOpacity={0.9}
              style={{
                flex: 1,
                backgroundColor: "#D4A237",
                borderRadius: 10,
                paddingVertical: 14,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                ...Platform.select({
                  ios: {
                    shadowColor: "#D4A237",
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.3,
                    shadowRadius: 8,
                  },
                  android: { elevation: 6 },
                }),
              }}
            >
              <Ionicons
                name="play"
                size={18}
                color="#070708"
                style={{ marginRight: 8 }}
              />
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                  color: "#070708",
                }}
              >
                {resumeState && resumeState.percent >= 0.95
                  ? "Watch Again"
                  : resumeState
                    ? "Resume"
                    : "Watch Now"}
              </Text>
              {/* Progress line — visible when partially watched */}
              {resumeState &&
                resumeState.percent > 0 &&
                resumeState.percent < 0.95 && (
                  <View
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: 3,
                      borderBottomLeftRadius: 10,
                      borderBottomRightRadius: 10,
                      backgroundColor: "rgba(255,255,255,0.2)",
                    }}
                  >
                    <View
                      style={{
                        width: `${Math.round(resumeState.percent * 100)}%`,
                        height: "100%",
                        backgroundColor: "rgba(255,255,255,0.9)",
                        borderBottomLeftRadius: 10,
                      }}
                    />
                  </View>
                )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setDownloadSheetOpen(true)}
              activeOpacity={0.8}
              accessibilityLabel="Download options"
              style={{
                width: 48,
                borderWidth: 0.5,
                borderColor: "#222226",
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="download-outline" size={20} color="#A1A1AA" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={toggleBookmark}
              activeOpacity={0.8}
              accessibilityLabel={
                bookmarked ? "Remove from bookmarks" : "Add to bookmarks"
              }
              style={{
                width: bookmarked ? 56 : 48,
                backgroundColor: bookmarked
                  ? "rgba(232,160,32,0.15)"
                  : "transparent",
                borderWidth: 0.5,
                borderColor: bookmarked ? "#D4A237" : "#222226",
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: bookmarked ? 6 : 0,
              }}
            >
              <Ionicons
                name={bookmarked ? "bookmark" : "bookmark-outline"}
                size={20}
                color={bookmarked ? "#D4A237" : "#A1A1AA"}
              />
              {bookmarked && (
                <Text
                  style={{
                    color: "#D4A237",
                    fontSize: 8,
                    fontFamily: "Inter_600SemiBold",
                    marginTop: 2,
                  }}
                >
                  Saved
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleShare}
              activeOpacity={0.8}
              accessibilityLabel="Share this movie"
              style={{
                width: 48,
                borderWidth: 0.5,
                borderColor: "#222226",
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ShareIcon width={20} height={20} color="#A1A1AA" />
            </TouchableOpacity>
          </View>

          {/* Cast */}
          {cast.length > 0 && <CastCarousel cast={movie.credits.cast} />}

          {/* Similar movies (trailer chip now on backdrop) */}
          {movie.similar?.results?.length > 0 && (
            <View className="mt-6">
              <MediaCarousel
                title="Similar Movies"
                data={movie.similar.results}
                onItemPress={(item) => router.push(`/movie/${item.id}`)}
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

      {/* Download Sheet */}
      <DownloadSheet
        visible={downloadSheetOpen}
        onClose={() => setDownloadSheetOpen(false)}
        mediaType="movie"
        tmdbId={id!}
        title={title}
        posterPath={movie?.poster_path}
        backdropPath={movie?.backdrop_path}
      />
    </View>
  );
}
