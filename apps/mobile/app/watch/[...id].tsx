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
import { ActivityIndicator, StatusBar, View } from "react-native";
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
} from "@filmsnaps/shared";
import { getLastProvider, saveLastProvider } from "../../lib/lastProvider";
import {
  resolvePlaybackProviderIdTiered,
} from "../../lib/resolvePlaybackProvider";
import {
  markWatchEntry,
  markPerfStage,
} from "../../lib/perfMetrics";
import {
  noteWatchSyncResolve,
  noteProviderAsyncFlip,
} from "../../lib/watchPerfMismatch";
import { takeEarlyPlayer, releaseEarlyPlayer } from "../../lib/earlyPlayerHolder";
import type { VideoPlayer } from "expo-video";
import { LanguagePromptSheet } from "../../components/player/LanguagePromptSheet";
import { useDirectStreamPipeline } from "../../hooks/useDirectStreamPipeline";
import { useDoubleBackExit } from "../../hooks/useDoubleBackExit";
import {
  BackExitToast,
  BackdropGate,
  InvalidWatchScreen,
} from "../../components/watch/WatchRouteUI";
import { colors } from "../../theme/colors";
import { trackFeatureUsed, trackPlayerError } from "../../lib/telemetry";

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

  // FIX 9: stamp watchEntry on the details-started perf session (if any).
  useEffect(() => {
    markWatchEntry();
  }, []);

  // Last direct provider for this title (tier 4). D1: with NO route param we
  // do NOT resolve/start a pipeline until this read lands (cap 250ms) — one
  // resolution, no async flip, no cancelled in-flight pipeline.
  const routeProvider =
    typeof params.provider === "string" ? params.provider : undefined;
  const hasUrlParams = !!(params.videoUrl || params.fileUri);
  const [lastProvider, setLastProvider] = useState<string | null>(null);
  const [providerReady, setProviderReady] = useState(
    !!routeProvider || hasUrlParams,
  );
  useEffect(() => {
    if (routeProvider || hasUrlParams) {
      setProviderReady(true);
      return;
    }
    if (!id) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) setProviderReady(true);
    }, 250);
    getLastProvider(type, id)
      .then((p) => {
        if (cancelled) return;
        setLastProvider(p);
        setProviderReady(true);
        clearTimeout(timer);
      })
      .catch(() => {
        if (cancelled) return;
        setProviderReady(true);
        clearTimeout(timer);
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [routeProvider, hasUrlParams, id, type]);

  // FIX 1: canonical precedence — route > session pick > defaultServer >
  // lastProvider > platform default. Resolved ONCE when providerReady
  // (route param or after the capped lastProvider read).
  const resolvedSync = providerReady
    ? resolvePlaybackProviderIdTiered({
        routeProvider,
        savedServer: settings.defaultServer || null,
        lastProvider,
        anime: isAnime,
      })
    : null;
  const provider = resolvedSync?.providerId;
  // [watchperf] FIX 1 — first sync resolve + tier (once, after providerReady).
  const syncResolveLoggedRef = useRef(false);
  useEffect(() => {
    if (syncResolveLoggedRef.current || !id || !resolvedSync) return;
    syncResolveLoggedRef.current = true;
    markPerfStage("providerSyncResolve", {
      providerId: resolvedSync.providerId,
      tier: resolvedSync.tier,
    });
    noteWatchSyncResolve(
      type,
      id,
      season,
      episode,
      resolvedSync.providerId,
      resolvedSync.tier,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerReady, resolvedSync, id]);
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

  // The direct provider the pipeline fetches for. D1: one resolution —
  // route param immediately, else after the capped lastProvider read.
  // Manual server pick and chain-head sync are layered on top.
  const [pickedProvider, setPickedProvider] = useState<string | null>(null);
  const [headProviderOverride, setHeadProviderOverride] = useState<string | null>(null);
  const userPickedProviderRef = useRef(false);
  const activeDirectProvider =
    pickedProvider ??
    headProviderOverride ??
    (providerReady ? provider : routeProvider ?? null);

  // D1: ASYNC_FLIP only if the resolved provider itself changed after a prior
  // non-null resolve (should not happen — resolution is once when ready).
  const lastResolvedProviderRef = useRef<string | null>(routeProvider ?? null);
  useEffect(() => {
    if (!providerReady || !provider || userPickedProviderRef.current) return;
    const prev = lastResolvedProviderRef.current;
    lastResolvedProviderRef.current = provider;
    if (prev !== null && prev !== provider) {
      markPerfStage("providerAsyncFlip", {
        from: prev,
        to: provider,
        tier: resolvedSync?.tier ?? "last",
      });
      noteProviderAsyncFlip(
        type,
        id ?? "",
        season,
        episode,
        prev,
        provider,
        resolvedSync?.tier ?? "last",
      );
    }
  }, [providerReady, provider, resolvedSync, type, id, season, episode]);

  // ── Direct pipeline (fetch + rank + promote last-working source) ──
  // Settings are read through a ref so changing a setting (e.g. preferred
  // language) never re-fetches streams and resets an in-progress playback.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const languageAnswered = settings.hasAnsweredLanguagePrompt;

  const direct = useDirectStreamPipeline({
    id,
    type,
    isDirectPlayback: isDirectPlayback && !!activeDirectProvider && providerReady,
    provider: activeDirectProvider ?? undefined,
    languageAnswered,
    initialSeason: season,
    initialEpisode: episode,
    settingsRef,
    // FIX 2: after a manual server pick, never chain away from that id.
    lockProvider: userPickedProviderRef.current,
  });
  // The player's server picker selected a direct provider — repoint the
  // pipeline at it; the provider change re-runs the fetch (and the cache is
  // keyed per provider, so this can never return the previous pool).
  const handleDirectSelected = (selectedId: string) => {
    userPickedProviderRef.current = true;
    setPickedProvider(selectedId);
    setHeadProviderOverride(null);
  };

  // Remember which direct provider actually served this title — CW and the
  // details page restore it on the next visit.
  useEffect(() => {
    if (!isDirectPlayback || !id || !activeDirectProvider) return;
    if (direct.links.length === 0) return;
    saveLastProvider(type, id, activeDirectProvider).catch(() => {});
  }, [isDirectPlayback, id, type, activeDirectProvider, direct.links.length]);

  // Sync head provider when the chain head belongs to a different provider.
  // This covers: CW promoted a way2movies link, HDHub failed and fallback
  // picked a way2movies/spacedom link. Manual picks always win (pickedProvider).
  useEffect(() => {
    if (!isDirectPlayback || direct.links.length === 0) return;
    if (userPickedProviderRef.current) return;
    const head = direct.links[direct.bestIndex];
    const headProvider = head?._meta?.providerId;
    if (headProvider && headProvider !== activeDirectProvider) {
      setHeadProviderOverride(headProvider);
    }
  }, [isDirectPlayback, direct.links, direct.bestIndex, activeDirectProvider]);

  // ── Android two-step back guard with calm floating toast ──
  const { showToast, toastOpacity } = useDoubleBackExit();

  // Get the actual video URL (either remote or local file)
  const directVideoUrl = fileUri || videoUrl;

  // D3: adopt the details-held warm player once for this key (take removes
  // it from the holder — HevcPlayer owns release from here).
  const earlyPlayerStateRef = useRef<{
    key: string;
    player: VideoPlayer;
  } | null>(null);
  // If the holder was taken but HevcPlayer never mounted (language prompt,
  // gate, error), release on unmount so no orphan player survives to home.
  useEffect(() => {
    return () => {
      const held = earlyPlayerStateRef.current;
      if (held) {
        earlyPlayerStateRef.current = null;
        try {
          held.player.release();
        } catch {}
        releaseEarlyPlayer(held.key);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (
    providerReady &&
    isDirectPlayback &&
    activeDirectProvider &&
    activeDirectProvider !== "falix" &&
    !directVideoUrl &&
    !earlyPlayerStateRef.current
  ) {
    const earlyKey = `${type}:${parseInt(id, 10)}:s${season ?? 0}:e${episode ?? 0}:${activeDirectProvider}`;
    const taken = takeEarlyPlayer(earlyKey);
    if (taken) {
      earlyPlayerStateRef.current = { key: earlyKey, player: taken.player };
    }
  }

  // ── Screen content (one of: invalid / loading / error / player / webview) ──
  let content: React.ReactNode;

  // E2 — invalid route: emit a route-surface player_error once per mount.
  const invalidReportedRef = useRef(false);
  useEffect(() => {
    if (!id || !type || invalidReportedRef.current) return;
    invalidReportedRef.current = true;
    trackPlayerError({
      errorClass: "invalid-route",
      surface: "route",
      providerId: "unknown",
      mediaType: "movie",
    });
  }, [id, type]);

  if (!id || !type) {
    content = (
      <InvalidWatchScreen
        onGoBack={() => nav.goBack({ fallback: "/(tabs)" })}
      />
    );
  } else if (!providerReady && !directVideoUrl) {
    // D1: no route provider — hold the surface until lastProvider resolves
    // (250ms cap) so we resolve once and start a single pipeline.
    content = (
      <BackdropGate backdropUrl={backdropUrl}>
        <StatusBar barStyle="light-content" hidden />
        <ActivityIndicator size="large" color={colors.gold} />
      </BackdropGate>
    );
  } else if (isDirectPlayback && activeDirectProvider && activeDirectProvider !== "falix") {
    if (!languageAnswered) {
      // First run — ask the user their preferred audio language before
      // ranking anything. The answer feeds the very first selection.
      content = (
        <BackdropGate backdropUrl={backdropUrl}>
          <StatusBar barStyle="light-content" hidden />
          <LanguagePromptSheet
            onSelect={(value) => {
              trackFeatureUsed("language_prompt_answered", "watch");
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
            stageMessage: direct.stageMessage,
          }}
          onDirectSelected={handleDirectSelected}
          onDirectRetry={direct.refetch}
          onDirectEpisodeChange={(s, e) => {
            direct.setSeason(s);
            direct.setEpisode(e);
          }}
          earlyPlayer={earlyPlayerStateRef.current?.player ?? null}
          earlyPlayerKey={earlyPlayerStateRef.current?.key}
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
  } else if (!providerReady) {
    content = (
      <BackdropGate backdropUrl={backdropUrl}>
        <StatusBar barStyle="light-content" hidden />
        <ActivityIndicator size="large" color={colors.gold} />
      </BackdropGate>
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
