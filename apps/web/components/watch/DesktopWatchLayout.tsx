/**
 * DesktopWatchLayout — main layout orchestrator for the two-zone immersive
 * Watch page at ≥1280px viewport.
 *
 * Structure:
 *   ┌─ WatchTopBar (unified nav + content) ──────────┐
 *   ├── VideoZone (player + server pill top-right) ──┤
 *   ├── PlayerControlBar (PiP, buffering) ───────────┤
 *   ├── InfoZone (60/40 grid) ───────────────────────┤
 *   └────────────────────────────────────────────────┘
 */

"use client";

import React, { useCallback, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePlayer } from "@/components/player/PlayerProvider";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useWatchKeyboardShortcuts } from "@/hooks/useWatchKeyboardShortcuts";
import { usePlayerHealth } from "@/hooks/usePlayerHealth";
import {
  setWatchContext,
  setImmersive,
} from "@/components/desktop/chrome-store";
import { VideoZone } from "./VideoZone";
import { PlayerControlBar } from "./PlayerControlBar";
import { StuckVideoToast } from "./StuckVideoToast";
import { InfoZone } from "./InfoZone";
import type { ProviderDefinition } from "@filmsnaps/shared";

interface DesktopWatchLayoutProps {
  contentid: string;
  plat: "movie" | "tv";
  initialMeta: any;
  seasonData: any;
  providers: ProviderDefinition[];
  currentProvider: ProviderDefinition | undefined;
  selectedProviderId: string | null;
  embedUrl: string;
  playerKey: string;
  /** True once the provider session is configured (per-provider rules + CSP installed in main). */
  sessionReady: boolean;
  isElectron: boolean;
  isPending: boolean;
  selectedSeason: number;
  activeEpisode: number;
  onProviderSelect: (provider: ProviderDefinition | null) => void;
  onSeasonChange: (season: number) => void;
  onRetry: () => void;
  onIframeLoad: () => void;
  onIframeError: () => void;
  /** MegaPlay fallback-chain state (present only in anime sessions). */
  animeChain?: AnimeChainState;
}

export interface AnimeChainState {
  exhausted: boolean;
  tried: string[];
  canAdvance: boolean;
  onAdvance: () => void;
  missReason: string | null;
}

export function DesktopWatchLayout({
  contentid,
  plat,
  initialMeta,
  seasonData,
  providers,
  currentProvider,
  selectedProviderId,
  embedUrl,
  playerKey,
  sessionReady,
  isElectron,
  isPending,
  selectedSeason,
  activeEpisode,
  onProviderSelect,
  onSeasonChange,
  onRetry,
  onIframeLoad,
  onIframeError,
  animeChain,
}: DesktopWatchLayoutProps) {
  const router = useRouter();
  const isDesktopVp = useIsDesktop();
  const { isFullscreen, playerReady, iframeLoadError } = usePlayer();

  const handleBack = useCallback(() => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  }, [router]);

  const [isServerOpen, setIsServerOpen] = useState(false);

  // Toggle for the pill button; close-only for dropdown close/select so
  // click-outside or selecting an option never re-opens it.
  const toggleServer = useCallback(() => setIsServerOpen((prev) => !prev), []);
  const closeServer = useCallback(() => setIsServerOpen(false), []);

  const { healthCache, lastCheckedAt, isRefreshing, refresh } = usePlayerHealth(
    {
      providers,
      skipInitial: true,
    },
  );

  // Defer the first health sweep off the playback critical path — the
  // webview mounts with src=embedUrl immediately; health only decorates the
  // pill/dropdown. requestIdleCallback with a 2s fallback timeout.
  useEffect(() => {
    if (providers.length === 0) return;
    const id = requestIdleCallback(
      () => {
        refresh();
      },
      { timeout: 2000 },
    );
    return () => cancelIdleCallback(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers]);

  useWatchKeyboardShortcuts({
    isDesktop: isDesktopVp,
    isServerOpen,
    onServerToggle: toggleServer,
    onGoBack: handleBack,
  });

  const infoZoneHidden = isFullscreen;

  // ── Push watch context to the global desktop top bar ──
  // The DesktopAppShell renders one GlobalTopBar for the whole app. The
  // watch page tells it what to show (title + gold S:E) so it stays
  // consistent with the rest of the app.
  const watchTitle = initialMeta?.name || initialMeta?.title || "";
  const watchYear = (
    initialMeta?.release_date ||
    initialMeta?.first_air_date ||
    ""
  ).slice(0, 4);

  useEffect(() => {
    setWatchContext({
      title: watchTitle,
      year: watchYear,
      season: plat === "tv" ? selectedSeason : undefined,
      episode: plat === "tv" ? activeEpisode : undefined,
    });
    return () => setWatchContext(null);
  }, [watchTitle, watchYear, plat, selectedSeason, activeEpisode]);

  // Immersive fullscreen: hide the global bar + sidebar so the video
  // owns the entire window.
  useEffect(() => {
    setImmersive(isFullscreen);
    return () => setImmersive(false);
  }, [isFullscreen]);

  return (
    <>
      {/* Film grain */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] bg-[url('/noise.svg')] mix-blend-overlay z-0" />

      <main className="pt-4 transition-all duration-300">
        {/* Video Zone */}
        <div className="mx-auto max-w-[1600px] px-0 sm:px-4">
          <VideoZone
            embedUrl={embedUrl}
            playerKey={playerKey}
            sessionReady={sessionReady}
            isElectron={isElectron}
            isPending={isPending}
            currentProvider={currentProvider}
            providers={providers}
            selectedProviderId={selectedProviderId}
            contentid={contentid}
            plat={plat}
            selectedSeason={selectedSeason}
            activeEpisode={activeEpisode}
            isServerOpen={isServerOpen}
            onServerToggle={toggleServer}
            onServerClose={closeServer}
            onSelectProvider={onProviderSelect}
            onRetry={onRetry}
            onIframeLoad={onIframeLoad}
            onIframeError={onIframeError}
            healthCache={healthCache}
            lastCheckedAt={lastCheckedAt}
            isRefreshing={isRefreshing}
            onRefreshHealth={refresh}
            animeChain={animeChain}
          />
        </div>

        {/* PlayerControlBar — PiP + buffering */}
        {!isFullscreen && (
          <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
            <PlayerControlBar
              isPending={isPending}
              isPlayerReady={playerReady}
              isElectron={isElectron}
            />
          </div>
        )}

        {/* Stuck Video Toast */}
        {!infoZoneHidden && !iframeLoadError && (
          <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
            <StuckVideoToast />
          </div>
        )}

        {/* Info Zone */}
        {!infoZoneHidden && (
          <InfoZone
            plat={plat}
            initialMeta={initialMeta}
            contentid={contentid}
            seasonData={seasonData}
            seasons={initialMeta?.seasons}
            onSeasonChange={onSeasonChange}
          />
        )}
      </main>
    </>
  );
}
