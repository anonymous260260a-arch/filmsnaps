/**
 * VideoZone — wraps the video player, loading, error states, and
 * the server selector pill in a row above the player.
 *
 * Structure:
 *   ┌───────────────────────────────────────────┐
 *   │                           [Server pill ▾] │  ← server row, above video
 *   ├───────────────────────────────────────────┤
 *   │  ┌──────────────── dropdown ──────────┐  │  ← opens downward, floats over video
 *   │  │                                     │  │
 *   │  └─────────────────────────────────────┘  │
 *   │        Video player (webview/iframe)      │
 *   │                                           │
 *   └───────────────────────────────────────────┘
 */

"use client";

import React, { useState, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import type { ProviderDefinition, HealthCache } from "@filmsnaps/shared";
import { usePlayer } from "@/components/player/PlayerProvider";
import { DesktopSecureWebview } from "@/components/player/DesktopSecureWebview";
import { SecureIframe } from "@/components/player/SecureIframe";
import { FalixPlayer } from "@/components/player/FalixPlayer";
import { buildIframeCSP } from "@/lib/movieProviders/cspBuilder";
import { PlayerErrorState } from "./PlayerErrorState";
import { ServerDropdown } from "./ServerDropdown";

const DIRECT_VIDEO_PROVIDERS = new Set<string>(["falix"]);

interface VideoZoneProps {
  embedUrl: string;
  playerKey: string;
  /** True once the provider session is configured (per-provider rules + CSP installed in main). */
  sessionReady: boolean;
  isElectron: boolean;
  isPending: boolean;
  currentProvider: ProviderDefinition | undefined;
  providers: ProviderDefinition[];
  selectedProviderId: string | null;
  contentid: string;
  plat: "movie" | "tv";
  selectedSeason: number;
  activeEpisode: number;
  isServerOpen: boolean;
  onServerToggle: () => void;
  onServerClose: () => void;
  onSelectProvider: (provider: ProviderDefinition | null) => void;
  onRetry: () => void;
  onIframeLoad: () => void;
  onIframeError: () => void;
  healthCache: HealthCache;
  lastCheckedAt: number;
  isRefreshing: boolean;
  onRefreshHealth: () => void;
}

export function VideoZone({
  embedUrl,
  playerKey,
  sessionReady,
  isElectron,
  isPending,
  currentProvider,
  providers,
  selectedProviderId,
  contentid,
  plat,
  selectedSeason,
  activeEpisode,
  isServerOpen,
  onServerToggle,
  onServerClose,
  onSelectProvider,
  onRetry,
  onIframeLoad,
  onIframeError,
  healthCache,
  lastCheckedAt,
  isRefreshing,
  onRefreshHealth,
}: VideoZoneProps) {
  const {
    iframeLoadError,
    setIframeLoadError,
    cpuWarning,
    playerReady,
    refreshKey,
    setOverlayActive,
  } = usePlayer();

  // ── Health dot color ──
  const health = currentProvider
    ? healthCache.get(currentProvider.id)
    : undefined;
  const healthDotColor = !health
    ? "bg-[#52525B]"
    : !health.alive
      ? "bg-[#E05252]"
      : health.latencyMs < 300
        ? "bg-[#4CAF82]"
        : health.latencyMs <= 600
          ? "bg-[#E0A237]"
          : "bg-[#E05252]";

  // ── Handle error overlay "Try next" → switch to alternative ──
  const handleErrorSwitch = useCallback(
    (provider: ProviderDefinition | null) => {
      onSelectProvider(provider);
      setIframeLoadError(false);
    },
    [onSelectProvider, setIframeLoadError],
  );

  // ── Loading subtext ──
  const loadingSubtext = !currentProvider
    ? "Preparing stream..."
    : `Connecting to ${currentProvider.displayName || currentProvider.name}...`;

  // ── Sync server dropdown open state with overlayActive so the native view hides.
  React.useEffect(() => {
    setOverlayActive(isServerOpen);
  }, [isServerOpen, setOverlayActive]);

  // ── Sync CPU warning + error state with overlayActive.
  React.useEffect(() => {
    setOverlayActive(cpuWarning || iframeLoadError);
  }, [cpuWarning, iframeLoadError, setOverlayActive]);

  return (
    <div
      className="mx-auto w-full"
      style={{
        maxWidth: "1600px",
      }}
    >
      {/* ── Server pill row (above video) ── */}
      <div className="relative flex items-center justify-end pb-1 mt-4">
        <div className="relative">
          <button
            onClick={onServerToggle}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg
              bg-[#0E0E11] border border-[#222226] hover:border-white/20
              transition-all active:scale-[0.97]"
            aria-label="Select source server"
            title="Select server (S)"
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${healthDotColor}`}
            />
            <span className="text-[12px] font-semibold text-zinc-300">
              {currentProvider?.displayName || currentProvider?.name || "Auto"}
            </span>
            <ChevronDown size={12} className="text-zinc-500" />
          </button>

          {/* Dropdown opens downward, floats over the video */}
          <ServerDropdown
            providers={providers}
            selectedId={selectedProviderId}
            onSelect={onSelectProvider}
            healthCache={healthCache}
            lastCheckedAt={lastCheckedAt}
            onRefresh={onRefreshHealth}
            isRefreshing={isRefreshing}
            isOpen={isServerOpen}
            onClose={onServerClose}
          />
        </div>
      </div>

      {/* ── Video player container ── */}
      {/* Cap by max-width, NOT max-height. Capping max-height on a full-width
          16:9 box clips its bottom (the width never shrinks to keep the ratio).
          Capping max-width instead lets the box shrink and center via mx-auto so
          the full video always fits with proper letterboxing. */}
      <div
        className="relative w-full aspect-video mx-auto bg-[#0E0E11] rounded-xl sm:rounded-2xl overflow-hidden shadow-[0_8px_60px_rgba(0,0,0,0.8)] ring-1 ring-white/[0.08]"
        style={{
          // 350px = top bar (48px) + bottom chrome/content + breathing room.
          // The +16 is the watch page's pt-4 top margin so the video keeps
          // fitting without clipping.
          maxWidth: "calc((100vh - 366px) * 16 / 9)",
        }}
      >
        {/* CPU Warning */}
        {cpuWarning && currentProvider && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#070708]/80 backdrop-blur-sm">
            <div className="flex items-center gap-3 text-sm text-[#E05252] bg-red-500/10 px-5 py-4 rounded-xl border border-red-500/20 max-w-md mx-4">
              <div className="flex-1 text-xs sm:text-sm">
                This server is using too much CPU — it has been stopped.
                <span className="block mt-1 text-[#A1A1AA]">
                  Switch to a different server to continue watching.
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Error State */}
        {iframeLoadError && !cpuWarning && currentProvider && (
          <PlayerErrorState
            currentProviderName={
              currentProvider.displayName || currentProvider.name
            }
            providers={providers}
            selectedId={selectedProviderId}
            onSelectProvider={handleErrorSwitch}
            onRetry={onRetry}
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
              onLoad={onIframeLoad}
            />
          )}

        {/* Desktop: native WebContentsView (Phase 3 hybrid). Kept MOUNTED for
             the whole session — even across error/CPU-warning states — because
             the singleton view must never be torn down by a React gate. Its own
             visibility (player:set-visible) reconciles with the overlays above:
             it hides whenever this error/CPU-warning overlay must win the
             z-order over the rect. Gates here are mount-vs-not: only sessionReady
             + a real embed URL + a non-direct provider decide whether it exists. */}
        {isElectron &&
          sessionReady &&
          embedUrl &&
          currentProvider &&
          !DIRECT_VIDEO_PROVIDERS.has(currentProvider.id) && (
            <div className="absolute inset-0 z-10">
              {/* key on refreshKey ONLY (NOT the provider/episode/season):
                  a keyed remount is safe here (unlike the old <webview> —
                  main owns the WebContents, so a remount only resets this
                  controller, never tearing the singleton down), but it must not
                  fire on provider/episode/season switches — those navigate the
                  view in place via the src effect (see DesktopSecureWebview).
                  Retry (handleRetry → refreshIframe) bumps refreshKey, remounts,
                  and re-opens the same native view — a true reload with clean
                  local state (hasError=false, isLoading=true). */}
              <DesktopSecureWebview
                key={`${refreshKey}-electron`}
                src={embedUrl}
                onLoad={onIframeLoad}
                onError={onIframeError}
              />
            </div>
          )}

        {/* Web: SecureIframe */}
        {!isElectron &&
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
                currentProvider ? buildIframeCSP(currentProvider) : undefined
              }
              onLoad={onIframeLoad}
              onError={onIframeError}
            />
          )}

        {/* Cover overlays */}
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

        {/* Loading state */}
        {isPending && !playerReady && !iframeLoadError && !cpuWarning && (
          <div className="absolute inset-0 bg-[#070708] z-50 flex flex-col items-center justify-center gap-5 pointer-events-none">
            <div className="relative w-14 h-14">
              <div className="absolute inset-0 rounded-full border-2 border-[#222226]" />
              <div
                className="absolute inset-0 rounded-full border-t-2 border-[#D4A237] animate-spin"
                style={{ animationDuration: "1.2s" }}
              />
              <div className="absolute inset-3 rounded-full border-2 border-[#222226]" />
              <div className="absolute inset-[18px] rounded-full bg-[#D4A237]/30" />
            </div>
            <p className="text-xs font-black text-[#52525B] uppercase tracking-[0.3em] animate-pulse">
              Scanning Projection Room
            </p>
            <p className="text-[10px] text-zinc-600 -mt-3">{loadingSubtext}</p>
          </div>
        )}
      </div>
    </div>
  );
}
