/**
 * WebCodecsPlayerWithControls — wraps WebCodecsPlayer with the unified
 * PlayerShell (gestures, auto-hide, indicators) + ControlBar.
 */

"use client";

import React, { useRef, useState, useCallback } from "react";
import { WebCodecsPlayer, type WebCodecsPlayerHandle } from "./WebCodecsPlayer";
import { PlayerShell } from "./PlayerShell";
import { WebCodecsPlayerAdapter } from "./player-adapters";
import type { QualityOption } from "./player-adapters";

interface WebCodecsPlayerWithControlsProps {
  videoUrl: string;
  audioLanguages?: string[];
  onLoad?: () => void;
  onError?: () => void;
  qualities?: QualityOption[];
  onQualityChange?: (quality: QualityOption) => void;
}

export function WebCodecsPlayerWithControls({
  videoUrl,
  audioLanguages,
  onLoad,
  onError,
  qualities,
  onQualityChange,
}: WebCodecsPlayerWithControlsProps) {
  const playerHandleRef = useRef<WebCodecsPlayerHandle | null>(null);
  const [adapter, setAdapter] = useState<WebCodecsPlayerAdapter | null>(null);

  const handleRefReady = useCallback((handle: WebCodecsPlayerHandle) => {
    playerHandleRef.current = handle;
    setAdapter(new WebCodecsPlayerAdapter({ current: handle } as any));
  }, []);

  return (
    <PlayerShell
      player={adapter}
      qualities={qualities}
      audioTracks={adapter?.getAudioTracks?.()}
      onQualityChange={onQualityChange}
      onAudioTrackChange={(id) => adapter?.setAudioTrack?.(id)}
    >
      <WebCodecsPlayer
        videoUrl={videoUrl}
        audioLanguages={audioLanguages}
        onLoad={onLoad}
        onError={onError}
        onRefReady={handleRefReady}
      />
    </PlayerShell>
  );
}
