/**
 * WatchClient — composed video player.
 *
 * Coordinates: PlayerProvider, SecureIframe, ServerPickerSheet,
 * EpisodeRail, PlayerControlOverlay, and Electron integration.
 *
 * Much smaller than the original 869-line WatchClient — state
 * management and security guards have been extracted into
 * the player component tree.
 */

'use client';

import React, { useTransition, useRef, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, X, Film, ArrowLeft } from 'lucide-react';
import { getSeasonAction } from '@/lib/actions';
import { getEnabledProviders } from '@filmsnaps/shared';
import { getImageUrl } from '@/lib/tmdb';
import { PlayerProvider, usePlayer } from '@/components/player/PlayerProvider';
import { SecureIframe } from '@/components/player/SecureIframe';
import { ServerPickerSheet } from '@/components/player/ServerPickerSheet';
import { EpisodeRail } from '@/components/player/EpisodeRail';
import { PlayerControlOverlay } from '@/components/player/PlayerControlOverlay';
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

// ── Embed URL builder ─────────────────────────────────────────────

function buildEmbedUrl(
  provider: ProviderDefinition,
  contentid: string,
  plat: 'movie' | 'tv',
  selectedSeason: number,
  activeEpisode: number,
): string {
  // Nxsha/chillflix: load directly (Cloudflare providers work best this way)
  if (provider.id === 'nxsha' || provider.id === 'chillflix') {
    const embedPath =
      plat === 'tv'
        ? provider.embed.tv(contentid, selectedSeason, activeEpisode)
        : provider.embed.movie(contentid);
    return `${provider.baseUrl}${embedPath}`;
  }

  if (plat === 'tv') {
    return `/api/player/${provider.id}?tvId=${contentid}&season=${selectedSeason}&episode=${activeEpisode}`;
  }
  return `/api/player/${provider.id}?id=${contentid}`;
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
  const [showNotice, setShowNotice] = useState(true);
  const [electronVideoOpen, setElectronVideoOpen] = useState(false);
  const playerContainerRef = useRef<HTMLDivElement>(null);

  const {
    selectedProviderId,
    setSelectedProvider,
    selectedSeason,
    activeEpisode,
    setActiveEpisode,
    setSelectedSeason,
    refreshKey,
    cpuWarning,
    mediaType,
    contentId,
  } = usePlayer();

  const providers = useMemo(() => getEnabledProviders(), []);

  // Resolve current provider object
  const currentProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId) ?? providers[0],
    [providers, selectedProviderId],
  );

  // ── Desktop Electron integration ──
  const isDesktop = typeof window !== 'undefined' && (window as any).electronAPI?.isDesktop === true;
  const activeProviderRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isDesktop) return;
    if (!currentProvider || !currentProvider.baseUrl) return;
    if (activeProviderRef.current === currentProvider.id) return;
    activeProviderRef.current = currentProvider.id;

    const embedUrl = buildEmbedUrl(currentProvider, contentid, plat, selectedSeason, activeEpisode);
    (window as any).electronAPI?.openVideo({
      type: plat,
      id: contentid,
      season: plat === 'tv' ? selectedSeason : undefined,
      episode: plat === 'tv' ? activeEpisode : undefined,
      provider: currentProvider.id,
      embedUrl,
    }).then((result: any) => {
      if (result?.success) setElectronVideoOpen(true);
    });
  }, [isDesktop, currentProvider]);

  useEffect(() => {
    if (!isDesktop || !(window as any).electronAPI) return;
    const handleClosed = () => setElectronVideoOpen(false);
    (window as any).electronAPI.onVideoClosed?.(handleClosed);
    return () => (window as any).electronAPI?.removeVideoClosedListener?.();
  }, [isDesktop]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && (window as any).electronAPI) {
        (window as any).electronAPI.closeVideo?.();
        (window as any).electronAPI.removeVideoClosedListener?.();
      }
    };
  }, []);

  // ── Season change handler ──
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

  // ── Provider selection handler ──
  const handleProviderSelect = useCallback(
    (provider: ProviderDefinition) => {
      setSelectedProvider(provider.id);
    },
    [setSelectedProvider],
  );

  // ── Embed URL (for the iframe) ──
  const embedUrl = currentProvider
    ? buildEmbedUrl(currentProvider, contentid, plat, selectedSeason, activeEpisode)
    : '';

  // ── Re-open Electron player ──
  const reopenElectronPlayer = useCallback(() => {
    if (!currentProvider) return;
    setElectronVideoOpen(false);
    setTimeout(() => {
      const embedUrl = buildEmbedUrl(currentProvider, contentid, plat, selectedSeason, activeEpisode);
      (window as any).electronAPI?.openVideo({
        type: plat, id: contentid, provider: currentProvider.id, embedUrl,
      }).then((r: any) => {
        if (r?.success) setElectronVideoOpen(true);
      });
    }, 100);
  }, [currentProvider, contentid, plat, selectedSeason, activeEpisode]);

  const openElectronPlayer = useCallback(() => {
    if (!currentProvider) return;
    const embedUrl = buildEmbedUrl(currentProvider, contentid, plat, selectedSeason, activeEpisode);
    (window as any).electronAPI?.openVideo({
      type: plat, id: contentid, provider: currentProvider.id, embedUrl,
    }).then((r: any) => {
      if (r?.success) setElectronVideoOpen(true);
    });
  }, [currentProvider, contentid, plat, selectedSeason, activeEpisode]);

  const displayTitle = initialMeta?.name || initialMeta?.title || '';
  const year = (initialMeta?.release_date || initialMeta?.first_air_date || '').slice(0, 4);

  return (
    <div className="min-h-screen bg-[#070708] text-[#A1A1AA]">
      <main
        className={`max-w-6xl mx-auto px-3 sm:px-4 ${
          minimal
            ? 'min-h-screen flex flex-col justify-center py-0 sm:py-2'
            : 'py-4 sm:py-6 lg:py-12'
        }`}
      >
        {/* ── Header Area ── */}
        {!minimal && (
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 sm:gap-4 mb-6 sm:mb-8 px-1 sm:px-2">
            <div>
              <h1
                className="text-xl sm:text-2xl md:text-3xl font-bold text-[#F4F4F5] tracking-tight leading-none mb-2"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {displayTitle}
              </h1>
              <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] text-[#52525B]">
                <span className="text-[#F4F4F5]/80">{plat}</span>
                <span className="w-1 h-1 rounded-full bg-[#222226]" />
                <span>{year}</span>
              </div>
            </div>
          </div>
        )}

        {/* ── Server Picker ── */}
        {!minimal && (
          <ServerPickerSheet
            onSelect={handleProviderSelect}
            selectedId={selectedProviderId}
          />
        )}

        {/* ── Dismissible Notice ── */}
        {!minimal && showNotice && (
          <div className="flex items-center gap-3 text-sm bg-white/[0.03] px-4 sm:px-5 py-3 rounded-xl border border-white/[0.05] mb-4 sm:mb-6 backdrop-blur-sm">
            <AlertCircle size={16} className="text-[#A1A1AA] flex-shrink-0" />
            <p className="flex-1 text-xs sm:text-sm text-[#A1A1AA]">
              If the video is stuck, try switching to a different server above.
            </p>
            <button
              onClick={() => setShowNotice(false)}
              className="text-[#52525B] hover:text-[#F4F4F5] transition-colors p-1 flex-shrink-0"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* ── Video Player ── */}
        {isDesktop && electronVideoOpen ? (
          <DesktopVideoPlayer
            provider={currentProvider}
            meta={initialMeta}
            plat={plat}
            onReopen={reopenElectronPlayer}
          />
        ) : isDesktop && !electronVideoOpen ? (
          <DesktopVideoIdle
            provider={currentProvider}
            meta={initialMeta}
            plat={plat}
            onOpen={openElectronPlayer}
          />
        ) : (
          <div
            ref={playerContainerRef}
            className="relative aspect-video w-full rounded-xl sm:rounded-2xl overflow-hidden bg-[#0E0E11] shadow-[0_8px_60px_rgba(0,0,0,0.8)] ring-1 ring-white/[0.08] group/player"
          >
            {/* Ambient glow */}
            <div className="absolute -inset-4 bg-gradient-radial from-[#D4A237]/5 via-transparent to-transparent opacity-60 pointer-events-none z-0" />

            {/* CPU Warning — blank the iframe */}
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

            {/* The iframe */}
            {!cpuWarning && embedUrl && (
              <SecureIframe
                src={embedUrl}
                key={`provider-${refreshKey}`}
              />
            )}

            {/* Loading overlay */}
            <PlayerControlOverlay isPending={isPending} />
          </div>
        )}

        {/* ── Episode Rail (TV only) ── */}
        <EpisodeRail
          seasonData={seasonData}
          seasons={initialMeta?.seasons}
          onSeasonChange={handleSeasonChange}
        />
      </main>
    </div>
  );
}

// ── Main WatchClient — wraps content in PlayerProvider ────────────

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
    <div className="relative aspect-video w-full rounded-xl sm:rounded-2xl overflow-hidden bg-gradient-to-br from-[#16161A] via-[#0E0E11] to-[#070708] shadow-[0_8px_60px_rgba(0,0,0,0.8)] ring-1 ring-white/[0.08]">
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

      <div className="sm:hidden absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
        <h3 className="text-sm font-bold text-[#F4F4F5] truncate">{displayTitle}</h3>
        <div className="flex items-center gap-2 mt-0.5">
          {year && <span className="text-xs text-[#A1A1AA]">{year}</span>}
          <span className="text-[10px] font-black uppercase tracking-widest text-[#52525B]">{plat}</span>
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
            <span className="text-[#52525B] hidden sm:inline">·</span>
            <span className="text-[#52525B]">All security layers active</span>
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
