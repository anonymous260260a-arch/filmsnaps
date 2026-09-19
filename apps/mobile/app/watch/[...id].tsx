/**
 * Watch route — resolves the provider, picks the playback surface, and
 * renders it. All heavy lifting lives in focused modules:
 *
 *   - provider resolution: shared registry (resolveInitialProviderId)
 *   - direct-stream fetch/promotion: hooks/useDirectStreamPipeline
 *   - Android two-step back guard: hooks/useDoubleBackExit
 *   - route UI pieces: components/watch/WatchRouteUI
 *   - the player itself: VideoWebView (embed + unified direct) / HevcPlayer
 */
import React, { useEffect, useRef, useState } from "react";
import { StatusBar, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeNavigation } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { VideoWebView } from "../../components/VideoWebView";
import { HevcPlayer } from "../../components/HevcPlayer";
import { isDirectVideoUrl } from "../../lib/hevc";
import { useSettings } from "../../lib/settings";
import {
  getProvider,
  isDirectProvider,
  resolveInitialProviderId,
} from "@filmsnaps/shared";
import { getLastProvider, saveLastProvider } from "../../lib/lastProvider";
import { LanguagePromptSheet } from "../../components/player/LanguagePromptSheet";
import { useDirectStreamPipeline } from "../../hooks/useDirectStreamPipeline";
import { useDoubleBackExit } from "../../hooks/useDoubleBackExit";
import {
  BackExitToast,
  BackdropGate,
  InvalidWatchScreen,
} from "../../components/watch/WatchRouteUI";
import { colors } from "../../theme/colors";

export default function WatchScreen() {
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

  // CW "bring me back": the last direct provider that actually served this
  // title outranks the saved default (but never an explicit route param).
  // Resolved async after mount — the sync below follows it until the user
  // manually picks a server in the player.
  const [lastProvider, setLastProvider] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (typeof params.provider !== "string" && id) {
      getLastProvider(type, id)
        .then((p) => {
          if (!cancelled) setLastProvider(p);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [params.provider, id, type]);

  // Resolve provider via the shared registry's canonical precedence:
  // route param → last-used (this title) → saved "default server" → platform
  // default (anime → megaplay).
  const provider = resolveInitialProviderId({
    platform: "mobile",
    routeProvider:
      (typeof params.provider === "string" ? params.provider : undefined) ??
      lastProvider,
    savedServer: settings.defaultServer || null,
    anime: isAnime,
  });
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

  // Determine if this is a direct video playback (HEVC/Falix/Direct provider).
  // Direct-ness comes from the registry's `type: "direct"` — never id matching.
  const providerDef = getProvider(provider ?? "");
  const isDirectPlayback =
    (providerDef ? isDirectProvider(providerDef) : false) ||
    isDirectVideoUrl(videoUrl || "") ||
    !!fileUri;

  // The direct provider the pipeline is currently fetching for. Starts at
  // the route-resolved provider; the in-player server picker can switch it
  // (onDirectSelected) to another registry direct provider (e.g. spacedom).
  const [activeDirectProvider, setActiveDirectProvider] = useState(provider);
  // Once the user manually picks a provider, async re-resolutions (the
  // last-provider lookup landing) must not yank the pipeline away from it.
  const userPickedProviderRef = useRef(false);
  useEffect(() => {
    if (!userPickedProviderRef.current) setActiveDirectProvider(provider);
  }, [provider]);

  // ── Direct pipeline (fetch + rank + promote last-working source) ──
  // Settings are read through a ref so changing a setting (e.g. preferred
  // language) never re-fetches streams and resets an in-progress playback.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const languageAnswered = settings.hasAnsweredLanguagePrompt;

  const direct = useDirectStreamPipeline({
    id,
    type,
    isDirectPlayback,
    provider: activeDirectProvider,
    languageAnswered,
    initialSeason: season,
    initialEpisode: episode,
    settingsRef,
  });
  // The player's server picker selected a direct provider — repoint the
  // pipeline at it; the provider change re-runs the fetch (and the cache is
  // keyed per provider, so this can never return the previous pool).
  const handleDirectSelected = (selectedId: string) => {
    userPickedProviderRef.current = true;
    setActiveDirectProvider(selectedId);
  };

  // Remember which direct provider actually served this title — CW and the
  // details page restore it on the next visit.
  useEffect(() => {
    if (!isDirectPlayback || !id || !activeDirectProvider) return;
    if (direct.links.length === 0) return;
    saveLastProvider(type, id, activeDirectProvider).catch(() => {});
  }, [isDirectPlayback, id, type, activeDirectProvider, direct.links.length]);

  // Sync activeDirectProvider when the head link belongs to a different provider.
  // This covers: CW promoted a way2movies link, HDHub failed and fallback
  // picked a way2movies/spacedom link, or the user picked a new source.
  useEffect(() => {
    if (!isDirectPlayback || direct.links.length === 0) return;
    const head = direct.links[direct.bestIndex];
    const headProvider = head?._meta?.providerId;
    if (
      headProvider &&
      headProvider !== activeDirectProvider &&
      !userPickedProviderRef.current
    ) {
      setActiveDirectProvider(headProvider);
    }
  }, [isDirectPlayback, direct.links, direct.bestIndex, activeDirectProvider]);

  // ── Android two-step back guard with calm floating toast ──
  const { showToast, toastOpacity } = useDoubleBackExit();

  // Get the actual video URL (either remote or local file)
  const directVideoUrl = fileUri || videoUrl;

  // ── Screen content (one of: invalid / loading / error / player / webview) ──
  let content: React.ReactNode;

  if (!id || !type) {
    content = (
      <InvalidWatchScreen
        onGoBack={() => nav.goBack({ fallback: "/(tabs)" })}
      />
    );
  } else if (isDirectPlayback && activeDirectProvider !== "falix") {
    if (!languageAnswered) {
      // First run — ask the user their preferred audio language before
      // ranking anything. The answer feeds the very first selection.
      content = (
        <BackdropGate backdropUrl={backdropUrl}>
          <StatusBar barStyle="light-content" hidden />
          <LanguagePromptSheet
            onSelect={(value) => {
              updateSetting("preferredAudioLanguage", value);
              updateSetting("hasAnsweredLanguagePrompt", true);
            }}
          />
        </BackdropGate>
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
          initialProvider={activeDirectProvider}
          backdropUrl={backdropUrl}
          isAnime={isAnime}
          animeMalId={animeMalId}
          animeAnilistId={animeAnilistId}
          animeAudio={animeAudio}
          title={title}
          startAt={startAt}
          onClose={() => nav.goBack({ fallback: "/(tabs)" })}
          directStream={{
            links: direct.links,
            bestIndex: direct.bestIndex,
            prevalidated: direct.prevalidated,
            selectionReason: direct.selectionReason,
            lastWorkingIndex: direct.lastWorkingIndex,
            loading: direct.loading,
            error: direct.error,
          }}
          onDirectSelected={handleDirectSelected}
          onDirectRetry={direct.refetch}
          onDirectEpisodeChange={(s, e) => {
            direct.setSeason(s);
            direct.setEpisode(e);
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
      <BackExitToast
        visible={showToast}
        opacity={toastOpacity}
        bottomInset={insets.bottom}
      />
    </View>
  );
}
