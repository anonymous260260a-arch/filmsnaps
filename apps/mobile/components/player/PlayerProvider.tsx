/**
 * PlayerProvider — React Context for shared player state on mobile.
 *
 * Holds: selectedProviderId, isFullscreen, episode state.
 * Rapidly-changing state (currentTime, duration) lives in useRef, NOT Context.
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

interface PlayerState {
  providerId: string;
  setProviderId: (id: string) => void;
  isFullscreen: boolean;
  setIsFullscreen: (fs: boolean) => void;
  toggleFullscreen: () => void;
  currentSeason: number;
  currentEpisode: number;
  setCurrentSeason: (s: number) => void;
  setCurrentEpisode: (e: number) => void;
}

const PlayerContext = createContext<PlayerState | null>(null);

export function PlayerProvider({
  children,
  initialProvider = '',
  initialSeason,
  initialEpisode,
}: {
  children: ReactNode;
  initialProvider?: string;
  initialSeason?: number;
  initialEpisode?: number;
}) {
  const [providerId, setProviderId] = useState(initialProvider);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentSeason, setCurrentSeason] = useState(initialSeason ?? 1);
  const [currentEpisode, setCurrentEpisode] = useState(initialEpisode ?? 1);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((f) => !f);
  }, []);

  return (
    <PlayerContext.Provider
      value={{
        providerId,
        setProviderId,
        isFullscreen,
        setIsFullscreen,
        toggleFullscreen,
        currentSeason,
        currentEpisode,
        setCurrentSeason,
        setCurrentEpisode,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerState {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }
  return ctx;
}
