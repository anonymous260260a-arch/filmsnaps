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
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { tmdbApi } from "@/lib/tmdb";
import {
  filterAnimeProviders,
  getEnabledProviders,
  getProvider,
  getResumeMode,
  isDirectProvider,
  resolveInitialProviderId,
} from "@filmsnaps/shared";
import { getImageUrl } from "@/lib/tmdb";
import { PlayerProvider, usePlayer } from "@/components/player/PlayerProvider";
import { isElectronNow } from "@/lib/platform";
import { ServerPickerSheet } from "@/components/player/ServerPickerSheet";
import { MobileEpisodeSheet } from "@/components/player/MobileEpisodeSheet";
import { EpisodeSidebar } from "@/components/player/EpisodeSidebar";
import { AudioToggle } from "@/components/player/AudioToggle";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { getSettings, setSettings } from "@/hooks/useSettings";
import type { PreferredLanguage } from "@/lib/streamSelector";
import { usePlaybackRecorder } from "@/hooks/usePlaybackRecorder";
import { DesktopWatchLayout } from "@/components/watch/DesktopWatchLayout";
import { WebLegalGate } from "@/components/legal/WebLegalGate";
import { MobilePlayerZone } from "@/components/watch/MobilePlayerZone";
import { useHeldProviderSession } from "@/hooks/useHeldProviderSession";
import { useMegaPlayChain } from "@/hooks/useMegaPlayChain";
import { buildEmbedUrl } from "@/lib/watch/embedUrl";
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
  /** Pre-computed embed URL from URL params — enables immediate player mount. */
  initialEmbedUrl?: string | null;
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
  initialEmbedUrl,
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

  // ── First-run language prompt (mobile parity) ──
  // The direct player doesn't mount until the user has answered once — the
  // answer feeds the very first source ranking. Module-level setSettings
  // (single combined write) + local state drives the swap.
  const [langAnswered, setLangAnswered] = useState(
    () => getSettings().hasAnsweredLanguagePrompt,
  );
  const handleLanguageSelect = useCallback((value: PreferredLanguage) => {
    setSettings({
      ...getSettings(),
      preferredAudioLanguage: value,
      hasAnsweredLanguagePrompt: true,
    });
    setLangAnswered(true);
  }, []);

  // Sync seasonData when the non-suspending query resolves
  useEffect(() => {
    if (initialSeasonData) setSeasonData(initialSeasonData);
  }, [initialSeasonData]);

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
    goToNextEpisode,
    goToPrevEpisode,
    audio,
    setAudio,
  } = usePlayer();

  // ── Desktop Electron integration ──
  const isElectronEnv =
    typeof window !== "undefined" && window.electronAPI?.isDesktop === true;

  // ── Desktop viewport check (≥1280px layout) ──
  const isDesktopVp = useIsDesktop();
  const router = useRouter();

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
  // Resolution, caching and the MAL→AniList fallback chain live in the
  // useMegaPlayChain hook; this component only wires it to the player state.
  const {
    megaCtx,
    megaMissReason,
    megaBuild,
    chainSpace,
    advanceSource,
    animeTriedList,
    showAnimeExhausted: animeChainExhausted,
    retryChain,
  } = useMegaPlayChain({
    isAnimeSession,
    contentid,
    plat,
    selectedSeason,
    activeEpisode,
    initialMalId,
    initialAnilistId,
    onAdvanceReset: useCallback(() => {
      setPlayerReady(false);
      setIframeLoadError(false);
    }, [setIframeLoadError]),
  });

  const onMegaplay = currentProvider?.animeOnly === true;

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

  const showAnimeExhausted = onMegaplay && animeChainExhausted;

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
    isAnime: isAnimeSession,
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
        audio,
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

  // Reset loading state when URL changes — but skip if the webview is already
  // loaded via initialEmbedUrl (TMDB-derived URL arriving after initial mount
  // should not flash a loading spinner over active playback).
  useEffect(() => {
    if (initialEmbedUrl && playerReady) return; // already playing — don't reset
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

    // Perf baseline: watch-page mount → webview did-finish-load.
    // Wrapped in try/catch: for direct-video providers there is no webview,
    // so the "webview-src-set" mark may not exist — performance.measure
    // throws a DOMException that would otherwise bubble into the caller's
    // promise chain and be mistaken for a PLAYBACK failure (it churned the
    // source-fallback loop). Metrics are best-effort, always.
    try {
      performance.mark("watch:webview-loaded");
      const hasSrcMark =
        performance.getEntriesByName("watch:webview-src-set").length > 0;
      if (hasSrcMark) {
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
      }
      performance.measure(
        "watch:total",
        "watch:client-mount",
        "watch:webview-loaded",
      );
    } catch {
      // Measurement is best-effort — never throw on perf logging
    }
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
  const handleAnimeRetry = retryChain;

  const handleSeasonChange = useCallback(
    (seasonNum: number) => {
      setSelectedSeason(seasonNum);
      setActiveEpisode(1);
      startTransition(async () => {
        const data = await tmdbApi.getSeason(contentid, seasonNum);
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

  // ── Direct exhausted all links → hand off to the next embed provider ──
  // Mirrors VideoZone's auto-fallback: "all direct links dead" lands the user
  // in a working embed instead of a dead-end card.
  const handleDirectExhausted = useCallback(() => {
    if (!currentProvider) return;
    if (!isDirectProvider(currentProvider)) return;
    const next = providers.find(
      (p) =>
        p.id !== currentProvider.id && !isDirectProvider(p) && !p.animeOnly,
    );
    if (!next) return;
    console.log(`[WatchClient] direct exhausted → switching to ${next.id}`);
    setTimeout(() => {
      handleProviderSelect(next);
      setIframeLoadError(false);
    }, 600);
  }, [currentProvider, providers, handleProviderSelect, setIframeLoadError]);

  const displayTitle = initialMeta?.name || initialMeta?.title || "";
  const year = (
    initialMeta?.release_date ||
    initialMeta?.first_air_date ||
    ""
  ).slice(0, 4);

  // ── Determine the webview/iframe key so it remounts on refresh ──
  const playerKey = isElectronEnv
    ? `dp-${selectedProviderId}-${selectedSeason}-${activeEpisode}-${audio}-${refreshKey}`
    : `wp-${selectedProviderId}-${selectedSeason}-${activeEpisode}-${audio}-${refreshKey}`;

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

  // ── Render (Web <1280px: tablet + phone) ──
  // SINGLE TREE. The player mounts EXACTLY ONCE (a CSS-hidden fork would
  // double-mount the iframe/webview + its watchdog timers → double playback).
  // Surfaces are differentiated with pure Tailwind breakpoints + orientation
  // media variants — no JS media queries, so SSR/CSR hydration stays clean.
  //
  //   Phone (<640):        viewport-locked flex-col — full-bleed video, one
  //                        cohesive episode card (tab dock / season bar / jump
  //                        strip / scroll list / pinned prev-next).
  //   Tablet landscape:    side grid (video col-span-8, episode card col-span-4).
  //   Tablet portrait:     video top + episode card below (vertical list).
  //
  return (
    <div className="flex flex-col h-[100dvh] w-full overflow-hidden bg-[#070708] text-muted-foreground select-none">
      {/* Film grain */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] bg-[url('/noise.svg')] mix-blend-overlay -z-10" />

      {/* ── Top bar: back + server (Compact & Clean on Mobile) ── */}
      {!minimal && (
        <header className="shrink-0 flex items-center justify-between gap-2.5 px-3 py-2 bg-[#0A0A0D]/95 backdrop-blur-md border-b border-white/[0.06] z-30">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => router.back()}
              className="flex items-center justify-center h-8 w-8 rounded-full bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.12] active:scale-95 transition-all shrink-0"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4 text-foreground" />
            </button>
            <div className="hidden sm:block min-w-0">
              <h1
                className="text-xs sm:text-sm font-bold text-foreground truncate leading-tight tracking-wide"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {displayTitle}
              </h1>
              <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500 leading-tight mt-0.5">
                <span className="text-[#D4A237]">
                  {plat === "tv" ? "Series" : "Film"}
                </span>
                <span className="w-1 h-1 rounded-full bg-zinc-700" />
                <span>{year}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {onMegaplay && (
              <AudioToggle audio={audio} onAudioChange={setAudio} />
            )}
            <ServerPickerSheet
              onSelect={handleProviderSelect}
              selectedId={selectedProviderId}
              providers={providers}
            />
          </div>
        </header>
      )}

      {/* ── Main: portrait = flex-col; tablet-landscape = 12-col grid ── */}
      <main className="flex-1 min-h-0 flex flex-col [@media(orientation:landscape)]:sm:grid [@media(orientation:landscape)]:sm:grid-cols-12 [@media(orientation:landscape)]:sm:gap-4 xl:gap-6 xl:max-w-[1700px] xl:mx-auto xl:w-full xl:px-6 xl:py-4 overflow-hidden">
        {/* ── Video cell (generous height on phone; framed on tablet/desktop) ── */}
        <section className="shrink-0 w-full [@media(orientation:landscape)]:sm:col-span-7 lg:col-span-8 [@media(orientation:landscape)]:sm:shrink [@media(orientation:landscape)]:sm:h-full flex flex-col justify-center">
          <div className="w-full px-0 sm:px-3 [@media(orientation:landscape)]:sm:px-0">
            <MobilePlayerZone
              contentid={contentid}
              plat={plat}
              currentProvider={currentProvider}
              selectedSeason={selectedSeason}
              activeEpisode={activeEpisode}
              embedUrl={embedUrl}
              initialEmbedUrl={initialEmbedUrl}
              playerKey={playerKey}
              sessionReady={sessionReady}
              isElectron={isElectronEnv}
              isPending={isPending}
              langAnswered={langAnswered}
              onLanguageSelect={handleLanguageSelect}
              onRetry={showAnimeExhausted ? handleAnimeRetry : handleRetry}
              onIframeLoad={handleIframeLoad}
              onIframeError={handleIframeError}
              onDirectExhausted={handleDirectExhausted}
              showAnimeExhausted={showAnimeExhausted}
              animeTriedList={animeTriedList}
              onAnimeRetry={handleAnimeRetry}
            />
          </div>
        </section>

        {/* ── Below-Video Area: Phone & Tablet Portrait uses MobileEpisodeSheet (TV) or Overview (Movie) ── */}
        <section className="flex-1 min-h-0 flex flex-col overflow-hidden [@media(orientation:landscape)]:sm:col-span-5 lg:col-span-4 [@media(orientation:landscape)]:sm:h-full">
          {plat === "tv" ? (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {/* Tablet landscape shows EpisodeSidebar; Phone + Tablet Portrait shows MobileEpisodeSheet */}
              <div className="hidden [@media(orientation:landscape)]:sm:flex flex-col h-full min-h-0">
                <EpisodeSidebar
                  seasonData={seasonData}
                  seasons={initialMeta?.seasons}
                  onSeasonChange={handleSeasonChange}
                  title={displayTitle}
                />
              </div>
              <div className="flex-1 min-h-0 flex flex-col [@media(orientation:landscape)]:sm:hidden overflow-hidden">
                <MobileEpisodeSheet
                  seasonData={seasonData}
                  seasons={initialMeta?.seasons}
                  onSeasonChange={handleSeasonChange}
                  seriesTitle={displayTitle}
                  seriesOverview={initialMeta?.overview}
                />
              </div>
            </div>
          ) : (
            // ── Movie: Overview ──
            <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-[#0E0E12] border-t border-white/[0.08] sm:border sm:rounded-2xl space-y-3">
              <div>
                <h3 className="text-sm font-bold text-foreground">Overview</h3>
                {initialMeta?.overview ? (
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    {initialMeta.overview}
                  </p>
                ) : (
                  <p className="text-xs text-zinc-600 mt-1">
                    No overview available.
                  </p>
                )}
              </div>
              {initialMeta?.genres && initialMeta.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {initialMeta.genres.map((g: any) => (
                    <span
                      key={g.id}
                      className="px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-[10px] text-zinc-400 font-medium"
                    >
                      {g.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </main>
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
  /** Explicit provider forced by the route (?provider=) — wins over all. */
  routeProvider?: string | null;
  minimal?: boolean;
  initialSeason?: number;
  initialEpisode?: number;
  /** Resume position in seconds (from ?t=) applied once playback starts. */
  initialResumeT?: number;
  /** Anime identity from URL (?mid=, ?aid=). */
  initialMalId?: number;
  initialAnilistId?: number;
  /** Pre-computed embed URL from URL params — enables immediate player mount. */
  initialEmbedUrl?: string | null;
}

export default function WatchClient({
  contentid,
  plat,
  initialMeta,
  initialSeasonData,
  defaultProvider,
  routeProvider,
  minimal = false,
  initialSeason = 1,
  initialEpisode = 1,
  initialResumeT,
  initialMalId,
  initialAnilistId,
  initialEmbedUrl,
}: WatchClientProps) {
  // Anime detection mirrors WatchClientContent (URL ids or genre heuristic).
  const isAnimeSession =
    initialMalId != null ||
    initialAnilistId != null ||
    Boolean(
      initialMeta?.genres?.some?.((g: any) => g.id === 16) &&
      initialMeta?.original_language === "ja",
    );
  return (
    <>
      {/* First-time Legal & DMCA acceptance (browser only — the desktop app
          gates at the root layout via DesktopLegalGate). Mounted OUTSIDE
          PlayerProvider so player state changes don't re-render it. */}
      <WebLegalGate />
      <PlayerProvider
        mediaType={plat}
        contentId={contentid}
        initialProviderId={
          // Canonical precedence (route → saved "default server" → platform
          // default) lives in the shared registry's resolveInitialProviderId;
          // this page only decides which platform's rules apply.
          resolveInitialProviderId({
            platform: isElectronNow() ? "desktop" : "web",
            routeProvider,
            savedServer: defaultProvider,
            anime: isAnimeSession,
          })
        }
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
          initialMalId={initialMalId}
          initialAnilistId={initialAnilistId}
          initialEmbedUrl={initialEmbedUrl}
        />
      </PlayerProvider>
    </>
  );
}
