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
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StatusBar, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeNavigation } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { VideoWebView } from "../../components/VideoWebView";
import { HevcPlayer } from "../../components/HevcPlayer";
import { isDirectVideoUrl } from "../../lib/hevc";
import {
  resolveShow,
  resolveMovie,
  resolveShowIds,
} from "../../lib/anime/resolve";
import {
  ANIME_PROVIDER_ID,
  introDbFromUpstream,
} from "../../lib/anime/streams";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAnimeDirectPipeline } from "../../hooks/useAnimeDirectPipeline";
import { useSettings } from "../../lib/settings";
import { getProvider, isDirectProvider } from "@filmsnaps/shared";
import { getLastProvider, saveLastProvider } from "../../lib/lastProvider";
import { resolvePlaybackProviderIdTiered } from "../../lib/resolvePlaybackProvider";
import { markWatchEntry, markPerfStage } from "../../lib/perfMetrics";
import {
  noteWatchSyncResolve,
  noteProviderAsyncFlip,
} from "../../lib/watchPerfMismatch";
import {
  takeEarlyPlayer,
  releaseEarlyPlayer,
} from "../../lib/earlyPlayerHolder";
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
import {
  trackFeatureUsed,
  trackPlayerError,
  trackWatchOpened,
} from "../../lib/telemetry";

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
  // Anime auto-detect: watch opens that omit ?isAnime= (legacy/poisoned movie-TB
  // Continue Watching rows, historical bookmarks) still route to the JustAnime
  // direct surface when the TMDB twin is anime-mapped — the same detection the
  // movie/tv detail pages already apply to their Watch CTAs.
  const animeMapped = React.useMemo(() => {
    if (id == null) return false;
    if (type === "tv") return resolveShowIds(id) != null;
    return resolveMovie(id) != null;
  }, [type, id]);
  const isAnime = params.isAnime === "1" || (!params.isAnime && animeMapped);

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
  // Live sub/dub state — ONE source of truth shared with the player's toggle.
  // An explicit route param wins; otherwise we seed from the persisted
  // per-title pref (megaplay:audio:<id>) so the FIRST source the player opens
  // already matches what the toggle shows (the toggle remembers the last
  // session's choice, and the player must start with that same track).
  const explicitAudio =
    params.audio === "dub" ? "dub" : params.audio === "sub" ? "sub" : undefined;
  const [animeAudio, setAnimeAudio] = useState<"sub" | "dub">(
    explicitAudio ?? "sub",
  );
  // True once the effective audio is known — immediate for explicit params,
  // after the AsyncStorage read otherwise. The anime pipeline is gated on it so
  // a switch from sub→dub right after mount can never happen.
  const [audioPrefSettled, setAudioPrefSettled] = useState<boolean>(
    explicitAudio != null,
  );
  useEffect(() => {
    if (explicitAudio != null) return;
    const key = id != null ? `megaplay:audio:${id}` : null;
    if (!key) {
      setAudioPrefSettled(true);
      return;
    }
    let alive = true;
    AsyncStorage.getItem(key)
      .then((v) => {
        if (!alive) return;
        if (v === "sub" || v === "dub") {
          console.log(`[Anime][watch] audio pref → ${v} (last session)`);
          setAnimeAudio(v);
        }
        setAudioPrefSettled(true);
      })
      .catch(() => {
        if (alive) setAudioPrefSettled(true);
      });
    return () => {
      alive = false;
    };
  }, [id, explicitAudio]);
  const handleAnimeAudioChange = useCallback(
    (next: "sub" | "dub") => {
      console.log(`[Anime][watch] audio → ${next} (propagating to pipeline)`);
      setAnimeAudio(next);
      if (id != null)
        AsyncStorage.setItem(`megaplay:audio:${id}`, next).catch(() => {});
    },
    [id],
  );

  // P4 — watch-page funnel: one watch_opened per mount (direct vs embed is
  // the first split of "did the user reach playback").
  useEffect(() => {
    const providerDef0 = getProvider(provider ?? "");
    const direct =
      (providerDef0 ? isDirectProvider(providerDef0) : false) ||
      isDirectVideoUrl(videoUrl || "") ||
      !!fileUri;
    trackWatchOpened({ surface: direct ? "direct" : "embed" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const [headProviderOverride, setHeadProviderOverride] = useState<
    string | null
  >(null);
  const userPickedProviderRef = useRef(false);
  const activeDirectProvider =
    pickedProvider ??
    headProviderOverride ??
    (providerReady ? provider : (routeProvider ?? null));

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

  // ── Anime (JustAnime) direct pipeline ──
  // Independent of the movie/TV pipeline above: anime caches and ranks in a
  // separate module, keyed by the MAL-relative (cour-corrected) target for the
  // current TMDB (season, episode). Anime movies have no episodes — resolveMovie
  // → MAL episode 1. The episode-override state follows in-player episode picker
  // changes (onDirectEpisodeChange) so the target re-resolves per episode.
  const [animeEpOverride, setAnimeEpOverride] = useState<{
    season?: number;
    episode?: number;
  }>({});
  const curAnimeSeason = animeEpOverride.season ?? season;
  const curAnimeEpisode = animeEpOverride.episode ?? episode;
  const animeResolved = React.useMemo(() => {
    if (!isAnime || id == null) return undefined;
    if (type === "tv") {
      if (curAnimeSeason == null || curAnimeEpisode == null) {
        // Anime opened without an episode (anime-form feed link, CW re-open):
        // default to the lowest-MAL candidate at episode 1 — the same target the
        // embed pipeline resolves (/stream/mal/{id}/1/sub) — so the JustAnime
        // direct surface still engages instead of falling to the embed.
        if (animeMalId != null) {
          return {
            malId: animeMalId,
            anilistId: animeAnilistId ?? null,
            episode: 1,
          };
        }
        const ids = resolveShowIds(id);
        if (ids)
          return { malId: ids.malId, anilistId: ids.anilistId, episode: 1 };
        return undefined;
      }
      const r = resolveShow(id, curAnimeSeason, curAnimeEpisode);
      if (r.ok) {
        return { malId: r.malId, anilistId: r.anilistId, episode: r.episode };
      }
      // The TMDB twin map can hard-miss popular multi-split shows (no single
      // season-aligned candidate). Feed / CW always carry the MAL id + AniList
      // id explicitly for exactly this — fall back to those. The MAL-rel
      // episode is then the raw TMDB episode (no cour offset to apply).
      console.log(
        `[Anime][watch] resolveShow ${id} S${curAnimeSeason}E${curAnimeEpisode} MISS (${r.reason}/${r.candidates}); falling back to mid=${animeMalId ?? "none"}`,
      );
      return animeMalId != null
        ? {
            malId: animeMalId,
            anilistId: animeAnilistId ?? null,
            episode: curAnimeEpisode,
          }
        : undefined;
    }
    const m = resolveMovie(id);
    if (m) return { malId: m.malId, anilistId: m.anilistId, episode: 1 };
    return animeMalId != null
      ? { malId: animeMalId, anilistId: animeAnilistId ?? null, episode: 1 }
      : undefined;
  }, [
    isAnime,
    type,
    id,
    curAnimeSeason,
    curAnimeEpisode,
    animeMalId,
    animeAnilistId,
  ]);
  const animeActive =
    isAnime &&
    activeDirectProvider === ANIME_PROVIDER_ID &&
    providerReady &&
    animeResolved != null &&
    languageAnswered;
  const animeDirect = useAnimeDirectPipeline({
    enabled: animeActive && audioPrefSettled,
    malId: animeResolved?.malId,
    episode: animeResolved?.episode,
    audio: animeAudio,
    providerId: ANIME_PROVIDER_ID,
  });
  // When JustAnime settles empty (no direct links, no error), drop the user
  // onto the dedicated anime embed (MegaPlay) so playback keeps working with
  // zero interaction. A MANUAL pick of JustAnime after this stays on the unified
  // direct surface instead (Retry + auto-fallback to the next server).
  const animeSettledEmpty =
    animeActive &&
    animeDirect.attempted &&
    !animeDirect.loading &&
    animeDirect.links.length === 0 &&
    !userPickedProviderRef.current;
  // JustAnime ships per-episode intro/outro timestamps in its API — convert
  // the head link's upstream segments into the native skip-button shape so we
  // never consult introdb for anime (see VideoWebView gate).
  const animeIntroSegments = React.useMemo(
    () =>
      isAnime && animeDirect.links.length > 0
        ? introDbFromUpstream(
            animeDirect.links[0]._meta,
            curAnimeSeason ?? 1,
            curAnimeEpisode ?? 1,
          )
        : null,
    [isAnime, animeDirect.links, curAnimeSeason, curAnimeEpisode],
  );
  useEffect(() => {
    console.log(
      `[Anime][watch] ${type}/${id} cur=S${curAnimeSeason ?? "?"}E${curAnimeEpisode ?? "?"} isAnime=${isAnime} → ${animeResolved ? `malId=${animeResolved.malId} e${animeResolved.episode}` : "MISS"} provider=${activeDirectProvider ?? "none"} active=${animeActive ? "YES" : "no"} settledEmpty=${animeSettledEmpty ? "YES" : "no"}`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeResolved, animeActive, animeSettledEmpty, activeDirectProvider]);

  const direct = useDirectStreamPipeline({
    id,
    type,
    isDirectPlayback:
      isDirectPlayback && !!activeDirectProvider && providerReady,
    provider: isAnime ? undefined : (activeDirectProvider ?? undefined),
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
  // details page restore it on the next visit. Anime served via JustAnime uses
  // its own pipeline, so include its link count here.
  useEffect(() => {
    if (!isDirectPlayback || !id || !activeDirectProvider) return;
    const served = isAnime ? animeDirect.links.length : direct.links.length;
    if (served === 0) return;
    saveLastProvider(type, id, activeDirectProvider).catch(() => {});
  }, [
    isDirectPlayback,
    isAnime,
    id,
    type,
    activeDirectProvider,
    direct.links.length,
    animeDirect.links.length,
  ]);

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
  } else if (animeSettledEmpty) {
    // JustAnime found no streams — drop to the dedicated anime embed (MegaPlay)
    // so the user still gets a working player without touching the picker.
    console.log(
      `[Anime][watch] settledEmpty → megaplay embed fallback (malId=${animeResolved?.malId ?? "?"} e${animeResolved?.episode ?? "?"})`,
    );
    content = (
      <VideoWebView
        type={type}
        id={id}
        season={season}
        episode={episode}
        initialProvider="megaplay"
        backdropUrl={backdropUrl}
        isAnime={isAnime}
        animeMalId={animeResolved ? animeResolved.malId : animeMalId}
        animeAnilistId={
          animeResolved ? animeResolved.anilistId : (animeAnilistId ?? null)
        }
        animeAudio={animeAudio}
        onAnimeAudioChange={handleAnimeAudioChange}
        onClose={() => nav.goBack({ fallback: "/(tabs)" })}
        onDirectSelected={handleDirectSelected}
      />
    );
  } else if (
    isDirectPlayback &&
    activeDirectProvider &&
    activeDirectProvider !== "falix"
  ) {
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
          animeMalId={animeResolved ? animeResolved.malId : animeMalId}
          animeAnilistId={
            animeResolved ? animeResolved.anilistId : (animeAnilistId ?? null)
          }
          animeAudio={animeAudio}
          onAnimeAudioChange={handleAnimeAudioChange}
          title={title}
          startAt={startAt}
          onClose={() => nav.goBack({ fallback: "/(tabs)" })}
          directStream={{
            links: isAnime ? animeDirect.links : direct.links,
            bestIndex: isAnime ? animeDirect.bestIndex : direct.bestIndex,
            prevalidated: isAnime
              ? animeDirect.prevalidated
              : direct.prevalidated,
            selectionReason: isAnime
              ? animeDirect.selectionReason
              : direct.selectionReason,
            lastWorkingIndex: isAnime
              ? animeDirect.lastWorkingIndex
              : direct.lastWorkingIndex,
            loading: isAnime ? animeDirect.loading : direct.loading,
            error: isAnime ? animeDirect.error : direct.error,
            stageMessage: isAnime
              ? animeDirect.stageMessage
              : direct.stageMessage,
          }}
          onDirectSelected={handleDirectSelected}
          onDirectRetry={isAnime ? animeDirect.refetch : direct.refetch}
          nativeIntroSegments={animeIntroSegments}
          onDirectEpisodeChange={(s, e) => {
            // Anime episodes are MAL-resolved per TMDB (s, e) — just record the
            // new position; the target re-resolves and the anime pipeline refetches.
            if (isAnime) {
              setAnimeEpOverride({ season: s, episode: e });
              return;
            }
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
        onAnimeAudioChange={handleAnimeAudioChange}
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
