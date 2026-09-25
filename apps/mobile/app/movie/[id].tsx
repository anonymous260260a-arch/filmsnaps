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
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeNavigation } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { trackFeatureUsed } from "../../lib/telemetry";
import { colors } from "../../theme/colors";
import { getImageUrl, getTrailerKey } from "@filmsnaps/shared";
import { ProgressiveImage } from "../../components/ProgressiveImage";
import { typography } from "../../lib/typography";
import { FilmGrain } from "../../components/FilmGrain";
import { useMovieDetails } from "../../hooks/useTMDB";
import {
  beginDetail,
  markDetailFirstFrame,
  markDetailContentReady,
} from "../../lib/detailMetrics";
import { DETAIL_BACKDROP_SIZE } from "../../components/heroLayout";
import { openDetail, prepareDetail, toDetailNavItem } from "../../lib/openDetail";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
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
import { prefetchStreams, peekPrefetchStreams, setStreamHandoff } from "../../lib/streamPrefetch";
import { resolvePlaybackProviderId } from "../../lib/resolvePlaybackProvider";
import { beginDetailsTap } from "../../lib/perfMetrics";
import { holdEarlyPlayer, releaseEarlyPlayer } from "../../lib/earlyPlayerHolder";
import { useSettings } from "../../lib/settings";
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
  const routeParams = useLocalSearchParams<{
    id: string;
    title?: string;
    poster_path?: string;
    backdrop_path?: string;
    vote_average?: string;
    release_date?: string;
    blurhash?: string;
  }>();
  const id = routeParams.id;
  const nav = useSafeNavigation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = useWindowDimensions();
  const { data, isLoading, isFetched, isError } = useMovieDetails(id!);

  // Params-first snapshot: header fields available before query resolves.
  const paramsSnapshot = useMemo(() => {
    if (!routeParams.title && !routeParams.poster_path && !routeParams.backdrop_path) {
      return null;
    }
    return {
      title: routeParams.title ?? "",
      poster_path: routeParams.poster_path ?? null,
      backdrop_path: routeParams.backdrop_path ?? null,
      vote_average: routeParams.vote_average
        ? Number(routeParams.vote_average)
        : null,
      release_date: routeParams.release_date ?? null,
      blurhash: routeParams.blurhash ?? null,
    };
  }, [
    routeParams.title,
    routeParams.poster_path,
    routeParams.backdrop_path,
    routeParams.vote_average,
    routeParams.release_date,
    routeParams.blurhash,
  ]);

  // Phase 2 instrumentation — once per screen mount.
  const metricsStarted = useRef(false);
  useEffect(() => {
    if (metricsStarted.current || !id) return;
    metricsStarted.current = true;
    beginDetail("movie", String(id));
  }, [id]);

  useEffect(() => {
    if (isFetched) markDetailContentReady();
  }, [isFetched]);

  const BACKDROP_HEIGHT = Math.min(SCREEN_HEIGHT * 0.42, 350);
  const POSTER_WIDTH = 104;
  const POSTER_OVERLAP = 52;
  const scrollY = useRef(new Animated.Value(0)).current;

  // Header fields: query data wins; params are the pre-fetch fallback.
  const movie = data ?? null;
  const header = movie
    ? {
        title: movie.title || movie.name || "",
        poster_path: movie.poster_path ?? null,
        backdrop_path: movie.backdrop_path ?? null,
        vote_average: movie.vote_average ?? null,
        release_date: movie.release_date ?? null,
      }
    : paramsSnapshot;
  const title = header?.title || "";
  const queryReady = !!movie;

  const animeHit = useMemo(() => resolveMovie(id!) ?? null, [id]);

  const [bookmarked, setBookmarked] = useState(false);
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [resumeState, setResumeState] = useState<WatchProgress | null>(null);
  const { settings, loaded: settingsLoaded } = useSettings();
  const [downloadSheetOpen, setDownloadSheetOpen] = useState(false);

  // FIX 7: rank-option deps are value-level; selection re-prefetch debounced 500ms.
  // B1: prefetch only while focused — defer rank changes until next focus.
  const rankSig = `${settings.cellularMaxMB}|${settings.maxQuality}|${settings.preferredAudioLanguage}|${settings.defaultServer}`;
  const lastRankSigRef = useRef<string | null>(null);
  const pendingRankSigRef = useRef<string | null>(null);
  // D1: provider this details page resolved — Watch always passes it via ?provider=.
  const resolvedProviderRef = useRef<string | null>(null);
  // D3: set true when Watch is pressed so unmount cleanup keeps the warm player.
  const navigatedToWatchRef = useRef(false);
  // D3: last cache key we held a warm player for (release on leave-without-watch).
  const heldEarlyKeyRef = useRef<string | null>(null);
  // Bookmark / resume loads stay mount-driven (not focus-gated).
  useEffect(() => {
    if (!id) return;
    isBookmarked(id!).then(setBookmarked);
    getProgress(id!, "movie", undefined, undefined, animeHit != null).then(
      (p) => {
        if (p && p.percent > 0) setResumeState(p);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, animeHit]);
  useFocusEffect(
    useCallback(() => {
      if (!id || !settingsLoaded) return;
      // D3: each focus is a fresh visit — a prior Watch tap must not keep
      // skipping the blur release forever (that orphaned a playing holder).
      navigatedToWatchRef.current = false;
      // If rank options changed while unfocused, apply them on focus now.
      const sig = pendingRankSigRef.current ?? rankSig;
      pendingRankSigRef.current = null;
      const isFirst = lastRankSigRef.current === null;
      lastRankSigRef.current = sig;
      const delay = isFirst ? 0 : 500;
      let prefetchCancelled = false;
      const timer = setTimeout(() => {
        if (prefetchCancelled) return;
        resolvePlaybackProviderId({
          mediaType: "movie",
          tmdbId: parseInt(id),
          savedServer: settings.defaultServer,
        })
          .then((providerId) => {
            if (prefetchCancelled || !providerId) return;
            resolvedProviderRef.current = providerId;
            return prefetchStreams(parseInt(id), "movie", undefined, undefined, {
              cellularMaxMB: settings.cellularMaxMB,
              maxQuality: settings.maxQuality,
              preferredAudioLanguage: settings.preferredAudioLanguage,
              providerId,
              trigger: "details",
            })
              .then((snap) => {
                // D3: pipeline READY during details dwell → warm player on head.
                if (prefetchCancelled || !snap || snap.links.length === 0) return;
                const head = snap.links[snap.bestIndex];
                const key = `movie:${parseInt(id)}:s0:e0:${providerId}`;
                if (holdEarlyPlayer(key, head)) {
                  heldEarlyKeyRef.current = key;
                }
              })
              .catch((err) => {
                console.log(`[MovieDetail] Prefetch failed:`, err?.message);
              });
          })
          .catch(() => {});
      }, delay);
      return () => {
        prefetchCancelled = true;
        clearTimeout(timer);
        // D3: left details without navigating to watch → release the warm player.
        if (!navigatedToWatchRef.current && heldEarlyKeyRef.current) {
          releaseEarlyPlayer(heldEarlyKeyRef.current);
          heldEarlyKeyRef.current = null;
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, settingsLoaded, rankSig]),
  );
  // Track rank changes while unfocused so next focus re-prefetches with them.
  useEffect(() => {
    if (lastRankSigRef.current !== null && lastRankSigRef.current !== rankSig) {
      pendingRankSigRef.current = rankSig;
    }
  }, [rankSig]);

  const toggleBookmark = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !bookmarked;
setBookmarked(next);
      trackFeatureUsed("bookmark_save", "detail");
      if (next) {
      debouncedSaveBookmark({
        tmdbId: id!,
        mediaType: "movie",
        title: header?.title || "",
        posterPath: header?.poster_path ?? null,
        year: (header?.release_date ?? "").split("-")[0] ?? "",
        addedAt: Date.now(),
      });
      prefetchArtwork({
        poster_path: header?.poster_path,
        backdrop_path: header?.backdrop_path,
      });
      downloadToast.success("Saved to Library", 2500);
    } else {
      debouncedRemoveBookmark(id!);
      downloadToast.info("Removed from Saved", 2000);
    }
  }, [id, bookmarked, header]);

  const handleShare = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    trackFeatureUsed("share_used", "detail");
    Share.share({
      message: `Check out "${title}" on FilmSnaps 🎬\nhttps://filmsnap-pro.netlify.app/movie/${id}`,
    });
  }, [id, title]);

  const handleDownloadServer = useCallback(
    (server: string) => {
      const qs = new URLSearchParams({
        poster: header?.poster_path || "",
        backdrop: header?.backdrop_path || "",
      }).toString();
      nav.push(`/download/${server}/movie/${id}?${qs}`);
    },
    [id, nav, header?.poster_path, header?.backdrop_path],
  );

  // Deep link / cold route with no header params → full skeleton until data.
  // Params present → paint header immediately; skeleton only for query sections.
  if (!header && isLoading) {
    return <DetailSkeleton />;
  }

  if (!header && !isLoading) {
    return (
      <View
        className="flex-1 items-center justify-center bg-void"
        style={{ backgroundColor: colors.bg }}
        onLayout={() => markDetailFirstFrame()}
      >
        <Ionicons name="film-outline" size={48} color={colors.textTertiary} />
        <Text className="text-text-secondary mt-3">
          {isError ? "Couldn't load movie" : "Movie not found"}
        </Text>
      </View>
    );
  }

  const year =
    (movie?.release_date || header?.release_date)?.split("-")[0] ?? "";
  const genres = movie?.genres ?? [];
  const trailerKey = movie ? getTrailerKey(movie.videos) : null;
  const cast = movie?.credits?.cast?.slice(0, 10) ?? [];
  const backdropPath = header?.backdrop_path ?? null;
  const posterPath = header?.poster_path ?? null;
  const voteAverage = header?.vote_average ?? null;

  return (
    <View
      className="flex-1 bg-void"
      style={{ backgroundColor: colors.bg }}
      onLayout={() => markDetailFirstFrame()}
    >
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
          {backdropPath ? (
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
                uri={getImageUrl(backdropPath, DETAIL_BACKDROP_SIZE)}
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
            {posterPath ? (
              <ProgressiveImage
                uri={getImageUrl(posterPath, "w342")}
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
                {voteAverage != null && voteAverage > 0 && (
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
                      ★ {voteAverage.toFixed(1)}
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

                {queryReady && movie.runtime ? (
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

              {/* Genre badges — query-dependent */}
              {queryReady && genres.length > 0 && (
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
            {/* Primary Watch/Resume CTA — resume state is local; title works from params */}
            <TouchableOpacity
              onPress={() => {
                const base = `/watch/movie/${id}`;
                const params = new URLSearchParams(
                  resumeState && resumeState.percent < 0.95
                    ? {
                        t: String(Math.floor(resumeState.currentTime)),
                        backdrop: backdropPath || "",
                      }
                    : { backdrop: backdropPath || "" },
                );
                if (animeHit) {
                  params.set("isAnime", "1");
                  params.set("mid", String(animeHit.malId));
                  if (animeHit.anilistId != null)
                    params.set("aid", String(animeHit.anilistId));
                  params.set("audio", "sub");
                }
                // D1: always pass the provider this details page resolved so
                // watch does one sync resolve — no async flip, no cancelled
                // pipeline. Peek with the SAME provider id for the exact key.
                const resolvedProvider = resolvedProviderRef.current;
                if (resolvedProvider) {
                  params.set("provider", resolvedProvider);
                }
                // FIX 5: hand the warm snapshot to watch; still runs trigger=watch.
                const snap = peekPrefetchStreams(parseInt(id), "movie", undefined, undefined, {
                  cellularMaxMB: settings.cellularMaxMB,
                  maxQuality: settings.maxQuality,
                  preferredAudioLanguage: settings.preferredAudioLanguage,
                  providerId: resolvedProvider ?? undefined,
                });
                if (snap && snap.links.length > 0) {
                  const head = snap.links[snap.bestIndex];
                  setStreamHandoff(
                    parseInt(id),
                    "movie",
                    undefined,
                    undefined,
                    resolvedProvider ?? head?._meta?.providerId ?? "direct",
                    snap,
                  );
                  if (head?.url) params.set("streamUrl", head.url);
                  params.set("bestIndex", String(snap.bestIndex));
                }
                // FIX 9: detailsTap opens the perf session before the player tree.
                const perfKey = `movie:${id}`;
                beginDetailsTap(perfKey);
                // D3: keep the warm player for adoption — don't release on unmount.
                navigatedToWatchRef.current = true;
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
              {queryReady && trailerKey ? (
                <TouchableOpacity
                  onPress={() => {
                    trackFeatureUsed("trailer_open", "detail");
                    setTrailerOpen(true);
                  }}
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

          {/* Overview — query-dependent */}
          {queryReady && movie.overview ? (
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

          {/* Cast — query-dependent */}
          {queryReady && cast.length > 0 && (
            <CastCarousel cast={movie.credits.cast} />
          )}

          {/* Similar movies — query-dependent */}
          {queryReady && movie.similar?.results?.length > 0 && (
            <View className="mt-6">
              <MediaCarousel
                title="Similar Movies"
                data={movie.similar.results}
                onItemPressIn={(item) => {
                  const navItem = toDetailNavItem(item, "movie");
                  if (navItem)
                    prepareDetail(navItem, "similar", queryClient, router);
                }}
                onItemPress={(item) => {
                  const navItem = toDetailNavItem(item, "movie");
                  if (navItem)
                    openDetail(navItem, "similar", {
                      queryClient,
                      router,
                      nav,
                    });
                }}
              />
            </View>
          )}

          {/* Query-dependent placeholder while details load (params-only paint) */}
          {!queryReady && !isLoading && isError && (
            <View className="mt-6">
              <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                Details unavailable — check your connection.
              </Text>
            </View>
          )}
          {!queryReady && isLoading && (
            <View className="mt-6" style={{ gap: 8 }}>
              <View
                style={{
                  height: 14,
                  width: "40%",
                  borderRadius: 4,
                  backgroundColor: colors.bgElevated,
                }}
              />
              <View
                style={{
                  height: 12,
                  width: "100%",
                  borderRadius: 4,
                  backgroundColor: colors.bgElevated,
                }}
              />
              <View
                style={{
                  height: 12,
                  width: "85%",
                  borderRadius: 4,
                  backgroundColor: colors.bgElevated,
                }}
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
