"use client";

import React, { useCallback, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ListVideo,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  GripVertical,
  Menu,
} from "lucide-react";
import { usePlayer } from "@/components/player/PlayerProvider";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useWatchKeyboardShortcuts } from "@/hooks/useWatchKeyboardShortcuts";
import {
  setWatchContext,
  setImmersive,
  toggleWatchNavDrawer,
} from "@/components/desktop/chrome-store";
import { VideoZone } from "./VideoZone";
import { EpisodeSidebar } from "@/components/player/EpisodeSidebar";
import { MetadataPanel } from "./MetadataPanel";
import { RelatedPanel } from "./RelatedPanel";
import { ServerDropdown } from "./ServerDropdown";
import { AudioToggle } from "@/components/player/AudioToggle";
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

const DEFAULT_SIDEBAR_WIDTH = 340;
const MIN_SIDEBAR_WIDTH = 260;
const MAX_SIDEBAR_WIDTH = 540;

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
  const { isFullscreen, goToNextEpisode, goToPrevEpisode, audio, setAudio } =
    usePlayer();

  const handleBack = useCallback(() => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  }, [router]);

  const [isServerOpen, setIsServerOpen] = useState(false);
  const toggleServer = useCallback(() => setIsServerOpen((prev) => !prev), []);
  const closeServer = useCallback(() => setIsServerOpen(false), []);

  // ── Collapsible Sidebar & Resizable Width (YouTube inspired) ──
  // Movies default to theater mode (right panel hidden) per design; TV honors
  // the persisted collapse preference.
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return plat === "movie";
    try {
      if (plat === "movie") return true;
      return (
        localStorage.getItem("filmsnaps_watch_sidebar_collapsed") === "true"
      );
    } catch {
      return plat === "movie";
    }
  });

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_SIDEBAR_WIDTH;
    try {
      const saved = localStorage.getItem("filmsnaps_watch_sidebar_width");
      return saved
        ? Math.min(
            MAX_SIDEBAR_WIDTH,
            Math.max(MIN_SIDEBAR_WIDTH, parseInt(saved, 10)),
          )
        : DEFAULT_SIDEBAR_WIDTH;
    } catch {
      return DEFAULT_SIDEBAR_WIDTH;
    }
  });

  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      // Only TV persists its episode-panel collapse (movie theater state is
      // ephemeral per-session, so it never bleeds into the TV preference).
      if (plat === "tv") {
        try {
          localStorage.setItem(
            "filmsnaps_watch_sidebar_collapsed",
            String(next),
          );
        } catch {}
      }
      return next;
    });
  }, [plat]);

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    setIsDragging(true);

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const newWidth = window.innerWidth - moveEvent.clientX - 24; // offset margin
      if (newWidth >= MIN_SIDEBAR_WIDTH && newWidth <= MAX_SIDEBAR_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const onPointerUp = () => {
      isDraggingRef.current = false;
      setIsDragging(false);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      try {
        setSidebarWidth((w) => {
          localStorage.setItem("filmsnaps_watch_sidebar_width", String(w));
          return w;
        });
      } catch {}
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, []);

  // Keyboard shortcut 'e' to toggle episodes sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable
      )
        return;
      if (e.key.toLowerCase() === "e") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar, plat]);

  useWatchKeyboardShortcuts({
    isDesktop: isDesktopVp,
    isServerOpen,
    onServerToggle: toggleServer,
    onGoBack: handleBack,
  });

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

  useEffect(() => {
    setImmersive(isFullscreen);
    return () => setImmersive(false);
  }, [isFullscreen]);

  const episodes = seasonData?.episodes ?? [];
  const totalEpisodes = episodes.length;
  const isFirstEpisode = activeEpisode <= 1;
  const isLastEpisode = activeEpisode >= totalEpisodes && totalEpisodes > 0;

  return (
    <>
      {/* Film grain */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] bg-[url('/noise.svg')] mix-blend-overlay z-0" />

      {/* Main Container — pt-6 breathing room from the GlobalTopBar (the CSS
          reset that was zeroing nested mains is scoped to the shell's own main) */}
      <main
        className={`h-[calc(100vh-48px)] overflow-hidden pt-6 pb-3 px-4 lg:px-6 max-w-[1900px] mx-auto flex flex-col ${isDragging ? "select-none" : ""}`}
      >
        {/* ── Top Controls Bar ── */}
        <div className="shrink-0 mb-2 flex items-center justify-between gap-3">
          {/* ── LEFT: Menu + Source Picker (or Title on web) ── */}
          <div className="flex items-center gap-2 min-w-0">
            {/* Hamburger menu button (opens YouTube-style nav overlay) */}
            {isElectron && (
              <button
                onClick={() => toggleWatchNavDrawer()}
                className="flex items-center justify-center w-8 h-8 rounded-xl bg-white/[0.04] border border-white/[0.08] text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-all active:scale-95 shrink-0"
                title="Open navigation menu"
                aria-label="Open menu"
              >
                <Menu size={16} />
              </button>
            )}

            {/* Source server pill — always on left */}
            <div className="relative">
              <button
                onClick={toggleServer}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border transition-all active:scale-[0.97] text-left ${
                  isServerOpen
                    ? "bg-[#D4A237]/15 border-[#D4A237]/40"
                    : "bg-white/[0.04] border-white/[0.08] hover:border-white/20 hover:bg-white/[0.06]"
                }`}
                aria-label="Select source server"
                title="Select server (S)"
              >
                <div className="min-w-0">
                  <p className="text-[8px] font-black uppercase tracking-wider text-zinc-500 leading-none">
                    Server
                  </p>
                  <p className="text-xs font-bold text-zinc-200 truncate leading-tight mt-0.5 max-w-[110px]">
                    {currentProvider?.displayName ||
                      currentProvider?.name ||
                      "Auto"}
                  </p>
                </div>
                <ChevronRight
                  size={13}
                  className={`text-zinc-400 shrink-0 transition-transform ${isServerOpen ? "rotate-90 text-white" : ""}`}
                />
              </button>

              {/* Server dropdown anchored here in the top bar */}
              <ServerDropdown
                providers={providers}
                selectedId={selectedProviderId}
                onSelect={onProviderSelect}
                isOpen={isServerOpen}
                onClose={closeServer}
              />
            </div>

            {/* Title — only on web (not electron, since GlobalTopBar shows it) */}
            {!isElectron && (
              <div className="min-w-0 ml-1">
                <h1
                  className="text-base sm:text-lg font-bold text-foreground truncate leading-tight"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {watchTitle}
                </h1>
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mt-0.5">
                  <span className="text-[#D4A237]">
                    {plat === "tv" ? "Series" : "Film"}
                  </span>
                  <span className="w-1 h-1 rounded-full bg-zinc-700" />
                  <span>{watchYear}</span>
                  {plat === "tv" && (
                    <>
                      <span className="w-1 h-1 rounded-full bg-zinc-700" />
                      <span className="text-zinc-400">
                        S
                        {selectedSeason < 10
                          ? `0${selectedSeason}`
                          : selectedSeason}
                        :E
                        {activeEpisode < 10
                          ? `0${activeEpisode}`
                          : activeEpisode}
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT: Episode controls + Theater toggle ── */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Prev / Next quick controls (theater mode or always for TV) */}
            {plat === "tv" && (
              <div className="flex items-center gap-1 bg-[#0E0E12] border border-white/[0.08] rounded-xl p-1 shadow-sm">
                <button
                  onClick={goToPrevEpisode}
                  disabled={isFirstEpisode}
                  title="Previous Episode (P)"
                  className="flex items-center justify-center w-7 h-7 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] disabled:opacity-30 disabled:pointer-events-none transition-all active:scale-95"
                >
                  <ChevronLeft size={15} />
                </button>
                <span className="text-[11px] font-bold text-[#D4A237] px-1 font-mono whitespace-nowrap">
                  E{activeEpisode < 10 ? `0${activeEpisode}` : activeEpisode}
                  <span className="text-zinc-600">
                    {" "}
                    / {totalEpisodes || "?"}
                  </span>
                </span>
                <button
                  onClick={goToNextEpisode}
                  disabled={isLastEpisode}
                  title="Next Episode (N)"
                  className="flex items-center justify-center w-7 h-7 rounded-lg bg-[#D4A237] text-[#070708] font-bold hover:bg-[#B88B2A] disabled:opacity-30 disabled:pointer-events-none transition-all active:scale-95 shadow-sm shadow-[#D4A237]/20"
                >
                  <ChevronRight size={15} />
                </button>
                {/* Dub/Sub — MegaPlay-style anime providers only */}
                {currentProvider?.animeOnly && (
                  <AudioToggle
                    audio={audio}
                    onAudioChange={setAudio}
                    className="ml-0.5"
                  />
                )}
              </div>
            )}

            {/* Theater toggle — TV shows episodes / movies show Overview */}
            <button
              onClick={toggleSidebar}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all active:scale-95 ${
                isSidebarCollapsed
                  ? "bg-[#D4A237]/10 border-[#D4A237]/40 text-[#D4A237] hover:bg-[#D4A237]/20"
                  : "bg-white/[0.04] border-white/[0.08] text-zinc-300 hover:bg-white/[0.08] hover:text-white"
              }`}
              title={isSidebarCollapsed ? "Show Panel (E)" : "Theater Mode (E)"}
            >
              <ListVideo size={14} />
              <span>{isSidebarCollapsed ? "Panel" : "Theater"}</span>
            </button>
          </div>
        </div>

        {/* ── Flex row: Video Zone + Draggable Divider + Sidebar ── */}
        <div className="flex-1 min-h-0 flex items-stretch gap-0 overflow-hidden relative">
          {/* ── Video Area ── */}
          <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-black/40 rounded-2xl">
            <VideoZone
              embedUrl={embedUrl}
              playerKey={playerKey}
              fit="grid"
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
              animeChain={animeChain}
            />
          </div>

          {/* ── Draggable Resize Divider (when sidebar is open) ── */}
          {plat === "tv" && !isSidebarCollapsed && (
            <div
              onPointerDown={handleResizeStart}
              className={`group/divider relative w-3 shrink-0 flex items-center justify-center cursor-col-resize z-20 select-none transition-colors ${
                isDragging ? "bg-[#D4A237]/20" : "hover:bg-white/[0.04]"
              }`}
              title="Drag to resize sidebar"
            >
              <div
                className={`w-1 h-12 rounded-full transition-colors ${
                  isDragging
                    ? "bg-[#D4A237]"
                    : "bg-white/10 group-hover/divider:bg-[#D4A237]/60"
                }`}
              />
            </div>
          )}

          {/* ── Right Column: Episode Sidebar (TV) or Overview (Movie) ──
              Gated by the theater toggle — collapsed = theater (no panel). */}
          {plat === "tv"
            ? !isSidebarCollapsed && (
                <div
                  style={{ width: `${sidebarWidth}px` }}
                  className="shrink-0 flex flex-col h-full min-h-0 transition-[width] duration-75"
                >
                  <EpisodeSidebar
                    seasonData={seasonData}
                    seasons={initialMeta?.seasons}
                    onSeasonChange={onSeasonChange}
                    title={watchTitle}
                    onClose={toggleSidebar}
                  />
                </div>
              )
            : !isSidebarCollapsed && (
                <div className="w-96 shrink-0 ml-4 flex flex-col h-full min-h-0 overflow-y-auto bg-[#0E0E12] rounded-2xl border border-white/[0.08] p-4 shadow-2xl">
                  <MetadataPanel initialMeta={initialMeta} plat={plat} />
                  <div className="mt-4 pt-4 border-t border-white/[0.06]">
                    <RelatedPanel
                      contentid={contentid}
                      initialMeta={initialMeta}
                    />
                  </div>
                </div>
              )}
        </div>
      </main>
    </>
  );
}
