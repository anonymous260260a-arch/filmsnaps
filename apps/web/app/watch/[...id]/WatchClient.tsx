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
import { getEnabledProviders } from "@filmsnaps/shared";
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

function buildEmbedUrl(
  provider: ProviderDefinition,
  contentid: string,
  plat: "movie" | "tv",
  selectedSeason: number,
  activeEpisode: number,
): string {
  const embedPath =
    plat === "tv"
      ? provider.embed.tv(contentid, selectedSeason, activeEpisode)
      : provider.embed.movie(contentid);

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

  // ── Hooks ──
  useKeyboardShortcuts();

  // ── Platform-gated provider list ──
  // Web (browser, any viewport): only providers that declare the web platform
  // (or leave platforms unspecified — the registry default is "everywhere").
  // Desktop Electron: all enabled providers — the desktop webview session
  // (R0-R8) governs which actually play, so the picker shows the full set.
  const providers = useMemo(
    () =>
      isElectronEnv
        ? getEnabledProviders()
        : getEnabledProviders().filter(
            (p) => !p.platforms || p.platforms.includes("web"),
          ),
    [isElectronEnv],
  );

  // Resolve current provider
  const currentProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId) ?? providers[0],
    [providers, selectedProviderId],
  );

  // ── Embed URL ──
  const embedUrl = currentProvider
    ? buildEmbedUrl(
        currentProvider,
        contentid,
        plat,
        selectedSeason,
        activeEpisode,
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
        onRetry={handleRetry}
        onIframeLoad={handleIframeLoad}
        onIframeError={handleIframeError}
      />
    );
  }

  // ── Render (Mobile/Tablet: <1280px existing layout) ──
  return (
    <div className="min-h-screen bg-[#070708] text-[#A1A1AA]">
      {/* Film grain */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] bg-[url('/noise.svg')] mix-blend-overlay -z-10" />

      <div className="mx-auto w-full max-w-[1200px] px-3 sm:px-4 lg:px-6">
        {/* ── Title + Server area ── */}
        {!minimal && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3 pb-2">
            <div className="min-w-0">
              <h1
                className="text-lg sm:text-xl font-bold text-[#F4F4F5] truncate"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {displayTitle}
              </h1>
              <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">
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
                  <span className="block mt-1 text-[#A1A1AA]">
                    Switch to a different server above to continue watching.
                  </span>
                </div>
                <button
                  onClick={() => {}}
                  className="text-[#52525B] hover:text-[#F4F4F5] transition-colors p-1 flex-shrink-0"
                  aria-label="Dismiss"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Error State */}
          {iframeLoadError && !cpuWarning && (
            <PlayerErrorState onRetry={handleRetry} />
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

          {/* ── Desktop: Electron <webview> with R0-R8 session filtering ──
               Mounted only after the provider session is configured
               (sessionReady) so the webview can never navigate before the
               main process has installed per-provider rules + CSP. Uses
               appliedEmbedUrl (the held URL) so a provider switch never
               unmounts the singleton and never navigates before rules exist. */}
          {isElectronEnv &&
            sessionReady &&
            !cpuWarning &&
            !iframeLoadError &&
            appliedEmbedUrl &&
            currentProvider &&
            !DIRECT_VIDEO_PROVIDERS.has(currentProvider.id) && (
              // NO key — the webview is a singleton (see VideoZone).
              <div className="absolute inset-0 z-10">
                <DesktopSecureWebview
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

        {/* ── Stuck-video hint ── */}
        <div className="flex items-center gap-2.5 px-3 py-2.5 mt-2 rounded-xl bg-[#D4A237]/8 border border-[#D4A237]/15">
          <AlertCircle size={14} className="text-[#D4A237] shrink-0" />
          <p className="text-xs sm:text-sm text-zinc-400">
            Video stuck? Switch the source server at the top.
          </p>
        </div>

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

function PlayerErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#070708] z-40 gap-4 px-6">
      <Clapperboard className="text-[#D4A237]" size={48} strokeWidth={1.5} />
      <p
        className="text-xl text-[#F4F4F5] font-bold text-center"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Projection Reel Snapped
      </p>
      <p className="text-sm text-[#A1A1AA] text-center max-w-xs">
        We couldn&apos;t load this stream. The source server might be offline.
      </p>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#D4A237] text-[#070708] text-sm font-bold hover:bg-[#B88B2A] transition-colors active:scale-95"
      >
        <RefreshCw size={14} />
        Reload Source
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
        />
      </PlayerProvider>
    </>
  );
}
