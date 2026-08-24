/**
 * WatchClient — composed video player with cinematic UX.
 *
 * Layout: server top, video center, episodes bottom — compact.
 * Features: keyboard shortcuts, error/loading states.
 *
 * Desktop (Electron): renders provider content in a <webview> with
 * full R0-R8 session-level network filtering (session.webRequest)
 * and security headers — replacing the old separate video window.
 *
 * Web: renders provider in a <SecureIframe> with JS-level guards
 * (navigation guard, popup guard, CPU watchdog).
 */

"use client";

import React, {
  useTransition,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import {
  AlertCircle,
  X,
  Film,
  ArrowLeft,
  Clapperboard,
  RefreshCw,
} from "lucide-react";
import { getSeasonAction } from "@/lib/actions";
import {
  filterAnimeProviders,
  getEnabledProviders,
  getResumeMode,
} from "@filmsnaps/shared";
import {
  resolveAnimeMovie,
  resolveAnimeShow,
  type ShowResolutionResult,
} from "@/lib/anime/client";
import { getImageUrl } from "@/lib/tmdb";
import { PlayerProvider, usePlayer } from "@/components/player/PlayerProvider";
import { SecureIframe } from "@/components/player/SecureIframe";
import { DesktopSecureWebview } from "@/components/player/DesktopSecureWebview";
import { FalixPlayer } from "@/components/player/FalixPlayer";
import { ServerPickerSheet } from "@/components/player/ServerPickerSheet";
import { EpisodeRail } from "@/components/player/EpisodeRail";
import { PlayerControlOverlay } from "@/components/player/PlayerControlOverlay";
import { buildIframeCSP } from "@/lib/movieProviders/cspBuilder";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useWatchKeyboardShortcuts } from "@/hooks/useWatchKeyboardShortcuts";
import { usePlaybackRecorder } from "@/hooks/usePlaybackRecorder";
import { DesktopWatchLayout } from "@/components/watch/DesktopWatchLayout";
import { WebLegalGate } from "@/components/legal/WebLegalGate";
import type { ProviderDefinition } from "@filmsnaps/shared";

// ── Types ─────────────────────────────────────────────────────────

interface WatchClientContentProps {
  contentid: string;
  plat: "movie" | "tv";
  initialMeta: any;
  initialSeasonData: any;
  defaultProvider?: string;
  minimal?: boolean;
  /** Resume position in seconds (from ?t=) applied once playback starts. */
  initialResumeT?: number;
  /**
   * Anime identity from the URL (?mid=&aid= — set by anime-search
   * click-through). Presence marks the session MAL-origin anime-profiled and
   * gives MegaPlay its primary/fallback keys before any map resolution.
   */
  initialMalId?: number;
  initialAnilistId?: number;
}

// ── Embed URL builder — direct or proxied ────────────────────────

/**
 * Providers that should be routed through our server-side proxy
 * for ad-blocking, tracker-filtering, and protection script injection.
 * Their HTML is fetched server-side, rewritten to block ads/trackers,
 * and injected with a runtime protection script.
 *
 * Proxied providers use TLS-fingerprinting HTTP (tlsFetch) to bypass
 * Cloudflare JS challenges at the network layer. Set FLARESOLVERR_URL
 * env var (Docker) for an additional headless-browser fallback.
 */
// No providers currently use the server-side proxy.
// Proxy code (protection.ts, tlsFetch, FlareSolverr) is preserved for future use.
const PROXIED_PROVIDERS = new Set<string>([]);

/**
 * Providers that serve direct video file URLs (not iframe embeds).
 * These are rendered with a custom video.js player (FalixPlayer)
 * instead of SecureIframe/DesktopSecureWebview.
 */
const DIRECT_VIDEO_PROVIDERS = new Set<string>(["falix"]);

/** Resolved MegaPlay identity for this (title, season, episode). */
interface MegaContext {
  malId: number | null;
  aniId: number | null;
  /** Episode number in MegaPlay's ID space (offset-adjusted when mapped). */
  episode: number;
}

