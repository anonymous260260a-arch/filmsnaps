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
import type { ProviderDefinition } from "@filmsnaps/shared";
import { usePlayer } from "@/components/player/PlayerProvider";
import { DesktopSecureWebview } from "@/components/player/DesktopSecureWebview";
import { SecureIframe } from "@/components/player/SecureIframe";
import { FalixPlayer } from "@/components/player/FalixPlayer";
import { buildIframeCSP } from "@/lib/movieProviders/cspBuilder";
import { PlayerErrorState } from "./PlayerErrorState";
import { ServerDropdown } from "./ServerDropdown";
import { AudioToggle } from "@/components/player/AudioToggle";
import type { AnimeChainState } from "./DesktopWatchLayout";

const DIRECT_VIDEO_PROVIDERS = new Set<string>(["falix"]);

interface VideoZoneProps {
  embedUrl: string;
  playerKey: string;
  /** "belowfold" (default) = cap by max-width calc so it sits below the fold;
   *  "grid" = fill the parent grid cell (height-capped by the viewport-locked
   *  layout); the parent owns sizing + letterbox centering. */
  fit?: "belowfold" | "grid";
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
  /** MegaPlay fallback-chain state (present only in anime sessions). */
  animeChain?: AnimeChainState;
}

export function VideoZone({
  embedUrl,
  playerKey,
  fit = "belowfold",
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
  animeChain,
}: VideoZoneProps) {
  const {
    iframeLoadError,
    setIframeLoadError,
    cpuWarning,
    playerReady,
    refreshKey,
    setOverlayActive,
    audio,
    setAudio,
  } = usePlayer();

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
      className={
        fit === "grid"
          ? "w-full h-full flex flex-col min-h-0"
          : "mx-auto w-full"
      }
      style={
        fit === "grid"
          ? undefined
          : {
              maxWidth: "1600px",
            }
      }
    >
      {/* ── Server pill row (above video, belowfold mode only) ── */}
      {/* In grid/desktop mode, the server picker lives in the top controls bar */}
      {fit !== "grid" && (
        <div className="relative flex items-center justify-end gap-2 pb-1.5 mt-0.5">
          {currentProvider?.animeOnly && (
            <AudioToggle audio={audio} onAudioChange={setAudio} />
          )}
          <div className="relative">
            <button
              onClick={onServerToggle}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg
                bg-[#0E0E11] border border-[#222226] hover:border-white/20
                transition-all active:scale-[0.97]"
              aria-label="Select source server"
              title="Select server (S)"
            >
              <span className="text-[12px] font-semibold text-zinc-300">
                {currentProvider?.displayName ||
                  currentProvider?.name ||
                  "Auto"}
              </span>
              <ChevronDown size={12} className="text-zinc-500" />
            </button>

            {/* Dropdown opens downward, floats over the video */}
            <ServerDropdown
              providers={providers}
              selectedId={selectedProviderId}
              onSelect={onSelectProvider}
              isOpen={isServerOpen}
              onClose={onServerClose}
            />
          </div>
        </div>
      )}

      {/* ── Video player container ── */}
      {/* grid mode: parent cell owns sizing; this box fills height/width via
          aspect-video + max-h-full/max-w-full and centers through the flex
          wrapper below. belowfold mode: cap by max-width (NOT max-height) so the
          full 16:9 box fits with proper letterboxing. The wrapper is always
          present (neutral `block` in belowfold) to keep JSX balanced. */}
      <div
        className={
          fit === "grid"
            ? "flex-1 min-h-0 flex items-center justify-center"
            : "contents"
        }
      >
        <div
          className={
            fit === "grid"
              ? "relative w-full aspect-video max-h-full max-w-full bg-[#0E0E11] rounded-2xl overflow-hidden shadow-[0_8px_60px_rgba(0,0,0,0.8)] ring-1 ring-white/[0.08]"
              : "relative w-full aspect-video mx-auto bg-[#0E0E11] rounded-xl sm:rounded-2xl overflow-hidden shadow-[0_8px_60px_rgba(0,0,0,0.8)] ring-1 ring-white/[0.08]"
          }
          style={
            fit === "grid"
              ? undefined
              : {
                  // Prioritize the video: reserve only the top bar (48px) + the
                  // watch page pt-4 gutter (+16) + a small breathing margin (+24).
                  maxWidth: "calc((100vh - 88px) * 16 / 9)",
                }
          }
        >
          {/* CPU Warning */}
          {cpuWarning && currentProvider && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#070708]/80 backdrop-blur-sm">
              <div className="flex items-center gap-3 text-sm text-[#E05252] bg-red-500/10 px-5 py-4 rounded-xl border border-red-500/20 max-w-md mx-4">
                <div className="flex-1 text-xs sm:text-sm">
                  This server is using too much CPU — it has been stopped.
                  <span className="block mt-1 text-muted-foreground">
                    Switch to a different server to continue watching.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Error State — standard, or the terminal anime-chain variant */}
          {(iframeLoadError || animeChain?.exhausted) &&
            !cpuWarning &&
            currentProvider && (
              <PlayerErrorState
                currentProviderName={
                  currentProvider.displayName || currentProvider.name
                }
                providers={providers}
                selectedId={selectedProviderId}
                onSelectProvider={handleErrorSwitch}
                onRetry={onRetry}
                variant={animeChain?.exhausted ? "anime-exhausted" : "standard"}
                tried={animeChain?.exhausted ? animeChain.tried : undefined}
              />
            )}

          {/* Manual chain advance (web browser on desktop layout — Electron
            auto-advances on the deterministic 410 signal; verdict Q5 keeps
            soft signals manual everywhere). */}
          {animeChain &&
            !animeChain.exhausted &&
            animeChain.canAdvance &&
            playerReady &&
            !iframeLoadError &&
            !cpuWarning && (
              <button
                onClick={animeChain.onAdvance}
                className="absolute bottom-3 right-3 z-30 flex items-center gap-1.5 px-3.5 py-2 rounded-full
                bg-black/60 backdrop-blur-sm border border-violet-400/30 text-violet-300
                text-xs font-bold hover:bg-black/80 transition-all active:scale-95"
              >
                Not playing? Try next anime source
              </button>
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
              <p className="text-xs font-black text-faint uppercase tracking-[0.3em] animate-pulse">
                Scanning Projection Room
              </p>
              <p className="text-[11px] text-zinc-600 -mt-3">
                {loadingSubtext}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
