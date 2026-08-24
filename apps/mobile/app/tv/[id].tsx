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
  Animated,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeNavigation } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { BackIcon, ShareIcon } from "../../components/Icons";
import { colors } from "../../theme/colors";
import { getImageUrl, getTrailerKey } from "@filmsnaps/shared";
import { ProgressiveImage } from "../../components/ProgressiveImage";
import { typography } from "../../lib/typography";
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
import type { Movie } from "@filmsnaps/shared";
import * as Haptics from "expo-haptics";
import { Share } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { resolveShowIds } from "../../lib/anime/resolve";

function formatRuntime(minutes: number): string {
  if (minutes < 1) return "<1m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function TVDetailScreen() {
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const { id } = useLocalSearchParams<{ id: string }>();
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();
  const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = useWindowDimensions();
  const { data, isLoading } = useTVDetails(id!);

  const BACKDROP_HEIGHT = Math.min(SCREEN_HEIGHT * 0.4, 340);
  const POSTER_WIDTH = 100;
  const POSTER_OVERLAP = 56;
  const scrollY = useRef(new Animated.Value(0)).current;

  const show = data;
  const title = show?.name || show?.title || "";

  // Per-title anime: derive from the map, NOT the global mode. A movie-mode
  // user who taps a genuinely-anime title still gets the anime session, and an
  // anime-mode user who taps a regular show gets the movie/TV session.
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
    setBookmarked(next); // optimistic
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
      downloadToast.success(
        "Saved to Library · View in your Library tab",
        3000,
      );
    } else {
      debouncedRemoveBookmark(id!);
      downloadToast.info("Removed from Saved", 2000);
    }
  }, [id, bookmarked, show]);

  const handleShare = useCallback(() => {
    Share.share({
      message: `Check out "${title}" on FilmSnaps 🎬\nhttps://filmsnaps.app/tv/${id}`,
    });
  }, [id, title]);

  const handleDownloadServer = useCallback(
    (server: string) => {
      nav.push(`/download/${server}/tv/${id}`);
    },
    [id, nav],
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
          <FilmGrain opacity={0.04} />

          {/* Cinematic gradient — fades from clear → void for poster/text overlap */}
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
            <Ionicons name="play" size={10} color={colors.textPrimary} />
            <Text
              style={{
                color: colors.textPrimary,
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
            onPress={() => nav.goBack({ fallback: "/(tabs)" })}
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
            <BackIcon width={18} height={18} color={colors.textPrimary} />
            <Text
              style={{
                color: colors.textPrimary,
                fontSize: 12,
                marginLeft: 2,
                fontFamily: "Inter_500Medium",
              }}
            >
              Back
            </Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View className="px-4" style={{ marginTop: -POSTER_OVERLAP }}>
          {/* Poster + Info row */}
          <View className="flex-row">
            {show.poster_path ? (
              <ProgressiveImage
                uri={getImageUrl(show.poster_path, "w342")}
                style={{
                  width: POSTER_WIDTH,
                  height: POSTER_WIDTH * 1.5,
                  borderRadius: 8,
                  ...Platform.select({
                    ios: {
                      shadowColor: colors.playerBg,
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
                  backgroundColor: colors.bgElevated,
                }}
              >
                <Ionicons
                  name="tv-outline"
                  size={28}
                  color={colors.textTertiary}
                />
              </View>
            )}

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
                    { marginTop: 2, color: colors.textSecondary },
                  ]}
                >
                  {year}
                </Text>
              ) : null}

              {genres.length > 0 && (
                <View className="flex-row flex-wrap mt-2" style={{ gap: 4 }}>
                  {genres.slice(0, 3).map((g: { id: number; name: string }) => (
                    <View
                      key={g.id}
                      style={{
                        backgroundColor: colors.bgElevated,
                        borderRadius: 4,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
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

              {show.vote_average != null && (
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
                        color: colors.gold,
                        fontSize: 11,
                        fontWeight: "700",
                        marginRight: 3,
                      }}
                    >
                      ★ {show.vote_average.toFixed(1)}
                    </Text>
                  </View>
                  {seasonCount > 0 && (
                    <View className="flex-row items-center ml-3">
                      <Ionicons
                        name="layers-outline"
                        size={14}
                        color={colors.textTertiary}
                      />
                      <Text className="text-text-tertiary text-sm ml-1">
                        {seasonCount} {seasonCount === 1 ? "Season" : "Seasons"}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>

          {/* Overview — expandable */}
          {show.overview ? (
            <View className="mt-6">
              <Text
                style={[
                  typography.title,
                  { marginBottom: 8, color: colors.textPrimary },
                ]}
              >
                Overview
              </Text>
              <Text
                style={[typography.body, { fontSize: 15, lineHeight: 22 }]}
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

          {/* ── Row 1: Primary action + Download + Bookmark ── */}
          <View className="flex-row mt-6" style={{ gap: 10 }}>
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
                if (__DEV__)
                  console.log(
                    `[FS-410] TV Watch press isAnime=${isAnime} tmdb=${id} s=${s} e=${e} hit=${hit ? `mal:${hit.malId}` : "null"}`,
                  );
                if (hit) {
                  params.set("isAnime", "1");
                  params.set("mid", String(hit.malId));
                  if (hit.anilistId != null)
                    params.set("aid", String(hit.anilistId));
                  params.set("audio", "sub");
                }
                nav.push(`${base}?${params.toString()}`);
              }}
              activeOpacity={0.9}
              style={{
                flex: 1,
                backgroundColor: colors.gold,
                borderRadius: 10,
                paddingVertical: 14,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                ...Platform.select({
                  ios: {
                    shadowColor: colors.gold,
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
                color={colors.bg}
                style={{ marginRight: 8 }}
              />
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                  color: colors.bg,
                }}
              >
                {resumeState && resumeState.percent >= 0.95
                  ? "Watch Again"
                  : resumeState && resumeState.percent > 0
                    ? `Resume S${resumeState.season} E${resumeState.episode}`
                    : "Play S1 E1"}
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
                borderColor: bookmarked ? colors.gold : colors.progressTrack,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: bookmarked ? 6 : 0,
              }}
            >
              <Ionicons
                name={bookmarked ? "bookmark" : "bookmark-outline"}
                size={20}
                color={bookmarked ? colors.gold : colors.textSecondary}
              />
              {bookmarked && (
                <Text
                  style={{
                    color: colors.gold,
                    fontSize: 8,
                    fontFamily: "Inter_600SemiBold",
                    marginTop: 2,
                  }}
                >
                  Saved
                </Text>
              )}
            </TouchableOpacity>

            {/* Download */}
            <TouchableOpacity
              onPress={() => setDownloadSheetOpen(true)}
              activeOpacity={0.8}
              accessibilityLabel="Download options"
              style={{
                width: 48,
                borderWidth: 0.5,
                borderColor: colors.progressTrack,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons
                name="download-outline"
                size={20}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleShare}
              activeOpacity={0.8}
              accessibilityLabel="Share this show"
              style={{
                width: 48,
                borderWidth: 0.5,
                borderColor: colors.progressTrack,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ShareIcon width={20} height={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

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

          {/* Similar shows (trailer chip now on backdrop) */}
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

      {/* Quality Picker Sheet (long-press) */}
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
