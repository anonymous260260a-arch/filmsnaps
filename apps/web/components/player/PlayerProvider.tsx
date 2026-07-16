/**
 * PlayerProvider — React Context for stable player state.
 *
 * Holds provider selection, episode state, and player status.
 * RAPIDLY-changing state (currentTime, duration) lives in useRef
 * NOT in this context — every progress tick would re-render
 * the entire SecureIframe/WebView tree otherwise.
 */

'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';

export interface PlayerProviderState {
  /** Currently selected provider id */
  selectedProviderId: string | null;
  /** TV-specific: current season number */
  selectedSeason: number;
  /** TV-specific: current episode number */
  activeEpisode: number;
  /** Whether the player is in fullscreen */
  isFullscreen: boolean;
  /** Whether CPU abuse was detected */
  cpuWarning: boolean;
  /** Whether the iframe failed to load (timeout / error) */
  iframeLoadError: boolean;
  /** Incremented to force iframe refresh */
  refreshKey: number;
  /** Media type: 'movie' or 'tv' */
  mediaType: 'movie' | 'tv';
  /** TMDB content id */
  contentId: string;
  /** Whether the page is in minimal/embedded mode */
  minimal: boolean;
}

export interface PlayerProviderActions {
  setSelectedProvider: (id: string) => void;
  setSelectedSeason: (season: number) => void;
  setActiveEpisode: (episode: number) => void;
  setIsFullscreen: (fs: boolean) => void;
  setCpuWarning: (warn: boolean) => void;
  setIframeLoadError: (err: boolean) => void;
  refreshIframe: () => void;
  toggleFullscreen: () => void;
  goToNextEpisode: () => void;
  goToPrevEpisode: () => void;
}

type PlayerContextValue = PlayerProviderState & PlayerProviderActions;

const PlayerContext = createContext<PlayerContextValue | null>(null);

interface PlayerProviderProps {
  children: ReactNode;
  mediaType: 'movie' | 'tv';
  contentId: string;
  initialProviderId?: string;
  initialSeason?: number;
  initialEpisode?: number;
  minimal?: boolean;
  /** Max number of episodes for next/prev boundary */
  maxEpisodeCount?: number;
}

export function PlayerProvider({
  children,
  mediaType,
  contentId,
  initialProviderId,
  initialSeason = 1,
  initialEpisode = 1,
  minimal = false,
  maxEpisodeCount = 99,
}: PlayerProviderProps) {
  const [selectedProviderId, setSelectedProvider] = useState<string | null>(
    initialProviderId ?? null,
  );
  const [selectedSeason, setSelectedSeason] = useState(initialSeason);
  const [activeEpisode, setActiveEpisode] = useState(initialEpisode);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cpuWarning, setCpuWarning] = useState(false);
  const [iframeLoadError, setIframeLoadError] = useState(false);
  const refreshKeyRef = useRef(0);
  const [refreshKey, setRefreshKey] = useState(0);

  // Fullscreen listener
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const refreshIframe = useCallback(() => {
    refreshKeyRef.current += 1;
    setRefreshKey(refreshKeyRef.current);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  }, []);

  const goToNextEpisode = useCallback(() => {
    setActiveEpisode((prev) => Math.min(prev + 1, maxEpisodeCount));
  }, [maxEpisodeCount]);

  const goToPrevEpisode = useCallback(() => {
    setActiveEpisode((prev) => Math.max(prev - 1, 1));
  }, []);

  const value: PlayerContextValue = {
    selectedProviderId,
    selectedSeason,
    activeEpisode,
    isFullscreen,
    cpuWarning,
    iframeLoadError,
    refreshKey,
    mediaType,
    contentId,
    minimal,
    setSelectedProvider,
    setSelectedSeason,
    setActiveEpisode,
    setIsFullscreen,
    setCpuWarning,
    setIframeLoadError,
    refreshIframe,
    toggleFullscreen,
    goToNextEpisode,
    goToPrevEpisode,
  };

  return (
    <PlayerContext.Provider value={value}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }
  return ctx;
}
