/**
 * WatchClient — composed video player with cinematic UX.
 *
 * Layout: server top, video center, episodes bottom — compact.
 * Features: keyboard shortcuts, error/loading states.
 */

'use client';

import React, {
  useTransition,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  X,
  Film,
  ArrowLeft,
  Clapperboard,
  RefreshCw,
} from 'lucide-react';
import { getSeasonAction } from '@/lib/actions';
import { getEnabledProviders } from '@filmsnaps/shared';
import { getImageUrl } from '@/lib/tmdb';
import { PlayerProvider, usePlayer } from '@/components/player/PlayerProvider';
import { SecureIframe } from '@/components/player/SecureIframe';
import { FalixPlayer } from '@/components/player/FalixPlayer';
import { ServerPickerSheet } from '@/components/player/ServerPickerSheet';
import { EpisodeRail } from '@/components/player/EpisodeRail';
import { PlayerControlOverlay } from '@/components/player/PlayerControlOverlay';
import { buildIframeCSP } from '@/lib/movieProviders/cspBuilder';
import type { ProviderDefinition } from '@filmsnaps/shared';

// ── Types ─────────────────────────────────────────────────────────

interface WatchClientContentProps {
  contentid: string;
  plat: 'movie' | 'tv';
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
 * instead of SecureIframe.
 */
const DIRECT_VIDEO_PROVIDERS = new Set<string>(['falix']);

function buildEmbedUrl(
  provider: ProviderDefinition,
  contentid: string,
  plat: 'movie' | 'tv',
  selectedSeason: number,
  activeEpisode: number,
): string {
  const embedPath =
    plat === 'tv'
      ? provider.embed.tv(contentid, selectedSeason, activeEpisode)
      : provider.embed.movie(contentid);

  // Route through server-side proxy to strip ads/trackers and
  // inject the runtime protection script.
  if (PROXIED_PROVIDERS.has(provider.id)) {
    const [pathPart, queryPart] = embedPath.split('?');
    const proxyPath = `/api/player/${provider.id}${pathPart}`;
    return queryPart ? `${proxyPath}?${queryPart}` : proxyPath;
  }

  return `${provider.baseUrl}${embedPath}`;
}

function absUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${window.location.origin}${path}`;
}

// ── Keyboard shortcuts hook ─────────────────────────────────────

function useKeyboardShortcuts() {
  const { toggleFullscreen, goToNextEpisode, goToPrevEpisode } = usePlayer();

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;

      switch (e.key.toLowerCase()) {
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'n':
          e.preventDefault();
          goToNextEpisode();
          break;
        case 'p':
          e.preventDefault();
          goToPrevEpisode();
          break;
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [toggleFullscreen, goToNextEpisode, goToPrevEpisode]);
}

// ── Content (inner) — lives inside PlayerProvider ─────────────────

function WatchClientContent({
  contentid,
  plat,
  initialMeta,
  initialSeasonData,
  minimal = false,
}: WatchClientContentProps) {
  const [isPending, startTransition] = useTransition();
  const [seasonData, setSeasonData] = useState(initialSeasonData);
  const [electronVideoOpen, setElectronVideoOpen] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);

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

  // ── Hooks ──
  useKeyboardShortcuts();

  // Only show providers marked for web
  const providers = useMemo(
    () => getEnabledProviders().filter((p) => p.platforms?.includes('web')),
    [],
  );

  // Resolve current provider
  const currentProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId) ?? providers[0],
    [providers, selectedProviderId],
  );

  // ── Embed URL ──
  const embedUrl = currentProvider
    ? buildEmbedUrl(currentProvider, contentid, plat, selectedSeason, activeEpisode)
    : '';

  // Reset loading state when URL changes
  useEffect(() => {
    setPlayerReady(false);
    setIframeLoadError(false);
  }, [embedUrl, setIframeLoadError]);

  // ── Callbacks ──
  const handleIframeLoad = useCallback(() => {
    setPlayerReady(true);
    setIframeLoadError(false);
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
    (provider: ProviderDefinition) => {
      setSelectedProvider(provider.id);
    },
    [setSelectedProvider],
  );

  // ── Desktop Electron integration ──
  const isDesktop =
    typeof window !== 'undefined' && window.electronAPI?.isDesktop === true;
  const activeProviderRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isDesktop) return;
    if (!currentProvider || !currentProvider.baseUrl) return;
    if (activeProviderRef.current === currentProvider.id) return;
    activeProviderRef.current = currentProvider.id;

    const url = absUrl(
      buildEmbedUrl(currentProvider, contentid, plat, selectedSeason, activeEpisode),
    );
    window.electronAPI
      ?.openVideo({
        type: plat,
        id: contentid,
        season: plat === 'tv' ? selectedSeason : undefined,
        episode: plat === 'tv' ? activeEpisode : undefined,
        provider: currentProvider.id,
        embedUrl: url,
      })
      .then((result) => {
        if (result?.success) setElectronVideoOpen(true);
      });
  }, [isDesktop, currentProvider, contentid, plat, selectedSeason, activeEpisode]);

  useEffect(() => {
    if (!isDesktop || !window.electronAPI) return;
    const handleClosed = () => setElectronVideoOpen(false);
    window.electronAPI.onVideoClosed(handleClosed);
    return () => window.electronAPI?.removeVideoClosedListener();
  }, [isDesktop]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        window.electronAPI.closeVideo();
        window.electronAPI.removeVideoClosedListener();
      }
    };
  }, []);

  const reopenElectronPlayer = useCallback(() => {
    if (!currentProvider) return;
    setElectronVideoOpen(false);
    setTimeout(() => {
      const url = absUrl(
        buildEmbedUrl(currentProvider, contentid, plat, selectedSeason, activeEpisode),
      );
      window.electronAPI
        ?.openVideo({ type: plat, id: contentid, provider: currentProvider.id, embedUrl: url })
        .then((r) => {
          if (r?.success) setElectronVideoOpen(true);
        });
    }, 100);
  }, [currentProvider, contentid, plat, selectedSeason, activeEpisode]);

  const openElectronPlayer = useCallback(() => {
    if (!currentProvider) return;
    const url = absUrl(
      buildEmbedUrl(currentProvider, contentid, plat, selectedSeason, activeEpisode),
    );
    window.electronAPI
      ?.openVideo({ type: plat, id: contentid, provider: currentProvider.id, embedUrl: url })
      .then((r) => {
        if (r?.success) setElectronVideoOpen(true);
      });
  }, [currentProvider, contentid, plat, selectedSeason, activeEpisode]);

  const displayTitle = initialMeta?.name || initialMeta?.title || '';
  const year = (initialMeta?.release_date || initialMeta?.first_air_date || '').slice(0, 4);

  // ── PC / Console fallback for Electron ──
  if (isDesktop && electronVideoOpen) {
    return (
      <div className="min-h-screen bg-[#070708] text-[#A1A1AA] flex items-center justify-center p-4">
        <DesktopVideoPlayer
          provider={currentProvider}
          meta={initialMeta}
          plat={plat}
          onReopen={reopenElectronPlayer}
        />
      </div>
    );
  }
  if (isDesktop && !electronVideoOpen) {
    return (
      <div className="min-h-screen bg-[#070708] text-[#A1A1AA] flex items-center justify-center p-4">
        <DesktopVideoIdle
          provider={currentProvider}
          meta={initialMeta}
          plat={plat}
          onOpen={openElectronPlayer}
        />
      </div>
    );
  }

  // ── Render ──
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
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {displayTitle}
              </h1>
              <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">
                <span className="text-[#D4A237]">{plat === 'tv' ? 'Series' : 'Film'}</span>
                <span className="w-1 h-1 rounded-full bg-zinc-700" />
                <span>{year}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <ServerPickerSheet onSelect={handleProviderSelect} selectedId={selectedProviderId} />
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
                <AlertCircle size={16} className="text-[#E05252] flex-shrink-0" />
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
          {!cpuWarning && currentProvider && DIRECT_VIDEO_PROVIDERS.has(currentProvider.id) && (
            <FalixPlayer
              tmdbId={contentid}
              mediaType={plat}
              selectedSeason={selectedSeason}
              activeEpisode={activeEpisode}
              onLoad={handleIframeLoad}
            />
          )}

          {/* Embed iframe player (all other providers) */}
          {!cpuWarning && !iframeLoadError && embedUrl && currentProvider && !DIRECT_VIDEO_PROVIDERS.has(currentProvider.id) && (
            <SecureIframe
              src={embedUrl}
              sandbox={currentProvider?.sandbox}
              // Skip iframe CSP attribute for proxied providers — the
              // server already sets a CSP header on the response, and
              // `default-src 'none'` from buildIframeCSP is too restrictive
              // for same-origin proxied content.
              csp={
                currentProvider && !PROXIED_PROVIDERS.has(currentProvider.id)
                  ? buildIframeCSP(currentProvider)
                  : undefined
              }
              key={`provider-${selectedProviderId}-${selectedSeason}-${activeEpisode}-${refreshKey}`}
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
                borderRadius: '20px',
                background: 'rgba(14, 14, 17, 0.9)',
              }}
            />
          ))}

          {/* Loading / controls overlay — skip for direct-video providers (FalixPlayer manages its own UI) */}
          <PlayerControlOverlay isPending={(!playerReady || isPending) && !DIRECT_VIDEO_PROVIDERS.has(currentProvider?.id)} />
        </div>

        {/* ── Stuck-video hint ── */}
        <div className="flex items-center gap-2.5 px-3 py-2.5 mt-2 rounded-xl bg-[#D4A237]/8 border border-[#D4A237]/15">
          <AlertCircle size={14} className="text-[#D4A237] shrink-0" />
          <p className="text-xs sm:text-sm text-zinc-400">
            Video stuck? Switch the source server at the top.
          </p>
        </div>

        {/* ── Episode Rail (TV only) ── */}
        {plat === 'tv' && (
          <EpisodeRail
            seasonData={seasonData}
            seasons={initialMeta?.seasons}
            onSeasonChange={handleSeasonChange}
          />
        )}

        {/* ── Movie overview ── */}
        {plat === 'movie' && !minimal && initialMeta?.overview && (
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
        style={{ fontFamily: 'var(--font-display)' }}
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
  plat: 'movie' | 'tv';
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
  );
}

// ── Desktop helper components ─────────────────────────────────────

function DesktopPlayerCard({
  meta,
  plat,
  children,
  showBackButton = false,
}: {
  meta: any;
  plat: string;
  children: React.ReactNode;
  showBackButton?: boolean;
}) {
  const displayTitle = meta?.title || meta?.name || '';
  const year = (meta?.release_date || meta?.first_air_date || '').slice(0, 4);
  const posterUrl = meta?.poster_path ? getImageUrl(meta.poster_path, 'w185') : null;

  return (
    <div className="relative aspect-video w-full max-w-2xl rounded-xl sm:rounded-2xl overflow-hidden bg-gradient-to-br from-[#16161A] via-[#0E0E11] to-[#070708] shadow-[0_8px_60px_rgba(0,0,0,0.8)] ring-1 ring-white/[0.08]">
      <div className="absolute inset-0 bg-gradient-radial from-[#D4A237]/[0.04] via-transparent to-transparent" />
      {showBackButton && (
        <div className="absolute top-3 left-3 z-20">
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/40 backdrop-blur-sm border border-white/[0.06] text-white/70 hover:text-white text-xs font-semibold transition-all hover:bg-black/60 hover:border-white/20 active:scale-95"
          >
            <ArrowLeft size={14} />
            Home
          </Link>
        </div>
      )}
      <div className="absolute inset-0 flex items-center gap-6 p-6 sm:p-8">
        <div className="flex-shrink-0 hidden sm:block">
          {posterUrl ? (
            <img
              src={posterUrl}
              alt={displayTitle}
              className="w-[100px] h-[150px] rounded-xl object-cover shadow-lg ring-1 ring-white/10"
            />
          ) : (
            <div className="w-[100px] h-[150px] rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
              <Film className="w-8 h-8 text-[#52525B]" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="mb-3">
            <h2 className="text-lg sm:text-xl font-bold text-[#F4F4F5] tracking-tight truncate">
              {displayTitle}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              {year && <span className="text-xs text-[#52525B] font-semibold">{year}</span>}
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#52525B] bg-white/[0.04] px-2 py-0.5 rounded">
                {plat}
              </span>
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function DesktopVideoPlayer({
  provider,
  meta,
  plat,
  onReopen,
}: {
  provider?: ProviderDefinition;
  meta: any;
  plat: string;
  onReopen: () => void;
}) {
  const [showLoader, setShowLoader] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShowLoader(false), 2000);
    return () => clearTimeout(t);
  }, []);

  return (
    <DesktopPlayerCard meta={meta} plat={plat} showBackButton>
      {showLoader ? (
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-12 h-12 rounded-2xl bg-[#D4A237]/10 border border-[#D4A237]/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-[#D4A237]/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </div>
            <div className="absolute -inset-2 rounded-2xl border-2 border-transparent border-t-[#D4A237]/30 animate-spin" style={{ animationDuration: '2s' }} />
          </div>
          <div>
            <p className="text-white/90 text-sm font-semibold tracking-wide">Opening secure player...</p>
            <p className="text-[#52525B] text-xs mt-0.5">{provider?.displayName || provider?.id}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <p className="text-green-400 text-sm font-semibold">Playing in secure player window</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#52525B] mb-3">
            <span className="flex items-center gap-1.5">{provider?.displayName || provider?.id}</span>
            <span className="hidden sm:inline">·</span>
            <span>All security layers active</span>
          </div>
          <button
            onClick={onReopen}
            className="mt-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white text-xs font-semibold transition-all active:scale-95"
          >
            Reopen player window
          </button>
        </>
      )}
    </DesktopPlayerCard>
  );
}

function DesktopVideoIdle({
  provider,
  meta,
  plat,
  onOpen,
}: {
  provider?: ProviderDefinition;
  meta: any;
  plat: string;
  onOpen: () => void;
}) {
  return (
    <DesktopPlayerCard meta={meta} plat={plat} showBackButton>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
          <svg className="w-5 h-5 text-[#A1A1AA]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
          </svg>
        </div>
        <div>
          <p className="text-white/80 text-sm font-semibold tracking-wide">Ready to start watching</p>
          <p className="text-[#52525B] text-xs mt-0.5">{provider?.displayName || provider?.id}</p>
        </div>
      </div>
      <button
        onClick={onOpen}
        className="px-5 py-2.5 rounded-xl bg-[#D4A237]/80 hover:bg-[#D4A237] text-[#070708] text-sm font-semibold transition-all active:scale-95 shadow-lg shadow-[#D4A237]/10 inline-flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
        Open Player
      </button>
    </DesktopPlayerCard>
  );
}
