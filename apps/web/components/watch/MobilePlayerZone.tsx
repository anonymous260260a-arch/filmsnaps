"use client";

/**
 * MobilePlayerZone — the player area of the web/mobile (<1280px) watch page.
 *
 * Renders exactly ONE player surface depending on the current provider:
 *   - FalixPlayer (direct · HEVC downloads)
 *   - DirectVideoPlayer (direct · universal format) + first-run language prompt
 *   - DesktopSecureWebview (Electron embed)
 *   - SecureIframe (web embed)
 * plus the CPU-warning overlay, error state, cover overlays and the
 * loading/controls overlay. The parent owns all player state; this
 * component is presentation-only.
 */

import React from "react";
import { AlertCircle, Clapperboard, RefreshCw, X } from "lucide-react";
import { isDirectProvider } from "@filmsnaps/shared";
import type { ProviderDefinition } from "@filmsnaps/shared";
import { usePlayer } from "@/components/player/PlayerProvider";
import { SecureIframe } from "@/components/player/SecureIframe";
import { DesktopSecureWebview } from "@/components/player/DesktopSecureWebview";
import { FalixPlayer } from "@/components/player/FalixPlayer";
import { DirectVideoPlayer } from "@/components/player/DirectVideoPlayer";
import { LanguagePromptSheet } from "@/components/player/LanguagePromptSheet";
import { PlayerControlOverlay } from "@/components/player/PlayerControlOverlay";
import { buildIframeCSP } from "@/lib/movieProviders/cspBuilder";
import { getSettings } from "@/hooks/useSettings";
import type { PreferredLanguage } from "@/lib/streamSelector";

interface MobilePlayerZoneProps {
  contentid: string;
  plat: "movie" | "tv";
  currentProvider: ProviderDefinition | undefined;
  selectedSeason: number;
  activeEpisode: number;
  embedUrl: string;
  /** Pre-computed embed URL from URL params — enables immediate player mount. */
  initialEmbedUrl?: string | null;
  playerKey: string;
  sessionReady: boolean;
  isElectron: boolean;
  isPending: boolean;
  langAnswered: boolean;
  onLanguageSelect: (value: PreferredLanguage) => void;
  onRetry: () => void;
  onIframeLoad: () => void;
  onIframeError: () => void;
  onDirectExhausted: () => void;
  /** Anime chain exhausted — terminal copy + debug list (verdict Q10). */
  showAnimeExhausted?: boolean;
  animeTriedList?: string[];
  onAnimeRetry?: () => void;
}

export function MobilePlayerZone({
  contentid,
  plat,
  currentProvider,
  selectedSeason,
  activeEpisode,
  embedUrl,
  initialEmbedUrl,
  playerKey,
  sessionReady,
  isElectron,
  isPending,
  langAnswered,
  onLanguageSelect,
  onRetry,
  onIframeLoad,
  onIframeError,
  onDirectExhausted,
  showAnimeExhausted = false,
  animeTriedList,
  onAnimeRetry,
}: MobilePlayerZoneProps) {
  const { iframeLoadError, cpuWarning, playerReady, refreshKey } = usePlayer();

  return (
    <div className="relative w-full h-[38vh] min-h-[245px] max-h-[46vh] sm:h-auto sm:aspect-video bg-[#070708] sm:bg-[#0E0E11] sm:rounded-2xl overflow-hidden shadow-[0_12px_50px_rgba(0,0,0,0.9)] sm:ring-1 sm:ring-white/[0.08] group/player flex items-center justify-center">
      {/* Ambient glow */}
      <div className="absolute -inset-10 bg-gradient-radial from-[#D4A237]/10 via-transparent to-transparent opacity-40 pointer-events-none z-0 transition-opacity duration-700 group-hover/player:opacity-70" />

      {/* CPU Warning */}
      {cpuWarning && currentProvider && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#070708]/85 backdrop-blur-md p-4">
          <div className="flex items-start gap-3 text-xs sm:text-sm text-[#E05252] bg-red-500/10 p-4 rounded-xl border border-red-500/20 max-w-md shadow-2xl">
            <AlertCircle size={18} className="text-[#E05252] shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-bold block text-foreground mb-0.5">
                Server Overloaded
              </span>
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
        <InlineErrorState
          onRetry={showAnimeExhausted ? (onAnimeRetry ?? onRetry) : onRetry}
          variant={showAnimeExhausted ? "anime-exhausted" : "standard"}
          tried={showAnimeExhausted ? animeTriedList : undefined}
        />
      )}

      {/* Direct-video player (Falix) */}
      {!cpuWarning &&
        currentProvider &&
        isDirectProvider(currentProvider) &&
        currentProvider.id === "falix" && (
          <FalixPlayer
            tmdbId={contentid}
            mediaType={plat}
            selectedSeason={selectedSeason}
            activeEpisode={activeEpisode}
            onLoad={onIframeLoad}
          />
        )}

      {/* Direct-video players (registry type:"direct") */}
      {!cpuWarning &&
        currentProvider &&
        isDirectProvider(currentProvider) &&
        currentProvider.id !== "falix" &&
        (langAnswered ? (
          <DirectVideoPlayer
            tmdbId={contentid}
            mediaType={plat}
            providerId={currentProvider.id}
            selectedSeason={selectedSeason}
            activeEpisode={activeEpisode}
            onLoad={onIframeLoad}
            onError={onIframeError}
            onExhausted={onDirectExhausted}
            preferredLanguage={
              (getSettings().preferredAudioLanguage as PreferredLanguage) ||
              "auto"
            }
          />
        ) : (
          <LanguagePromptSheet onSelect={onLanguageSelect} />
        ))}

      {/* Desktop: native WebContentsView (Phase 3 hybrid). Kept MOUNTED
          for the whole session; keyed on refreshKey only.
          On first load, initialEmbedUrl bypasses the session gate
          so the webview mounts immediately while IPC runs in parallel. */}
      {isElectron &&
        (sessionReady || initialEmbedUrl) &&
        (embedUrl || initialEmbedUrl) &&
        currentProvider &&
        !isDirectProvider(currentProvider) && (
          <div className="absolute inset-0 z-10">
            <DesktopSecureWebview
              key={`${refreshKey}-electron`}
              src={embedUrl || initialEmbedUrl || ""}
              onLoad={onIframeLoad}
              onError={onIframeError}
            />
          </div>
        )}

      {/* Web: SecureIframe with JS-level guards.
          On first load, initialEmbedUrl bypasses the TMDB-dependent
          embedUrl so the iframe mounts immediately. */}
      {!isElectron &&
        !cpuWarning &&
        !iframeLoadError &&
        (embedUrl || initialEmbedUrl) &&
        currentProvider &&
        !isDirectProvider(currentProvider) && (
          <SecureIframe
            key={playerKey}
            src={embedUrl || initialEmbedUrl || ""}
            sandbox={currentProvider?.sandbox}
            csp={currentProvider ? buildIframeCSP(currentProvider) : undefined}
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

      {/* Loading / controls overlay */}
      <PlayerControlOverlay
        isPending={
          (!playerReady || isPending) &&
          !!currentProvider &&
          !isDirectProvider(currentProvider)
        }
      />
    </div>
  );
}

// ── Inline error state ──────────────────────────────────────────

export function InlineErrorState({
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
