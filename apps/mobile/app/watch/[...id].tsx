import React, { useRef, useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  BackHandler,
  Platform,
  Animated,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { useSafeNavigation, safeGoBack } from "@/lib/navigation";
import { colors } from "../../theme/colors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { VideoWebView } from "../../components/VideoWebView";
import { HevcPlayer } from "../../components/HevcPlayer";
import { isDirectVideoUrl } from "../../lib/hevc";
import { fetchDirectStreams } from "../../lib/directStreams";
import { useSettings } from "../../lib/settings";
import { getProvidersForMode } from "@filmsnaps/shared";
import { selectBestStream } from "../../lib/streamSelector";
import { consumePrefetch } from "../../lib/streamPrefetch";
import type { ValidationResult } from "../../lib/streamValidator";
import { getLastWorkingSource } from "../../lib/lastWorkingSource";
import { LanguagePromptSheet } from "../../components/player/LanguagePromptSheet";
import type { StreamLink } from "../../components/player/streamTypes";

export default function WatchScreen() {
  const [prevalidatedResults, setPrevalidatedResults] = useState<Map<
    string,
    ValidationResult
  > | null>(null);
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();
  const { settings, updateSetting } = useSettings();
  const params = useLocalSearchParams<{
    id: string[];
    backdrop?: string;
    provider?: string;
    videoUrl?: string;
    fileUri?: string;
    title?: string;
    startAt?: string;
    /** Resume position in seconds (details pages pass `t`) */
    t?: string;
    isAnime?: string;
    mid?: string;
    aid?: string;
    audio?: string;
  }>();

  const segments = params.id ?? [];
  const type = segments[0] as "movie" | "tv";
  const id = segments[1];
  const season = segments[2] ? Number(segments[2]) : undefined;
  const episode = segments[3] ? Number(segments[3]) : undefined;
  const isAnime = params.isAnime === "1";

  // Resolve provider: route param → defaultServer → first available (matches VideoWebView fallback)
  const provider = (() => {
    if (typeof params.provider === "string") return params.provider;
    if (settings.defaultServer) return settings.defaultServer;
    // Fallback: first enabled provider for this media type (usually "direct")
    const mode = isAnime ? "anime" : "movie_tv";
    const available = getProvidersForMode(mode);
    return available[0]?.id;
  })();
  const backdropUrl = params.backdrop || undefined;
  const videoUrl = params.videoUrl || undefined;
  const fileUri = params.fileUri || undefined;
  const title = params.title || undefined;
  // Resume position: details pages pass `t` (seconds); honor `startAt` too
  const startAt = params.startAt
    ? Number(params.startAt)
    : params.t
      ? Number(params.t)
      : 0;
  const animeMalId = params.mid ? Number(params.mid) : undefined;
  const animeAnilistId = params.aid ? Number(params.aid) : undefined;
  const animeAudio = params.audio === "dub" ? "dub" : "sub";

  // Determine if this is a direct video playback (HEVC/Falix/Direct provider)
  const isDirectPlayback =
    provider === "falix" ||
    provider === "direct" ||
    isDirectVideoUrl(videoUrl || "") ||
    !!fileUri;

  // ── Direct provider: fetch stream links from /api/player/direct ──
  const [directLinks, setDirectLinks] = useState<StreamLink[]>([]);
  const [bestLinkIndex, setBestLinkIndex] = useState(0);
  const [lastWorkingIndex, setLastWorkingIndex] = useState<number | undefined>(
    undefined,
  );
  const [selectionReason, setSelectionReason] = useState<string>("");
  const [directLoading, setDirectLoading] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);
  /** Bumped by Retry to re-run the fetch. */
  const [fetchToken, setFetchToken] = useState(0);
  /** Bumped when the user switches to the direct server from the picker. */
  const [directToken, setDirectToken] = useState(0);
  /** Active season/episode for direct links (EpisodeRail updates these). */
  const [directSeason, setDirectSeason] = useState<number | undefined>(season);
  const [directEpisode, setDirectEpisode] = useState<number | undefined>(
    episode,
  );

  // Settings are read through a ref so changing a setting (e.g. preferred
  // language) never re-fetches streams and resets an in-progress playback.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const languageAnswered = settings.hasAnsweredLanguagePrompt;

  const loadStreams = useCallback(() => {
    if (!id) return;
    // Only load when the direct server is actually in play — embed-only
    // sessions never touch the direct API.
    if (provider !== "direct" && directToken === 0) return;
    // First-run: don't rank anything until the language prompt is answered —
    // the very first selection should already match the user's taste.
    if (!languageAnswered) return;

    let cancelled = false;
    setDirectLoading(true);
    setDirectError(null);

    const mediaType: "movie" | "tv" = type;

    // 1. Try consuming prefetched results (includes probe outcomes)
    const prefetched = consumePrefetch(
      parseInt(id),
      mediaType,
      directSeason,
      directEpisode,
    );
    if (prefetched) {
      console.log(
        `[WatchScreen] Using stream cache (bestIndex=${prefetched.bestIndex}, validated=${prefetched.bestValidated}, probed=${prefetched.probedCount})`,
      );
      // Promote the source that worked last time (stable URL identity).
      // Resolved BEFORE handing links over so the player mounts once with the
      // final index instead of opening one source and discarding it mid-load.
      (async () => {
        let idx = prefetched.bestIndex;
        let lastUsed: number | undefined;
        try {
          const lastKey = await getLastWorkingSource(mediaType, id);
          if (!cancelled && lastKey) {
            const found = prefetched.links.findIndex(
              (l) => l.url.split("?")[0] === lastKey,
            );
            if (found >= 0) {
              idx = found;
              lastUsed = found;
            }
          }
        } catch {}
        if (cancelled) return;
        setDirectLinks(prefetched.links);
        setPrevalidatedResults(prefetched.validationResults);
        setSelectionReason(prefetched.selectionReason);
        setBestLinkIndex(idx);
        setLastWorkingIndex(lastUsed);
        setDirectLoading(false);
      })();
      return;
    }

    // No cache — fetch fresh. Runs entirely on-device: the upstream stream
    // API is called directly (provider list comes from the remote
    // stream-providers.json config) — no server proxy hop.
    (async () => {
      try {
        const bundle = await fetchDirectStreams(
          parseInt(id, 10),
          mediaType,
          directSeason,
          directEpisode,
        );
        if (cancelled) return;
        if (bundle.links.length === 0) {
          setDirectError(
            "No streams available for this title right now. Try again later.",
          );
          return;
        }
        const selection = await selectBestStream(bundle.links, {
          cellularMaxMB: settingsRef.current.cellularMaxMB ?? 3000,
          maxQuality: settingsRef.current.maxQuality ?? null,
          preferredLanguage:
            settingsRef.current.preferredAudioLanguage ?? "auto",
          runtimeMinutes: type === "tv" ? 45 : 120,
        });

        // Promote the source that worked last time (stable URL identity)
        let bestIndex = selection.bestIndex;
        let lastUsed: number | undefined;
        try {
          const lastKey = await getLastWorkingSource(mediaType, id);
          if (lastKey) {
            const found = selection.sortedLinks.findIndex(
              (l) => l.url.split("?")[0] === lastKey,
            );
            if (found >= 0) {
              bestIndex = found;
              lastUsed = found;
            }
          }
        } catch {}

        if (cancelled) return;
        setDirectLinks(selection.sortedLinks);
        setBestLinkIndex(bestIndex);
        setLastWorkingIndex(lastUsed);
        setSelectionReason(selection.selectionReason);
        setPrevalidatedResults(null);
      } catch (err: any) {
        if (!cancelled) {
          setDirectError(
            err?.message === "undefined"
              ? "Couldn't reach the stream provider."
              : `Couldn't load streams. ${err?.message ?? ""}`.trim(),
          );
        }
      } finally {
        if (!cancelled) setDirectLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    provider,
    id,
    type,
    directSeason,
    directEpisode,
    fetchToken,
    languageAnswered,
    directToken,
  ]);

  useEffect(() => {
    const cleanup = loadStreams();
    return cleanup;
  }, [loadStreams, fetchToken]);

  const retryFetch = useCallback(() => {
    setFetchToken((t) => t + 1);
  }, []);

  // ── Android two-step back guard with calm floating toast ──
  const lastBackPressRef = useRef(0);
  const [showBackToast, setShowBackToast] = useState(false);
  const backToastOpacity = useRef(new Animated.Value(0)).current;
  const backToastTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const onBackPress = () => {
      const now = Date.now();
      if (now - lastBackPressRef.current < 3000) {
        // Two back presses within 3s — close player
        safeGoBack({ fallback: "/(tabs)" });
        return true;
      }
      lastBackPressRef.current = now;

      // Trigger subtle back toast
      setShowBackToast(true);
      Animated.timing(backToastOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();

      if (backToastTimerRef.current) clearTimeout(backToastTimerRef.current);
      backToastTimerRef.current = setTimeout(() => {
        Animated.timing(backToastOpacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }).start(() => setShowBackToast(false));
      }, 2400);

      return true; // consume the event on first press
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onBackPress);
    return () => {
      sub.remove();
      if (backToastTimerRef.current) clearTimeout(backToastTimerRef.current);
    };
    // nav is deliberately not a dep: it's a new object every render, and
    // re-running this effect clears the pending toast-hide timer the moment
    // setShowBackToast(true) re-renders the screen. safeGoBack is a module fn.
  }, [backToastOpacity]);

  // Get the actual video URL (either remote or local file)
  const directVideoUrl = fileUri || videoUrl;

  // ── Screen content (one of: invalid / loading / error / player / webview) ──
  let content: React.ReactNode;

  if (!id || !type) {
    content = (
      <View
        className="flex-1 items-center justify-center px-6"
        style={{ backgroundColor: colors.bg }}
      >
        <StatusBar barStyle="light-content" />
        <View
          className="w-16 h-16 rounded-2xl items-center justify-center mb-5 border"
          style={{
            backgroundColor: colors.bgCard,
            borderColor: colors.borderSubtle,
          }}
        >
          <Ionicons name="alert-circle-outline" size={32} color={colors.gold} />
        </View>
        <Text
          className="text-lg font-semibold mb-2 text-center"
          style={{ color: colors.textPrimary, fontFamily: "Inter_600SemiBold" }}
        >
          Invalid Video URL
        </Text>
        <Text
          className="text-sm text-center mb-6 leading-6 max-w-xs"
          style={{ color: colors.textSecondary }}
        >
          This link doesn't point to a valid movie or TV show.
        </Text>
        <TouchableOpacity
          onPress={() => nav.goBack({ fallback: "/(tabs)" })}
          className="rounded-xl py-3 px-8"
          style={{ backgroundColor: colors.gold }}
          activeOpacity={0.8}
        >
          <Text
            className="font-bold text-sm"
            style={{ color: colors.bg, fontFamily: "Inter_600SemiBold" }}
          >
            Go Back
          </Text>
        </TouchableOpacity>
      </View>
    );
  } else if (isDirectPlayback && provider === "direct") {
    if (!languageAnswered) {
      // First run — ask the user their preferred audio language before
      // ranking anything. The answer feeds the very first selection.
      content = (
        <View className="flex-1" style={{ backgroundColor: colors.playerBg }}>
          <StatusBar barStyle="light-content" hidden />
          {backdropUrl ? (
            <Image
              source={{ uri: backdropUrl }}
              contentFit="cover"
              blurRadius={12}
              style={StyleSheet.absoluteFill}
              transition={200}
            />
          ) : null}
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: "rgba(7,7,8,0.72)" },
            ]}
          />
          <LanguagePromptSheet
            onSelect={(value) => {
              updateSetting("preferredAudioLanguage", value);
              updateSetting("hasAnsweredLanguagePrompt", true);
            }}
          />
        </View>
      );
    } else {
      // Unified player page: direct provider renders as the first server in
      // VideoWebView's ServerPickerSheet — 16:9 player area, season/episode
      // rails, source switching, but no WebView guard/security machinery.
      content = (
        <VideoWebView
          type={type}
          id={id}
          season={season}
          episode={episode}
          initialProvider={provider}
          backdropUrl={backdropUrl}
          isAnime={isAnime}
          animeMalId={animeMalId}
          animeAnilistId={animeAnilistId}
          animeAudio={animeAudio}
          title={title}
          startAt={startAt}
          onClose={() => nav.goBack({ fallback: "/(tabs)" })}
          directStream={{
            links: directLinks,
            bestIndex: bestLinkIndex,
            prevalidated: prevalidatedResults,
            selectionReason,
            lastWorkingIndex,
            loading: directLoading,
            error: directError,
          }}
          onDirectSelected={() => {
            if (directLinks.length === 0) setFetchToken((t) => t + 1);
          }}
          onDirectRetry={() => setFetchToken((t) => t + 1)}
          onDirectEpisodeChange={(s, e) => {
            setDirectSeason(s);
            setDirectEpisode(e);
          }}
        />
      );
    }
  } else if (isDirectPlayback && directVideoUrl) {
    // Falix / local files — single URL playback
    content = (
      <HevcPlayer
        videoUrl={directVideoUrl}
        tmdbId={id}
        mediaType={type}
        season={season}
        episode={episode}
        startAt={startAt}
        title={title}
        backdropUrl={backdropUrl}
        onClose={() => nav.goBack({ fallback: "/(tabs)" })}
      />
    );
  } else {
    // Default: WebView player for streaming providers
    content = (
      <VideoWebView
        type={type}
        id={id}
        season={season}
        episode={episode}
        initialProvider={provider}
        backdropUrl={backdropUrl}
        isAnime={isAnime}
        animeMalId={animeMalId}
        animeAnilistId={animeAnilistId}
        animeAudio={animeAudio}
        onClose={() => nav.goBack({ fallback: "/(tabs)" })}
      />
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.playerBg }}>
      {content}

      {/* Floating Android Back Guard Toast — rendered on every branch */}
      {showBackToast && (
        <Animated.View
          style={{
            position: "absolute",
            bottom: insets.bottom + 24,
            alignSelf: "center",
            opacity: backToastOpacity,
            zIndex: 9999,
          }}
          pointerEvents="none"
        >
          <View
            className="flex-row items-center px-4 py-2.5 rounded-full border shadow-lg"
            style={{
              backgroundColor: "rgba(14, 14, 17, 0.92)",
              borderColor: colors.borderSubtle,
            }}
          >
            <Ionicons
              name="arrow-back-circle-outline"
              size={16}
              color={colors.gold}
              style={{ marginRight: 8 }}
            />
            <Text
              className="text-xs font-medium"
              style={{ color: colors.textPrimary }}
            >
              Press back again to exit player
            </Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
}
