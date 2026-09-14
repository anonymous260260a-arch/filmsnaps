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
import { useSettings } from "../../lib/settings";
import { getProvidersForMode } from "@filmsnaps/shared";
import { prefetchStreams } from "../../lib/streamPrefetch";
import type { ValidationResult } from "../../lib/streamValidator";
import {
  forgetWorkingSource,
  getLastWorkingSource,
} from "../../lib/lastWorkingSource";
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
  // Loading starts TRUE for direct sessions: the pipeline hasn't answered
  // yet, and "loading=false with 0 links" on the very first render is
  // indistinguishable from "finished, nothing found" — it once made the
  // player's auto-fallback fire before the pipeline even started.
  const [directLoading, setDirectLoading] = useState(isDirectPlayback);
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

    // Single source of truth: join the pipeline the details page / CW home
    // already started (or start it here). The snapshot's links are frozen and
    // its head is probe-resolved (dead candidates struck, badge advanced) —
    // the player mounts straight on the head with no re-ranking.
    (async () => {
      try {
        const snap = await prefetchStreams(
          parseInt(id, 10),
          type,
          directSeason,
          directEpisode,
          {
            cellularMaxMB: settingsRef.current.cellularMaxMB ?? 3000,
            maxQuality: settingsRef.current.maxQuality ?? null,
            preferredAudioLanguage:
              settingsRef.current.preferredAudioLanguage ?? "auto",
            trigger: "watch",
          },
        );
        if (cancelled) return;
        if (!snap || snap.links.length === 0) {
          setDirectError(
            "No streams available for this title right now. Try again later.",
          );
          return;
        }
        console.log(
          `[Flow] watch: pipeline ready — head #${snap.bestIndex} verified=${snap.bestValidated} allDead=${snap.allDead}`,
        );

        // Promote the source that worked last time (stable URL identity) by
        // REORDERING the chain: the head (index 0) is always what plays
        // first, so promotion moves the remembered source to the front and
        // keeps the rest in priority order. A remembered URL the probes
        // condemned is poisoned — forgotten, never promoted.
        let links = snap.links;
        let bestIndex = snap.bestIndex;
        let lastUsed: number | undefined;
        try {
          const lastKey = await getLastWorkingSource(type, id);
          if (!cancelled && lastKey) {
            const found = links.findIndex(
              (l) => l.url.split("?")[0] === lastKey,
            );
            if (found >= 0) {
              const outcome = snap.validationResults.get(
                links[found].url,
              )?.outcome;
              if (outcome === "dead") {
                console.log(
                  "[Flow] watch: remembered source is probe-dead — forgetting it",
                );
                forgetWorkingSource(type, id).catch(() => {});
              } else {
                // Promotion must respect the same cap the chain was ranked
                // with: a remembered file that is known-oversize for the
                // current connection auto-buffered last time — it plays only
                // if the user picks it manually.
                const sizeBytes = links[found]._meta?.sizeBytes ?? 0;
                if (
                  sizeBytes > 0 &&
                  snap.capBytes > 0 &&
                  sizeBytes > snap.capBytes
                ) {
                  console.log(
                    `[Flow] watch: remembered source is ${(sizeBytes / 1e9).toFixed(1)}GB — over the ${Math.round(snap.capBytes / 1e6)}MB cap, not promoting`,
                  );
                } else {
                  console.log(
                    `[Flow] watch: promoting last-working source to chain head (was #${found})`,
                  );
                  links = [
                    links[found],
                    ...links.slice(0, found),
                    ...links.slice(found + 1),
                  ];
                  bestIndex = 0;
                  lastUsed = 0;
                }
              }
            }
          }
        } catch {}

        if (cancelled) return;
        setDirectLinks(links);
        setPrevalidatedResults(snap.validationResults);
        setSelectionReason(snap.selectionReason);
        setBestLinkIndex(bestIndex);
        setLastWorkingIndex(lastUsed);
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