function buildEmbedUrl(
  provider: ProviderDefinition,
  contentid: string,
  plat: "movie" | "tv",
  selectedSeason: number,
  activeEpisode: number,
  resumeT?: number,
  mega?: { idSpace: "mal" | "ani"; id: number; episode: number } | null,
): string {
  // Providers that natively honor a resume param are strictly better than a
  // post-load JS seek — thread the saved position into the embed URL when the
  // provider exposes that capability (expert verdict §3 / action item 3).
  const startAt =
    resumeT && resumeT > 0 && getResumeMode(provider) === "url"
      ? Math.floor(resumeT)
      : undefined;

  // Anime-only providers NEVER take the TMDB contentid — without a resolved
  // identity there is no URL at all (caller shows the loading/exhausted state).
  if (provider.animeOnly) {
    if (!mega) return "";
    return `${provider.baseUrl}${
      plat === "tv"
        ? provider.embed.tv(
            String(mega.id),
            selectedSeason,
            mega.episode,
            startAt,
            {
              idSpace: mega.idSpace,
              audio: "sub",
            },
          )
        : provider.embed.movie(String(mega.id), startAt, {
            idSpace: mega.idSpace,
            audio: "sub",
          })
    }`;
  }

  const embedPath =
    plat === "tv"
      ? provider.embed.tv(contentid, selectedSeason, activeEpisode, startAt)
      : provider.embed.movie(contentid, startAt);

  // Route through server-side proxy to strip ads/trackers and
  // inject the runtime protection script.
  if (PROXIED_PROVIDERS.has(provider.id)) {
    const [pathPart, queryPart] = embedPath.split("?");
    const proxyPath = `/api/player/${provider.id}${pathPart}`;
    return queryPart ? `${proxyPath}?${queryPart}` : proxyPath;
  }

  return `${provider.baseUrl}${embedPath}`;
}

function absUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${window.location.origin}${path}`;
}

// ── Keyboard shortcuts hook ─────────────────────────────────────

function useKeyboardShortcuts() {
  const { toggleFullscreen, goToNextEpisode, goToPrevEpisode } = usePlayer();

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable
      )
        return;

      switch (e.key.toLowerCase()) {
        case "f":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "n":
          e.preventDefault();
          goToNextEpisode();
          break;
        case "p":
          e.preventDefault();
          goToPrevEpisode();
          break;
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [toggleFullscreen, goToNextEpisode, goToPrevEpisode]);
}

// ── Desktop session management hook ──────────────────────────────

/**
 * Manages the Electron provider session lifecycle.
 * On mount and provider change, initialises the isolated session
 * partition with full R0-R8 filtering via the main process IPC.
 *
 * Returns `sessionReady` (the webview may mount) AND `appliedEmbedUrl` — the
 * URL the webview should actually show.
 *
 * On the FIRST provider the webview stays gated (hidden) until the main
 * process has configured that provider's rules, closing the startup race.
 *
 * On a provider SWITCH we keep `sessionReady` HIGH and hold `appliedEmbedUrl`
 * at the CURRENT provider until the NEW provider's session has been installed.
 * This is deliberate: dropping `sessionReady` to false would UNMOUNT the
 * singleton <webview> (React gate), tearing down the old guest mid-navigation
 * and emitting `ERR_FAILED (-2)` (the teardown race that broke server
 * switching). And navigating to the new provider before its per-provider
 * rules are installed would feed R3.5 the OLD provider's profile and block the
 * new provider's own scripts. Holding the URL until init resolves avoids both.
 */
function useHeldProviderSession(
  providerId: string,
  embedUrl: string,
): { sessionReady: boolean; appliedEmbedUrl: string } {
  const isDesktop =
    typeof window !== "undefined" && window.electronAPI?.isDesktop === true;
  const initRef = useRef<string | null>(null);
  const latestRequestRef = useRef<string>("");
  const [appliedEmbedUrl, setAppliedEmbedUrl] = useState(embedUrl);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    // Mark the newest requested provider synchronously so a stale async init
    // (user switched A→B→A before B's IPC resolved) can detect it's outdated.
    latestRequestRef.current = providerId;

    if (!isDesktop) {
      // Web path — no session to gate on.
      setSessionReady(true);
      setAppliedEmbedUrl(embedUrl);
      return;
    }
    if (!window.electronAPI) return;
    // Anime chain pre-resolution: no URL yet (identity still resolving or
    // exhausted) — hold the session instead of initializing with "".
    if (!embedUrl) return;

    // Same provider as the currently-initialised one (episode/season/refresh
    // change): rules already installed — apply the new URL immediately.
    if (initRef.current === providerId) {
      setAppliedEmbedUrl(embedUrl);
      setSessionReady(true);
      return;
    }

    // First mount OR provider switch. Keep the webview mounted (sessionReady
    // stays as-is); only swap the applied URL once the new provider's session
    // is installed in main.
    window.electronAPI
      .initProviderSession({ providerId, embedUrl })
      .then(() => {
        // Ignore the resolution if the user already asked for another provider.
        if (latestRequestRef.current !== providerId) return;
        initRef.current = providerId;
        setAppliedEmbedUrl(embedUrl);
        setSessionReady(true);
      })
      .catch((err) => {
        console.warn("[DesktopSession] Failed to init provider session:", err);
        if (latestRequestRef.current !== providerId) return;
        initRef.current = providerId;
        setAppliedEmbedUrl(embedUrl);
        setSessionReady(true); // fail-open for non-security errors
      });
  }, [isDesktop, providerId, embedUrl]);

  return { sessionReady, appliedEmbedUrl };
}

// ── Content (inner) — lives inside PlayerProvider ─────────────────

function WatchClientContent({
  contentid,
  plat,
  initialMeta,
  initialSeasonData,
  minimal = false,
  initialResumeT,
  initialMalId,
  initialAnilistId,
}: WatchClientContentProps) {
  // ── Mount log for diagnostics + perf baseline mark ──
  useEffect(() => {
    console.log("[WatchClient] Mounted", {
      contentid,
      plat,
      isElectron: !!(
        typeof window !== "undefined" && window.electronAPI?.isDesktop
      ),
    });
    performance.mark("watch:client-mount");
  }, [contentid, plat]);

  const [isPending, startTransition] = useTransition();
  const [seasonData, setSeasonData] = useState(initialSeasonData);
  const [playerReady, setPlayerReady] = useState(false);

  // Hydration gate — resolves synchronously on the first client render (no
  // effect tick). Server snapshot `false` so SSR never emits the webview;
  // client snapshot `true` so the webview mounts in the very first paint,
  // avoiding both the double-webview mismatch and the empty-skeleton flash.
  const hydrated = useSyncExternalStore(
    () => () => {}, // no external store to subscribe to
    () => true, // client snapshot
    () => false, // server snapshot
  );

  const {
    selectedProviderId,
    setSelectedProvider,
    selectedSeason,
    activeEpisode,
    setActiveEpisode,
    setSelectedSeason,
    refreshKey,
    refreshIframe,
    cpuWarning,
    iframeLoadError,
    setIframeLoadError,
    mediaType,
  } = usePlayer();

  // ── Desktop Electron integration ──
  const isElectronEnv =
    typeof window !== "undefined" && window.electronAPI?.isDesktop === true;

  // ── Desktop viewport check (≥1280px layout) ──
  const isDesktopVp = useIsDesktop();

  // ── Anime session detection ──
  // Two origins (consultation §3.1):
  //   MAL-origin  — URL carried mid/aid from anime-search click-through.
  //   TMDB-origin — heuristic on the meta payload: Animation genre (16) AND
  //                 original_language ja. Cheap, synchronous, fails safe in
  //                 both directions (verdict Q4).
  const paramAnime = initialMalId != null || initialAnilistId != null;
  const heuristicAnime = Boolean(
    initialMeta?.genres?.some?.((g: any) => g.id === 16) &&
    initialMeta?.original_language === "ja",
  );
  const isAnimeSession = paramAnime || heuristicAnime;

  // ── Platform-gated provider list ──
  // Web (browser, any viewport): only providers that declare the web platform
  // (or leave platforms unspecified — the registry default is "everywhere").
  // Desktop Electron: all enabled providers — the desktop webview session
  // (R0-R8) governs which actually play, so the picker shows the full set.
  // Anime-profiled sessions narrow to the anime-capable allowlist
  // [nxsha, screenscape, megaplay] (verdict §3.3); regular sessions exclude
  // `animeOnly` providers whose builders need MAL/AniList ids.
  const providers = useMemo(() => {
    const base = isElectronEnv
      ? getEnabledProviders()
      : getEnabledProviders().filter(
          (p) => !p.platforms || p.platforms.includes("web"),
        );
    return isAnimeSession
      ? filterAnimeProviders(base)
      : base.filter((p) => p.animeOnly !== true);
  }, [isElectronEnv, isAnimeSession]);

  // Resolve current provider
  const currentProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId) ?? providers[0],
    [providers, selectedProviderId],
  );

  // ── MegaPlay identity + fallback chain (consultation §3.2 / verdict Q7) ──
  // Resolved once per (title, season, episode); cached for revisits within
  // the session. Map result WINS over URL ids (cour math is more correct);
  // URL mid/aid are the explicit-human-choice fallback when the mapper misses.
  const [megaCtx, setMegaCtx] = useState<MegaContext | null>(null);
  /** Mapper miss reason — set only when NO identity could be produced. */
  const [megaMissReason, setMegaMissReason] = useState<string | null>(null);
  /** Fallback-chain position inside MegaPlay: MAL first, AniList second. */
  const [chainSpace, setChainSpace] = useState<"mal" | "ani">("mal");
  /** Terminal state: every ID space tried and failed (verdict Q10). */
  const [chainExhausted, setChainExhausted] = useState(false);
  const megaCacheRef = useRef<Map<string, MegaContext | { miss: string }>>(
    new Map(),
  );

  useEffect(() => {
    if (!isAnimeSession) {
      setMegaCtx(null);
      setMegaMissReason(null);
      return;
    }
    let cancelled = false;
    const key = `${contentid}|${plat}|${selectedSeason}|${activeEpisode}`;

    const apply = (r: MegaContext | { miss: string }) => {
      if (cancelled) return;
      setChainSpace("mal");
      setChainExhausted(false);
      if ("miss" in r) {
        setMegaCtx(null);
        setMegaMissReason(r.miss);
      } else {
        setMegaCtx(r);
        setMegaMissReason(null);
      }
    };

    const cached = megaCacheRef.current.get(key);
    if (cached) {
      apply(cached);
      return;
    }

    // Explicit human choice beats refusing: when the user arrived from anime
    // search with ?mid=, respect their picked entry even if the season mapper
    // can't align this TMDB season (episode passes through raw).
    const urlFallback = (): MegaContext | { miss: string } =>
      initialMalId != null || initialAnilistId != null
        ? {
            malId: initialMalId ?? null,
            aniId: initialAnilistId ?? null,
            episode: activeEpisode,
          }
        : { miss: "no-candidates" };

    (async () => {
      try {
        let result: MegaContext | { miss: string };
        if (plat === "movie") {
          const r = await resolveAnimeMovie(contentid);
          result = r.ok
            ? {
                malId: r.malId,
                aniId: r.anilistId ?? initialAnilistId ?? null,
                episode: 1,
              }
            : urlFallback();
        } else {
          const r = await resolveAnimeShow(
            contentid,
            selectedSeason,
            activeEpisode,
          );
          result = r.ok
            ? {
                malId: r.malId,
                aniId: r.anilistId ?? initialAnilistId ?? null,
                episode: r.episode,
              }
            : urlFallback();
        }
        megaCacheRef.current.set(key, result);
        apply(result);
      } catch {
        apply(urlFallback());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isAnimeSession,
    contentid,
    plat,
    selectedSeason,
    activeEpisode,
    initialMalId,
    initialAnilistId,
  ]);

  const onMegaplay = currentProvider?.animeOnly === true;

  /** The identity the embed builder should use at the current chain step. */
  const megaBuild = useMemo<{
    idSpace: "mal" | "ani";
    id: number;
    episode: number;
  } | null>(() => {
    if (!megaCtx) return null;
    const useAni = chainSpace === "ani";
    const id = useAni ? megaCtx.aniId : megaCtx.malId;
    if (id == null) return null;
    return { idSpace: useAni ? "ani" : "mal", id, episode: megaCtx.episode };
  }, [megaCtx, chainSpace]);

  /**
   * Advance the fallback chain one step (verdict §9 Q5):
   * web = manual button only; desktop additionally auto-advances on the
   * deterministic "Error Code: 410" IPC. No soft-signal auto-advance anywhere.
   */
  const advanceSource = useCallback(() => {
    if (chainSpace === "mal" && megaCtx?.aniId != null) {
      setPlayerReady(false);
      setIframeLoadError(false);
      setChainSpace("ani");
    } else {
      setChainExhausted(true);
    }
  }, [chainSpace, megaCtx, setIframeLoadError]);

  // Desktop-only deterministic detection: main scans the settled guest frame
  // for MegaPlay's "Error Code: 410" and emits player:source-missing → we
  // auto-advance. Scoped subscription: only while actually ON megaplay.
  useEffect(() => {
    if (!isElectronEnv || !onMegaplay) return;
    const unsubscribe = window.electronAPI?.onPlayerSourceMissing?.(() =>
      advanceSource(),
    );
    return () => unsubscribe?.();
  }, [isElectronEnv, onMegaplay, advanceSource]);

  /** Debug line for the exhausted overlay (Q10 telemetry). */
  const animeTriedList = useMemo(() => {
    const out: string[] = [];
    if (megaCtx?.malId != null) out.push(`MAL #${megaCtx.malId}`);
    else if (initialMalId != null) out.push(`MAL #${initialMalId}`);
    if (megaCtx?.aniId != null) out.push(`AniList #${megaCtx.aniId}`);
    else if (initialAnilistId != null) out.push(`AniList #${initialAnilistId}`);
    return out;
  }, [megaCtx, initialMalId, initialAnilistId]);

  const showAnimeExhausted =
    onMegaplay && (chainExhausted || (!megaBuild && megaMissReason != null));

  const megaplayAvailable = providers.some((p) => p.id === "megaplay");

  /** TMDB-origin affordance: jump into MegaPlay with resolved identities. */
  const handleTryAnimeServers = useCallback(() => {
    setSelectedProvider("megaplay");
  }, [setSelectedProvider]);

  // ── Watch-history writes ──
  // The provider embed's playback position (relayed from the desktop session
  // preload over player:progress) is persisted every ~10s + on leave, so
  // Continue Watching / resume points work. No-op on web (cross-origin embeds
  // are opaque) and while no samples arrive.
  usePlaybackRecorder({
    tmdbId: contentid,
    mediaType: plat,
    season: selectedSeason,
    episode: activeEpisode,
    providerId: currentProvider?.id,
    resumeAt: initialResumeT,
  });

  // ── Embed URL ──
  const embedUrl = currentProvider
    ? buildEmbedUrl(
        currentProvider,
        contentid,
        plat,
        selectedSeason,
        activeEpisode,
        initialResumeT,
        currentProvider.animeOnly ? megaBuild : null,
      )
    : "";

  // ── Desktop: initialise provider session with R0-R8 filtering ──
  // sessionReady gates the webview's first mount; appliedEmbedUrl is the URL
  // the webview may actually navigate to. On a provider switch the URL is held
  // at the current provider until the new provider's rules are installed in
  // main, so the singleton webview never unmounts (no teardown ERR_FAILED -2)
  // and never navigates before its per-provider rules exist.
  const { sessionReady, appliedEmbedUrl } = useHeldProviderSession(
    currentProvider?.id ?? "",
    embedUrl,
  );

  // Reset loading state when URL changes
  useEffect(() => {
    setPlayerReady(false);
    setIframeLoadError(false);
    if (embedUrl) {
      performance.mark("watch:webview-src-set");
    }
  }, [embedUrl, setIframeLoadError]);

  // ── Desktop: provider home-page escape escalation ──
  // The provider's error UI can navigate the embed to a provider home/list
  // path ("Go Home"). Desktop main auto-reloads the embed once, then escalates
  // over IPC: show the existing error/source-unavailable UI (never the home
  // page). The iframeLoadError → PlayerErrorState chain already exists.
  useEffect(() => {
    if (!isElectronEnv) return;
    const unsubscribe = window.electronAPI?.onEscapeBlocked?.(() =>
      setIframeLoadError(true),
    );
    return () => unsubscribe?.();
  }, [isElectronEnv, setIframeLoadError]);

  // ── Callbacks ──
  const handleIframeLoad = useCallback(() => {
    setPlayerReady(true);
    setIframeLoadError(false);

    // Perf baseline: watch-page mount → webview did-finish-load
    performance.mark("watch:webview-loaded");
    performance.measure(
      "watch:mount-to-src",
      "watch:client-mount",
      "watch:webview-src-set",
    );
    performance.measure(
      "watch:src-to-loaded",
      "watch:webview-src-set",
      "watch:webview-loaded",
    );
    performance.measure(
      "watch:total",
      "watch:client-mount",
      "watch:webview-loaded",
    );
    try {
      const entries = performance.getEntriesByName("watch:total");
      if (entries.length > 0) {
        console.log(
          `[WatchClient] mount→src: ${Math.round(
            performance.getEntriesByName("watch:mount-to-src")[0]?.duration ??
              0,
          )}ms · src→loaded: ${Math.round(
            performance.getEntriesByName("watch:src-to-loaded")[0]?.duration ??
              0,
          )}ms · total: ${Math.round(entries[entries.length - 1].duration)}ms`,
        );
      }
    } catch {
      // Measurement is best-effort — never throw on perf logging
    }
  }, [setIframeLoadError]);

  const handleIframeError = useCallback(() => {
    setIframeLoadError(true);
  }, [setIframeLoadError]);

  const handleRetry = useCallback(() => {
    setPlayerReady(false);
    setIframeLoadError(false);
    refreshIframe();
  }, [setIframeLoadError, refreshIframe]);

  /** Retry from the exhausted-anime overlay: restart the chain at MAL. */
  const handleAnimeRetry = useCallback(() => {
    setPlayerReady(false);
    setIframeLoadError(false);
    setChainSpace("mal");
    setChainExhausted(false);
  }, [setIframeLoadError]);

  const handleSeasonChange = useCallback(
    (seasonNum: number) => {
      setSelectedSeason(seasonNum);
      setActiveEpisode(1);
      startTransition(async () => {
        const data = await getSeasonAction(contentid, seasonNum);
        setSeasonData(data);
      });
    },
    [contentid, setSelectedSeason, setActiveEpisode],
  );

  const handleProviderSelect = useCallback(
    (provider: ProviderDefinition | null) => {
      // null = Auto mode (reset to initial auto-detection)
      setSelectedProvider(provider?.id ?? (null as unknown as string));
    },
    [setSelectedProvider],
  );

  const displayTitle = initialMeta?.name || initialMeta?.title || "";
  const year = (
    initialMeta?.release_date ||
    initialMeta?.first_air_date ||
    ""
  ).slice(0, 4);

  // ── Determine the webview/iframe key so it remounts on refresh ──
  const playerKey = isElectronEnv
    ? `dp-${selectedProviderId}-${selectedSeason}-${activeEpisode}-${refreshKey}`
    : `wp-${selectedProviderId}-${selectedSeason}-${activeEpisode}-${refreshKey}`;

  // ── Desktop: two-zone immersive layout ──
  // Gate on hydrated to prevent SSR/hydration mismatch — without this guard
  // the server renders mobile layout (no window → false), client hydrates and
  // sees desktop layout (≥1280px), React discards the server tree, and a
  // fresh remount creates duplicate webview sessions causing "double connect".
  if (!hydrated) {
    // Skeleton placeholder — no player, no session, no provider init.
    // Matches what SSR produces so hydration behaves itself.
    return <div className="min-h-screen bg-[#0a0a0f]" />;
  }

  if (isDesktopVp) {
    return (
      <DesktopWatchLayout
        contentid={contentid}
        plat={plat}
        initialMeta={initialMeta}
        seasonData={seasonData}
        providers={providers}
        currentProvider={currentProvider}
        selectedProviderId={selectedProviderId}
        embedUrl={appliedEmbedUrl}
        playerKey={playerKey}
        sessionReady={sessionReady}
        isElectron={isElectronEnv}
        isPending={isPending}
        selectedSeason={selectedSeason}
        activeEpisode={activeEpisode}
        onProviderSelect={handleProviderSelect}
        onSeasonChange={handleSeasonChange}
        onRetry={showAnimeExhausted ? handleAnimeRetry : handleRetry}
        onIframeLoad={handleIframeLoad}
        onIframeError={handleIframeError}
        animeChain={{
          exhausted: showAnimeExhausted,
          tried: animeTriedList,
          canAdvance: megaCtx?.aniId != null && chainSpace === "mal",
          onAdvance: advanceSource,
          missReason: megaMissReason,
        }}
      />
    );
  }

  // ── Render (Mobile/Tablet: <1280px existing layout) ──
  return (
    <div className="min-h-screen bg-[#070708] text-muted-foreground">
      {/* Film grain */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] bg-[url('/noise.svg')] mix-blend-overlay -z-10" />

      <div className="mx-auto w-full max-w-[1200px] px-3 sm:px-4 lg:px-6">
        {/* ── Title + Server area ── */}
        {!minimal && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3 pb-2">
            <div className="min-w-0">
              <h1
                className="text-lg sm:text-xl font-bold text-foreground truncate"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {displayTitle}
              </h1>
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500">
                <span className="text-[#D4A237]">
                  {plat === "tv" ? "Series" : "Film"}
                </span>
                <span className="w-1 h-1 rounded-full bg-zinc-700" />
                <span>{year}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <ServerPickerSheet
                onSelect={handleProviderSelect}
                selectedId={selectedProviderId}
                providers={providers}
              />
            </div>
          </div>
        )}

        {/* ── Video Player ── */}
        <div className="relative w-full aspect-video rounded-xl sm:rounded-2xl overflow-hidden bg-[#0E0E11] shadow-[0_8px_60px_rgba(0,0,0,0.8)] ring-1 ring-white/[0.08] group/player">
          {/* Ambient glow */}
          <div className="absolute -inset-4 bg-gradient-radial from-[#D4A237]/5 via-transparent to-transparent opacity-60 pointer-events-none z-0" />

          {/* CPU Warning */}
          {cpuWarning && currentProvider && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#070708]/80 backdrop-blur-sm">
              <div className="flex items-center gap-3 text-sm text-[#E05252] bg-red-500/10 px-5 py-4 rounded-xl border border-red-500/20 max-w-md mx-4">
                <AlertCircle
                  size={16}
                  className="text-[#E05252] flex-shrink-0"
                />
                <div className="flex-1 text-xs sm:text-sm">
                  This server is using too much CPU — it has been stopped.
                  <span className="block mt-1 text-muted-foreground">
                    Switch to a different server above to continue watching.
                  </span>
                </div>
                <button
                  onClick={() => {}}
                  className="text-faint hover:text-foreground transition-colors p-1 flex-shrink-0"
                  aria-label="Dismiss"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Error State */}
          {(iframeLoadError || showAnimeExhausted) && !cpuWarning && (
            <PlayerErrorState
              onRetry={showAnimeExhausted ? handleAnimeRetry : handleRetry}
              variant={showAnimeExhausted ? "anime-exhausted" : "standard"}
              tried={showAnimeExhausted ? animeTriedList : undefined}
            />
          )}

          {/* Direct-video player (Falix) */}
          {!cpuWarning &&
            currentProvider &&
            DIRECT_VIDEO_PROVIDERS.has(currentProvider.id) && (
              <FalixPlayer
                tmdbId={contentid}
                mediaType={plat}
                selectedSeason={selectedSeason}
                activeEpisode={activeEpisode}
                onLoad={handleIframeLoad}
              />
            )}

          {/* ── Desktop: native WebContentsView (Phase 3 hybrid). Kept MOUNTED
               for the whole session — even across error/CPU-warning states —
               because the singleton view must never be torn down by a React
               gate. Its own visibility (player:set-visible) reconciles with the
               overlays above, so this error/CPU-warning overlay wins the z-order
               over the rect when it must. Gates here are mount-vs-not: session
               ready + a real URL + a non-direct provider decide existence. */}
          {isElectronEnv &&
            sessionReady &&
            appliedEmbedUrl &&
            currentProvider &&
            !DIRECT_VIDEO_PROVIDERS.has(currentProvider.id) && (
              <div className="absolute inset-0 z-10">
                {/* key on refreshKey ONLY (NOT the provider/episode/season):
                    safe here (main owns the WebContents — a remount resets the
                    controller, never tearing the singleton down), but must not
                    fire on provider/episode/season switches — those navigate in
                    place via the src effect. Retry bumps refreshKey → remount
                    → re-open (true reload, clean local state). */}
                <DesktopSecureWebview
                  key={`${refreshKey}-electron`}
                  src={appliedEmbedUrl}
                  onLoad={handleIframeLoad}
                  onError={handleIframeError}
                />
              </div>
            )}

          {/* ── Web: SecureIframe with JS-level guards ── */}
          {!isElectronEnv &&
            !cpuWarning &&
            !iframeLoadError &&
            embedUrl &&
            currentProvider &&
            !DIRECT_VIDEO_PROVIDERS.has(currentProvider.id) && (
              <SecureIframe
                key={playerKey}
                src={embedUrl}
                sandbox={currentProvider?.sandbox}
                csp={
                  currentProvider && !PROXIED_PROVIDERS.has(currentProvider.id)
                    ? buildIframeCSP(currentProvider)
                    : undefined
                }
                onLoad={handleIframeLoad}
                onError={handleIframeError}
              />
            )}

          {/* Cover overlays — visual band-aid, never block clicks */}
          {currentProvider?.coverOverlays?.map((o, i) => (
            <div
              key={`cover-${i}`}
              className="absolute z-20 pointer-events-none"
              style={{
                top: o.top,
                left: o.left,
                width: o.width,
                height: o.height,
                borderRadius: "20px",
                background: "rgba(14, 14, 17, 0.9)",
              }}
            />
          ))}

          {/* Loading / controls overlay — skip for direct-video providers (FalixPlayer manages its own UI) */}
          <PlayerControlOverlay
            isPending={
              (!playerReady || isPending) &&
              !DIRECT_VIDEO_PROVIDERS.has(currentProvider?.id)
            }
          />
        </div>

        {/* ── Anime chain affordances (consultation §3.2) ── */}
        {onMegaplay &&
          playerReady &&
          !showAnimeExhausted &&
          megaCtx?.aniId != null && (
            <div className="flex items-center justify-between gap-2.5 px-3 py-2.5 mt-2 rounded-xl bg-violet-500/[0.07] border border-violet-400/15">
              <p className="text-xs sm:text-sm text-zinc-400">
                Source not playing?
              </p>
              <button
                onClick={advanceSource}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full
                bg-violet-400/10 border border-violet-400/30 text-violet-300
                text-xs font-bold hover:bg-violet-400/20 transition-all active:scale-95 shrink-0"
              >
                Try next anime source
                <span className="font-mono text-[10px] text-violet-400/70">
                  {chainSpace === "mal" ? "MAL → AniList" : "AniList"}
                </span>
              </button>
            </div>
          )}

        {/* TMDB-origin anime affordance — enter MegaPlay with mapped ids */}
        {isAnimeSession &&
          !paramAnime &&
          megaplayAvailable &&
          !onMegaplay &&
          !showAnimeExhausted && (
            <div className="flex items-center justify-between gap-2.5 px-3 py-2.5 mt-2 rounded-xl bg-[#D4A237]/8 border border-[#D4A237]/15">
              <p className="text-xs sm:text-sm text-zinc-400">
                {megaCtx || !megaMissReason
                  ? "Found nothing here? This title has anime servers."
                  : "Could not auto-map this season to MyAnimeList. MegaPlay disabled for this episode."}
              </p>
              {megaCtx && (
                <button
                  onClick={handleTryAnimeServers}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full
                    bg-[#D4A237]/10 border border-[#D4A237]/30 text-[#D4A237]
                    text-xs font-bold hover:bg-[#D4A237]/20 transition-all active:scale-95 shrink-0"
                >
                  Try anime servers
                </button>
              )}
            </div>
          )}

        {/* ── Stuck-video hint (hidden when an anime affordance is showing) ── */}
        {!onMegaplay &&
          !(isAnimeSession && !paramAnime && megaplayAvailable) && (
            <div className="flex items-center gap-2.5 px-3 py-2.5 mt-2 rounded-xl bg-[#D4A237]/8 border border-[#D4A237]/15">
              <AlertCircle size={14} className="text-[#D4A237] shrink-0" />
              <p className="text-xs sm:text-sm text-zinc-400">
                Video stuck? Switch the source server at the top.
              </p>
            </div>
          )}

        {/* ── Episode Rail (TV only) ── */}
        {plat === "tv" && (
          <EpisodeRail
            seasonData={seasonData}
            seasons={initialMeta?.seasons}
            onSeasonChange={handleSeasonChange}
          />
        )}

        {/* ── Movie overview ── */}
        {plat === "movie" && !minimal && initialMeta?.overview && (
          <div className="mt-4 pb-4">
            <p className="text-xs sm:text-sm text-zinc-500 leading-relaxed line-clamp-3">
              {initialMeta.overview}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Error State Component ───────────────────────────────────────

function PlayerErrorState({
  onRetry,
  variant = "standard",
  tried,
}: {
  onRetry: () => void;
  /** Anime chain exhausted — terminal copy + debug list (verdict Q10). */
  variant?: "standard" | "anime-exhausted";
  tried?: string[];
}) {
  const animeExhausted = variant === "anime-exhausted";
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#070708] z-40 gap-4 px-6">
      <Clapperboard className="text-[#D4A237]" size={48} strokeWidth={1.5} />
      <p
        className="text-xl text-foreground font-bold text-center"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {animeExhausted ? "No anime sources found" : "Projection Reel Snapped"}
      </p>
      <p className="text-sm text-muted-foreground text-center max-w-xs">
        {animeExhausted ? (
          <>No playable source for this title on MegaPlay.</>
        ) : (
          <>
            We couldn&apos;t load this stream. The source server might be
            offline.
          </>
        )}
      </p>
      {tried && tried.length > 0 && (
        <p className="font-mono text-[11px] text-zinc-600 tracking-tight">
          Tried: {tried.join(", ")}
        </p>
      )}
      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#D4A237] text-[#070708] text-sm font-bold hover:bg-[#B88B2A] transition-colors active:scale-95"
      >
        <RefreshCw size={14} />
        {animeExhausted ? "Try Again" : "Reload Source"}
      </button>
    </div>
  );
}

// ── Wrapper — wraps content in PlayerProvider ────────────────────

interface WatchClientProps {
  contentid: string;
  plat: "movie" | "tv";
  initialMeta: any;
  initialSeasonData: any;
  defaultProvider?: string;
  minimal?: boolean;
  initialSeason?: number;
  initialEpisode?: number;
  /** Resume position in seconds (from ?t=) applied once playback starts. */
  initialResumeT?: number;
}

export default function WatchClient({
  contentid,
  plat,
  initialMeta,
  initialSeasonData,
  defaultProvider,
  minimal = false,
  initialSeason = 1,
  initialEpisode = 1,
  initialResumeT,
}: WatchClientProps) {
  return (
    <>
      {/* First-time Legal & DMCA acceptance (browser only — the desktop app
          gates at the root layout via DesktopLegalGate). Mounted OUTSIDE
          PlayerProvider so player state changes don't re-render it. */}
      <WebLegalGate />
      <PlayerProvider
        mediaType={plat}
        contentId={contentid}
        initialProviderId={defaultProvider}
        initialSeason={initialSeason}
        initialEpisode={initialEpisode}
        minimal={minimal}
        maxEpisodeCount={initialSeasonData?.episodes?.length ?? 99}
      >
        <WatchClientContent
          contentid={contentid}
          plat={plat}
          initialMeta={initialMeta}
          initialSeasonData={initialSeasonData}
          minimal={minimal}
          initialResumeT={initialResumeT}
        />
      </PlayerProvider>
    </>
  );
}
