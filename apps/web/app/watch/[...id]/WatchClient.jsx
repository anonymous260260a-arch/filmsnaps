"use client";
import React, { useState, useTransition, useRef, useCallback, useEffect } from "react";
import Link from 'next/link';
import {
  ChevronDown,
  RefreshCw,
  SkipForward,
  SkipBack,
  AlertCircle,
  X,
  Maximize,
  Minimize,
  ArrowLeft,
  Film,
} from "lucide-react";
import { getSeasonAction } from "@/lib/actions";
import { getEnabledProviders } from '@filmsnaps/shared';
import { getImageUrl } from '@/lib/tmdb';

/**
 * WatchClient — Cinematic Theater Mode
 * Mobile-first responsive design with easy touch targets.
 */
const WatchClient = ({ contentid, plat, initialMeta, initialSeasonData, defaultProvider, minimal = false, initialSeason: propSeason, initialEpisode: propEpisode }) => {
  const [isPending, startTransition] = useTransition();
  const [seasonData, setSeasonData] = useState(initialSeasonData);
  const [selectedSeason, setSelectedSeason] = useState(
    propSeason ?? initialMeta.seasons?.[0]?.season_number ?? 1,
  );
  const [activeEpisode, setActiveEpisode] = useState(propEpisode ?? 1);
  const [showNotice, setShowNotice] = useState(true);

  // ── Detect Electron desktop environment ──
  const isDesktop = typeof window !== 'undefined' && window.electronAPI?.isDesktop === true;

  // ── Providers sourced from the shared registry ──
  const providerConfigs = React.useMemo(() => getEnabledProviders(), []);
  const Providers = React.useMemo(
    () =>
      providerConfigs.map((p) => ({
        name: p.name,
        displayName: p.displayName || p.name,
        proxyKey: p.id,
        baseUrl: p.baseUrl,
        embed: p.embed,
      })),
    [providerConfigs],
  );

  // Use defaultProvider from URL if available, otherwise first provider
  const initialProvider = defaultProvider
    ? Providers.find((p) => p.proxyKey === defaultProvider) || Providers[0]
    : Providers[0];

  const [selectedProvider, setSelectedProvider] = useState(initialProvider);
  const [electronVideoOpen, setElectronVideoOpen] = useState(false);
  const playerContainerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const iframeRef = useRef(null);
  const [cpuWarning, setCpuWarning] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // incremented to reload iframe
  const activeProviderRef = useRef(null);

  // ── Electron: Open / re-open secure video window ─────
  // Opens when the provider changes (mount counts as first change).
  // The backend (video-window.ts) closeVideoWindow() is called at the
  // top of openVideoWindow(), so only one window is ever open.
  // Season/episode changes do NOT trigger a re-open — the user must
  // switch to a different server to replace the player.
  useEffect(() => {
    if (!isDesktop) return;

    const provider = providerConfigs.find(p => p.id === selectedProvider?.proxyKey);
    if (!provider || !provider.baseUrl || !provider.embed) return;

    // Only open when the provider key actually changes (skip on other dep changes)
    if (activeProviderRef.current === selectedProvider?.proxyKey) return;
    activeProviderRef.current = selectedProvider?.proxyKey ?? null;

    // Build the direct provider embed URL (not the proxied URL)
    let embedPath;
    try {
      if (plat === 'tv') {
        embedPath = provider.embed.tv(contentid, selectedSeason, activeEpisode);
      } else {
        embedPath = provider.embed.movie(contentid);
      }
    } catch (e) {
      console.error('[Desktop] Failed to build embed URL:', e);
      return;
    }

    const embedUrl = `${provider.baseUrl.replace(/\/+$/, '')}/${embedPath.replace(/^\/+/, '')}`;

    console.log('[Desktop] Opening secure video window:', embedUrl.substring(0, 80));
    window.electronAPI.openVideo({
      type: plat,
      id: contentid,
      season: plat === 'tv' ? selectedSeason : undefined,
      episode: plat === 'tv' ? activeEpisode : undefined,
      provider: provider.id,
      embedUrl,
    }).then((result) => {
      if (result.success) {
        setElectronVideoOpen(true);
      } else {
        console.error('[Desktop] Failed to open video window:', result.error);
      }
    });
  }, [isDesktop, selectedProvider]);

  // Listen for video window closed by user
  useEffect(() => {
    if (!isDesktop || !window.electronAPI) return;

    const handleClosed = () => setElectronVideoOpen(false);
    window.electronAPI.onVideoClosed(handleClosed);
    return () => window.electronAPI.removeVideoClosedListener();
  }, [isDesktop]);

  // Clean up video window on component unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        window.electronAPI.closeVideo();
        window.electronAPI.removeVideoClosedListener();
      }
    };
  }, []);

  // ── Parent-side navigation guard ──────────────────────────────
  // Blocks `top.location` escape from cross-origin iframes.
  //
  // Can't use `beforeunload` (user found it annoying on normal leave).
  // Instead, silently revert any URL changes via polling + popstate.
  // This is imperfect — if the iframe navigates the page, there's a
  // brief flicker before we restore the URL — but it avoids the dialog.
  //
  // For popups (`window.open` / `top.open`): see the Popup Guard below.
  useEffect(() => {
    const ORIGINAL_URL = window.location.href;

    // ── Poll for URL changes (catches top.location + history) ──
    const guardInterval = setInterval(() => {
      if (window.location.href !== ORIGINAL_URL) {
        console.warn('[NavGuard] URL changed — likely iframe escape attempt, reverting');
        window.history.pushState(null, '', ORIGINAL_URL);
      }
    }, 500);

    const onPopState = () => {
      if (window.location.href !== ORIGINAL_URL) {
        console.warn('[NavGuard] popState escape attempt — restoring');
        window.history.pushState(null, '', ORIGINAL_URL);
      }
    };
    window.addEventListener('popstate', onPopState);

    // ── Catch top.open / parent.open from iframe ──
    // If the provider does `top.open(url)` or `parent.open(url)`,
    // it goes through OUR window.open. We block it.
    const originalOpen = window.open.bind(window);
    window.open = function blockPopup(url, name, features) {
      if (url && typeof url === 'string') {
        console.warn('[NavGuard] Blocked popup attempt from provider:', url.slice(0, 120));
      }
      // Return null so the caller (inside iframe) gets null instead of a Window handle
      // This prevents the popup from opening at all
      return null;
    };

    return () => {
      window.removeEventListener('popstate', onPopState);
      clearInterval(guardInterval);
      window.open = originalOpen;
    };
  }, []);

  // ── End parent-side navigation guard ──────────────────────────

  // ── Popup guard ─────────────────────────────────────────────────
  // Cross-origin iframes can open popup tabs. We can't intercept
  // window.open from inside the iframe — but we CAN detect focus
  // loss and aggressively reclaim focus so the popup doesn't steal
  // the user away.
  //
  // Does NOT blank the iframe — the user wants to keep watching.
  useEffect(() => {
    let reclaimTimer = null;

    const startReclaim = () => {
      if (reclaimTimer) return; // already reclaiming
      console.warn('[PopupGuard] Popup detected — reclaiming focus');
      let attempts = 0;
      reclaimTimer = setInterval(() => {
        attempts++;
        if (document.hasFocus()) {
          clearInterval(reclaimTimer);
          reclaimTimer = null;
          return;
        }
        // Try multiple focus methods
        window.focus();
        // Open + close self window trick (helps with Chrome's popup guard)
        try {
          const w = window.open('', '_self');
          if (w) w.focus();
        } catch(_) {}
        if (attempts >= 300) {
          clearInterval(reclaimTimer);
          reclaimTimer = null;
        }
      }, 50); // check every 50ms for 15s
    };

    // Immediate reclamation on blur (no delay)
    window.addEventListener('blur', startReclaim);

    // Also catch when page becomes hidden (popup opened in background)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        startReclaim();
      }
    });

    return () => {
      window.removeEventListener('blur', startReclaim);
      document.removeEventListener('visibilitychange', startReclaim);
      if (reclaimTimer) {
        clearInterval(reclaimTimer);
        reclaimTimer = null;
      }
    };
  }, []);

  // ── End popup guard ─────────────────────────────────────────────

  // ── CPU / RAM abuse watchdog + session timeout ────────────────
  // Detects if the provider iframe is hogging the event loop via
  // measuring timer drift. If the main thread is busy (iframe
  // is using too much CPU), our setTimeout(0) callbacks will be
  // delayed significantly.
  //
  // Also auto-refreshes the iframe every 60 minutes to reset any
  // long-running abuse (crypto miners, memory leaks, tracker
  // accumulation) and prevent browser memory ballooning.
  useEffect(() => {
    const CPU_CHECK_MS = 3000;      // check every 3 seconds
    const CPU_WARN_MS = 300;        // lag > 300ms triggers warning
    const CPU_CONSECUTIVE_WARN = 3; // 3 bad checks in a row
    const SESSION_MAX_MS = 60 * 60 * 1000; // 60 min max

    let cpuBadCount = 0;
    let cpuGoodCount = 0;
    let cpuTimeout;
    let sessionTimeout;
    let alive = true;

    function checkCPU() {
      if (!alive) return;
      const expected = performance.now() + CPU_CHECK_MS;

      cpuTimeout = setTimeout(() => {
        if (!alive) return;
        const actual = performance.now();
        const lag = actual - expected;

        if (lag > CPU_WARN_MS) {
          cpuBadCount++;
          cpuGoodCount = 0;
          if (cpuBadCount >= CPU_CONSECUTIVE_WARN) {
            console.warn('[WatchClient] CPU abuse detected —', Math.round(lag), 'ms lag');
            setCpuWarning(true);
          }
        } else {
          cpuGoodCount++;
          if (cpuGoodCount >= 3) {
            cpuBadCount = 0;
            setCpuWarning(false);
          }
        }

        checkCPU();
      }, 0);
    }

    checkCPU();

    // Session timeout — force refresh after 60 minutes to kill miners
    sessionTimeout = setTimeout(() => {
      if (!alive) return;
      setRefreshKey((k) => k + 1);
      console.log('[WatchClient] Session timeout — refreshing iframe');
    }, SESSION_MAX_MS);

    return () => {
      alive = false;
      clearTimeout(cpuTimeout);
      clearTimeout(sessionTimeout);
    };
  }, []);

  // ── When CPU abuse detected: blank the iframe, alert the user ──
  // The iframe will stay blank for 15s, then auto-dismiss the warning.
  // User can switch providers or dismiss.
  useEffect(() => {
    if (!cpuWarning || !iframeRef.current) {
      return;
    }

    // Save and blank the iframe to reclaim CPU/RAM
    iframeRef.current.src = 'about:blank';
    console.warn('[WatchClient] Iframe blanked due to CPU abuse');

    // Auto-dismiss the warning after 15s
    const recovery = setTimeout(() => setCpuWarning(false), 15000);
    return () => clearTimeout(recovery);
  }, [cpuWarning]);

  // ── End CPU/RAM watchdog ──────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    if (!playerContainerRef.current) return;
    if (!document.fullscreenElement) {
      playerContainerRef.current.requestFullscreen().catch((err) => {
        console.error("[WatchClient] Fullscreen error:", err);
      });
    } else {
      document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const handleSeasonChange = async (e) => {
    const sNum = Number(e.target.value);
    setSelectedSeason(sNum);
    setActiveEpisode(1);
    startTransition(async () => {
      const data = await getSeasonAction(contentid, sNum);
      setSeasonData(data);
    });
  };

  // Build the embed URL using the provider's embed config
  const getEmbedUrl = () => {
    const config = getEnabledProviders().find(
      (p) => p.id === selectedProvider?.proxyKey,
    );
    if (!config) return "";

    if (plat === "tv") {
      return `/api/player/${config.id}?tvId=${contentid}&season=${selectedSeason}&episode=${activeEpisode}`;
    }
    return `/api/player/${config.id}?id=${contentid}`;
  };

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-400 font-sans antialiased">
      <main className={`max-w-6xl mx-auto px-3 sm:px-4 ${minimal ? 'min-h-screen flex flex-col justify-center py-0 sm:py-2' : 'py-4 sm:py-6 lg:py-12'}`}>
        {/* Header Area — hidden in minimal/embedded mode */}
        {!minimal && (
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 sm:gap-4 mb-6 sm:mb-8 px-1 sm:px-2">
            <div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-white tracking-tight leading-none mb-2">
                {initialMeta?.name || initialMeta?.title}
              </h1>
              <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600">
                <span className="text-zinc-100">{plat}</span>
                <span className="w-1 h-1 rounded-full bg-zinc-800" />
                <span>
                  {new Date(
                    initialMeta?.release_date || initialMeta?.first_air_date,
                  ).getFullYear()}
                </span>
                <span className="w-1 h-1 rounded-full bg-zinc-800" />
                <span className="text-green-500/80"> HDR</span>
              </div>
            </div>
          </div>
        )}

        {/* Provider Selector — hidden in minimal/embedded mode */}
        {!minimal && (
          <div className="relative group mb-4 sm:mb-6">
            <div className="absolute -top-2.5 left-4 px-2 bg-[#050505] text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 z-10 group-focus-within:text-white transition-colors">
              Server
            </div>
            <div className="relative flex items-center">
              <select
                value={selectedProvider?.name}
                onChange={(e) =>
                  setSelectedProvider(
                    Providers.find((p) => p.name === e.target.value),
                  )
                }
                aria-label="Select Provider"
                className="w-full bg-[#0c0c0c]/80 backdrop-blur hover:bg-[#121212] focus:bg-[#121212] transition-all border border-white/10 focus:border-white/30 text-zinc-100 text-sm font-bold py-4 px-5 rounded-2xl outline-none appearance-none cursor-pointer shadow-[0_8px_30px_rgba(0,0,0,0.4)] focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              >
                {Providers.map((p) => (
                  <option
                    key={p.name}
                    value={p.name}
                    className="bg-[#0c0c0c] text-white py-4"
                  >
                    {p.displayName}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="absolute right-5 text-zinc-500 group-hover:text-white transition-colors pointer-events-none"
                size={18}
              />
            </div>
          </div>
        )}

        {/* Dismissible Notice — hidden in minimal/embedded mode */}
        {!minimal && showNotice && (
          <div className="flex items-center gap-3 text-sm text-zinc-500 bg-white/[0.03] px-4 sm:px-5 py-3 rounded-xl border border-white/[0.05] mb-4 sm:mb-6 backdrop-blur-sm">
            <AlertCircle size={16} className="text-zinc-500 flex-shrink-0" />
            <p className="flex-1 text-xs sm:text-sm">
              If the video is stuck, try switching to a different server above.
            </p>
            <button
              onClick={() => setShowNotice(false)}
              className="text-zinc-600 hover:text-zinc-300 transition-colors p-1 flex-shrink-0"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* CPU Abuse Warning */}
        {cpuWarning && (
          <div className="flex items-center gap-3 text-sm text-red-400 bg-red-500/10 px-4 sm:px-5 py-3 rounded-xl border border-red-500/20 mb-4 sm:mb-6 backdrop-blur-sm">
            <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
            <p className="flex-1 text-xs sm:text-sm">
              This server is using too much CPU — it has been stopped.
              <span className="block mt-1 text-zinc-500">
                Switch to a different server above to continue watching.
              </span>
            </p>
            <button
              onClick={() => setCpuWarning(false)}
              className="text-zinc-600 hover:text-zinc-300 transition-colors p-1 flex-shrink-0"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )}


        {/* Video Player — Desktop (Electron) vs Web (iframe) */}
        {isDesktop && electronVideoOpen ? (
          <DesktopVideoPlayer
            provider={selectedProvider}
            meta={initialMeta}
            plat={plat}
            onReopen={() => {
              // Trigger re-open by toggling electronVideoOpen
              setElectronVideoOpen(false);
              // Re-trigger via the useEffect
              setTimeout(() => {
                const provider = providerConfigs.find(p => p.id === selectedProvider?.proxyKey);
                if (!provider) return;
                let embedPath;
                try {
                  if (plat === 'tv') {
                    embedPath = provider.embed.tv(contentid, selectedSeason, activeEpisode);
                  } else {
                    embedPath = provider.embed.movie(contentid);
                  }
                } catch(e) { return; }
                const embedUrl = `${provider.baseUrl.replace(/\/+$/, '')}/${embedPath.replace(/^\/+/, '')}`;
                window.electronAPI?.openVideo({ type: plat, id: contentid, provider: provider.id, embedUrl })
                  .then(r => { if (r.success) setElectronVideoOpen(true); });
              }, 100);
            }}
          />
        ) : isDesktop && !electronVideoOpen ? (
          <DesktopVideoIdle
            provider={selectedProvider}
            meta={initialMeta}
            plat={plat}
            onOpen={() => {
              const provider = providerConfigs.find(p => p.id === selectedProvider?.proxyKey);
              if (!provider) return;
              let embedPath;
              try {
                if (plat === 'tv') {
                  embedPath = provider.embed.tv(contentid, selectedSeason, activeEpisode);
                } else {
                  embedPath = provider.embed.movie(contentid);
                }
              } catch(e) { return; }
              const embedUrl = `${provider.baseUrl.replace(/\/+$/, '')}/${embedPath.replace(/^\/+/, '')}`;
              window.electronAPI?.openVideo({ type: plat, id: contentid, provider: provider.id, embedUrl })
                .then(r => { if (r.success) setElectronVideoOpen(true); });
            }}
          />
        ) : (
          <div
            ref={playerContainerRef}
            className="relative aspect-video w-full rounded-xl sm:rounded-2xl overflow-hidden bg-zinc-900 shadow-[0_8px_60px_rgba(0,0,0,0.8)] ring-1 ring-white/[0.08] group/player"
          >
            {/* Ambient glow */}
            <div className="absolute -inset-4 bg-gradient-radial from-primary/5 via-transparent to-transparent opacity-60 pointer-events-none z-0" />
            <iframe
              ref={iframeRef}
              className="absolute inset-0 w-full h-full z-10"
              src={getEmbedUrl()}
              key={`provider-${refreshKey}`}
              referrerPolicy="no-referrer"
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
              title="Video player"
            />

            {isPending && (
              <div className="absolute inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-50">
                <RefreshCw className="animate-spin text-white" size={32} />
              </div>
            )}

            {/* Fullscreen button — appears on hover */}
            <button
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              className="absolute bottom-3 right-3 z-20 flex items-center gap-2 px-3 py-2 rounded-lg
                bg-black/60 backdrop-blur-sm border border-white/10
                text-white/80 hover:text-white hover:bg-black/80
                opacity-0 group-hover/player:opacity-100
                transition-all duration-200
                text-xs font-semibold tracking-wide
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              {isFullscreen ? (
                <Minimize size={16} />
              ) : (
                <Maximize size={16} />
              )}
              <span className="hidden sm:inline">{isFullscreen ? "Exit" : ""}</span>
            </button>
          </div>
        )}

        {plat === "tv" && !minimal && (
          <>
            {/* Season & Episode Selectors — stacked on mobile, side-by-side on desktop */}
            <div className="mt-6 sm:mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              {/* Season Selector */}
              <div className="relative group">
                <div className="absolute -top-2.5 left-4 px-2 bg-[#050505] text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 z-10 group-focus-within:text-white transition-colors">
                  Collection
                </div>
                <div className="relative flex items-center">
                  <select
                    value={selectedSeason}
                    onChange={handleSeasonChange}
                    aria-label="Select Season"
                    className="w-full bg-[#0c0c0c]/80 backdrop-blur hover:bg-[#121212] focus:bg-[#121212] transition-all border border-white/10 focus:border-white/30 text-zinc-100 text-sm font-bold py-4 px-5 rounded-2xl outline-none appearance-none cursor-pointer shadow-[0_8px_30px_rgba(0,0,0,0.4)] focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-black min-h-[56px]"
                  >
                    {initialMeta?.seasons?.map((s) => (
                      <option
                        key={s.id}
                        value={s.season_number}
                        className="bg-[#0c0c0c] text-white py-4"
                      >
                        Season{" "}
                        {s.season_number < 10
                          ? `0${s.season_number}`
                          : s.season_number}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className="absolute right-5 text-zinc-500 group-hover:text-white transition-colors pointer-events-none"
                    size={18}
                  />
                </div>
              </div>

              {/* Episode Selector */}
              <div className="relative group">
                <div className="absolute -top-2.5 left-4 px-2 bg-[#050505] text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500 z-10 group-focus-within:text-white transition-colors">
                  Episode
                </div>
                <div className="relative flex items-center">
                  <select
                    value={activeEpisode}
                    onChange={(e) => setActiveEpisode(Number(e.target.value))}
                    aria-label="Select Episode"
                    className="w-full bg-[#0c0c0c]/80 backdrop-blur hover:bg-[#121212] focus:bg-[#121212] transition-all border border-white/10 focus:border-white/30 text-zinc-100 text-sm font-bold py-5 px-6 rounded-2xl outline-none appearance-none cursor-pointer truncate pr-14 shadow-[0_8px_30px_rgba(0,0,0,0.4)] focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-black min-h-[56px]"
                  >
                    {seasonData?.episodes?.map((ep) => (
                      <option
                        key={ep.id}
                        value={ep.episode_number}
                        className="bg-[#0c0c0c] text-white py-4"
                      >
                        {ep.episode_number < 10
                          ? `0${ep.episode_number}`
                          : ep.episode_number}{" "}
                        — {ep.name.slice(0, 40)}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-5 flex items-center gap-2 border-l border-white/10 pl-4">
                    <ChevronDown
                      className="text-zinc-500 group-hover:text-white transition-colors pointer-events-none"
                      size={18}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Now Watching & Navigation — responsive */}
            <div className="mt-8 sm:mt-12 flex flex-col sm:flex-row items-start sm:items-center justify-between border-t border-white/5 pt-6 sm:pt-10 gap-5 sm:gap-6">
              <div className="flex flex-row items-center gap-4 sm:gap-8 w-full sm:w-auto">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                  <p className="text-[9px] font-black uppercase text-zinc-600 tracking-widest">
                    Now Watching
                  </p>
                </div>
                <h2 className="text-sm font-bold text-white tracking-tight">
                  S{selectedSeason < 10 ? `0${selectedSeason}` : selectedSeason}{" "}
                  : E{activeEpisode < 10 ? `0${activeEpisode}` : activeEpisode}
                </h2>
                <div className="hidden lg:block space-y-1 max-w-[250px]">
                  <p className="text-[9px] font-black uppercase text-zinc-600 tracking-widest">
                    Chapter Title
                  </p>
                  <h2 className="text-sm font-medium text-zinc-400 italic truncate">
                    {
                      seasonData?.episodes?.find(
                        (e) => e.episode_number === activeEpisode,
                      )?.name
                    }
                  </h2>
                </div>
              </div>

              {/* Episode Navigation Buttons — larger touch targets on mobile */}
              <div className="flex items-center gap-3 sm:gap-3 w-full sm:w-auto">
                <button
                  title="Previous Episode"
                  disabled={activeEpisode === 1}
                  onClick={() => setActiveEpisode((prev) => prev - 1)}
                  className="flex-1 sm:flex-initial h-12 sm:w-12 flex items-center justify-center gap-2 sm:gap-0 rounded-2xl bg-[#0c0c0c] border border-white/5 text-zinc-500 hover:text-white hover:border-white/20 disabled:opacity-20 transition-all active:scale-90 px-4 sm:px-0"
                >
                  <SkipBack size={18} fill="currentColor" />
                  <span className="text-xs text-zinc-500 sm:hidden">Previous</span>
                </button>
                <button
                  title="Next Episode"
                  disabled={activeEpisode === seasonData?.episodes?.length}
                  onClick={() => setActiveEpisode((prev) => prev + 1)}
                  className="flex-1 sm:flex-initial h-12 sm:w-12 flex items-center justify-center gap-2 sm:gap-0 rounded-2xl bg-white text-black hover:bg-zinc-200 disabled:opacity-20 transition-all active:scale-90 shadow-xl shadow-white/5 px-4 sm:px-0"
                >
                  <span className="text-xs text-black sm:hidden">Next</span>
                  <SkipForward size={18} fill="currentColor" />
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

// ── Desktop: Shared player card with poster, title, and Back to Home ──
function DesktopPlayerCard({ meta, plat, children, showBackButton = false }) {
  const displayTitle = meta?.title || meta?.name || '';
  const year = (meta?.release_date || meta?.first_air_date || '').slice(0, 4);
  const posterUrl = meta?.poster_path ? getImageUrl(meta.poster_path, 'w185') : null;

  return (
    <div className="relative aspect-video w-full rounded-xl sm:rounded-2xl overflow-hidden bg-gradient-to-br from-[#0f0f1a] via-[#0a0a12] to-[#050510] shadow-[0_8px_60px_rgba(0,0,0,0.8)] ring-1 ring-white/[0.08]">
      {/* Cinematic gradient glow */}
      <div className="absolute inset-0 bg-gradient-radial from-primary/[0.04] via-transparent to-transparent" />

      {/* Back to Home button */}
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

      {/* Content row: poster + info/controls */}
      <div className="absolute inset-0 flex items-center gap-6 p-6 sm:p-8">
        {/* Poster thumbnail (hidden on small screens) */}
        <div className="flex-shrink-0 hidden sm:block">
          {posterUrl ? (
            <img
              src={posterUrl}
              alt={displayTitle}
              className="w-[100px] h-[150px] rounded-xl object-cover shadow-lg ring-1 ring-white/10"
            />
          ) : (
            <div className="w-[100px] h-[150px] rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
              <Film className="w-8 h-8 text-zinc-600" />
            </div>
          )}
        </div>

        {/* Info + status + controls */}
        <div className="flex-1 min-w-0">
          {/* Title & metadata */}
          <div className="mb-3">
            <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight truncate">
              {displayTitle}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              {year && (
                <span className="text-xs text-zinc-500 font-semibold">{year}</span>
              )}
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 bg-white/[0.04] px-2 py-0.5 rounded">
                {plat}
              </span>
            </div>
          </div>
          {children}
        </div>
      </div>

      {/* Mobile: compact info overlay at bottom */}
      <div className="sm:hidden absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
        <h3 className="text-sm font-bold text-white truncate">{displayTitle}</h3>
        <div className="flex items-center gap-2 mt-0.5">
          {year && <span className="text-xs text-zinc-400">{year}</span>}
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{plat}</span>
        </div>
      </div>
    </div>
  );
}

// ── Desktop: Video playing in Electron window ──
function DesktopVideoPlayer({ provider, meta, plat, onReopen }) {
  const [showLoader, setShowLoader] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setShowLoader(false), 2000);
    return () => clearTimeout(t);
  }, []);

  return (
    <DesktopPlayerCard meta={meta} plat={plat} showBackButton>
      {showLoader ? (
        <div className="flex items-center gap-3">
          {/* Animated shield icon */}
          <div className="relative">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-primary/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </div>
            {/* Spinning ring */}
            <div className="absolute -inset-2 rounded-2xl border-2 border-transparent border-t-primary/30 animate-spin" style={{ animationDuration: '2s' }} />
          </div>
          <div>
            <p className="text-white/90 text-sm font-semibold tracking-wide">
              Opening secure player...
            </p>
            <p className="text-zinc-500 text-xs mt-0.5">
              {provider?.displayName || provider?.proxyKey}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Active playback status */}
          <div className="flex items-center gap-2 mb-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <p className="text-green-400 text-sm font-semibold">
              Playing in secure player window
            </p>
          </div>

          {/* Provider & security info */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 mb-3">
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
              </svg>
              {provider?.displayName || provider?.proxyKey}
            </span>
            <span className="text-zinc-600 hidden sm:inline">·</span>
            <span className="text-zinc-500">All 6 security layers active</span>
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

// ── Desktop: Idle state (video not yet opened) ──
function DesktopVideoIdle({ provider, meta, plat, onOpen }) {
  return (
    <DesktopPlayerCard meta={meta} plat={plat} showBackButton>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
          <svg className="w-5 h-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
          </svg>
        </div>
        <div>
          <p className="text-white/80 text-sm font-semibold tracking-wide">
            Ready to start watching
          </p>
          <p className="text-zinc-500 text-xs mt-0.5">
            {provider?.displayName || provider?.proxyKey}
          </p>
        </div>
      </div>

      <button
        onClick={onOpen}
        className="px-5 py-2.5 rounded-xl bg-primary/80 hover:bg-primary text-white text-sm font-semibold transition-all active:scale-95 shadow-lg shadow-primary/10 inline-flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
        Open Player
      </button>
    </DesktopPlayerCard>
  );
}

export default WatchClient;
