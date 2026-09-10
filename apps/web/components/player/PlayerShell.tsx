/**
 * PlayerShell — the single overlay layer shared by all three decoder paths
 * (native <video>, video.js, WebCodecs).
 *
 * It owns:
 *   - long-press / hold-space 2x speed boost + "2x ►" indicator
 *   - double-click / double-tap seek (±10s) with animated indicators
 *   - double-click / double-tap center = play/pause, or fullscreen on the
 *     video's own double-click when controls are already visible
 *   - mobile vertical swipe gestures for brightness (left) / volume (right)
 *   - auto-hiding ControlBar
 *   - center play/pause button with scale/fade animation
 *   - buffering spinner (separate from the initial full-screen loader)
 *
 * Renders `children` (the raw video surface) beneath all of the above.
 */

"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Play, Pause, Loader2, Sun, Volume2 } from "lucide-react";
import type {
  PlayerAdapter,
  QualityOption,
  AudioTrack,
  SubtitleTrack,
} from "./player-adapters";
import { ControlBar } from "./ControlBar";
import { useSpeedBoost } from "./useSpeedBoost";
import { useDoubleTapZones } from "./useDoubleTapZones";
import { useGestureControls } from "./useGestureControls";
import { useAutoHideControls } from "./useAutoHideControls";

export interface PlayerShellProps {
  player: PlayerAdapter | null;
  children: React.ReactNode;
  qualities?: QualityOption[];
  audioTracks?: AudioTrack[];
  subtitleTracks?: SubtitleTrack[];
  onQualityChange?: (quality: QualityOption) => void;
  onAudioTrackChange?: (trackId: string) => void;
  onSubtitleChange?: (trackId: string | null) => void;
  className?: string;
}

type SeekIndicator = { dir: "back" | "forward"; key: number } | null;

export function PlayerShell({
  player,
  children,
  qualities,
  audioTracks,
  subtitleTracks,
  onQualityChange,
  onAudioTrackChange,
  onSubtitleChange,
  className = "",
}: PlayerShellProps) {
  const [isPlaying, setIsPlaying] = useState(
    player ? !player.isPaused() : false,
  );
  const [isSeeking, setIsSeeking] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [centerPulse, setCenterPulse] = useState(false);
  const [seekIndicator, setSeekIndicator] = useState<SeekIndicator>(null);
  const seekKeyRef = useRef(0);

  const forceVisible = isSeeking || isSettingsOpen || !isPlaying;
  const { visible: controlsVisible, show: showControls } = useAutoHideControls(
    3200,
    forceVisible,
  );

  // ── Track play/pause + buffering state from the adapter ────────────
  useEffect(() => {
    if (!player) return;
    const unsubPlayPause =
      player.onPlayPause?.(() => setIsPlaying(!player.isPaused())) ??
      (() => {});
    const unsubWaiting =
      player.onWaiting?.(() => setIsBuffering(true)) ?? (() => {});
    const unsubPlaying =
      player.onPlaying?.(() => setIsBuffering(false)) ?? (() => {});
    return () => {
      unsubPlayPause();
      unsubWaiting();
      unsubPlaying();
    };
  }, [player]);

  const { isBoosted, longPressHandlers } = useSpeedBoost({
    player: player as PlayerAdapter,
    normalRate: player?.getPlaybackRate() ?? 1,
    boostRate: 2,
    enabled: !!player,
  });

  const triggerCenterPulse = useCallback(() => {
    setCenterPulse(true);
    setTimeout(() => setCenterPulse(false), 260);
  }, []);

  const handlePlayPause = useCallback(() => {
    if (!player) return;
    if (player.isPaused()) player.play();
    else player.pause();
    triggerCenterPulse();
    showControls();
  }, [player, triggerCenterPulse, showControls]);

  const handleSeekBy = useCallback(
    (delta: number, dir: "back" | "forward") => {
      if (!player) return;
      const target = Math.max(
        0,
        Math.min(player.getDuration(), player.getCurrentTime() + delta),
      );
      player.seek(target);
      seekKeyRef.current += 1;
      setSeekIndicator({ dir, key: seekKeyRef.current });
      setTimeout(
        () =>
          setSeekIndicator((cur) =>
            cur?.key === seekKeyRef.current ? null : cur,
          ),
        650,
      );
      showControls();
    },
    [player, showControls],
  );

  const { onClick: onZoneClick, onTouchEnd: onZoneTouchEnd } =
    useDoubleTapZones({
      onDoubleLeft: () => handleSeekBy(-10, "back"),
      onDoubleRight: () => handleSeekBy(10, "forward"),
      onDoubleCenter: handlePlayPause,
      onSingle: () => showControls(),
      disabled: isSettingsOpen,
    });

  const { gesture, handlers: gestureHandlers } = useGestureControls({
    initialVolume: player?.getVolume() ?? 1,
    onVolumeChange: (v) => {
      if (!player) return;
      player.setVolume(v);
      player.setMuted(v === 0);
    },
    disabled: isSettingsOpen,
  });

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // Long-press on touch devices can trigger a context menu; suppress it
    // over the video surface so it doesn't fight the speed-boost gesture.
    e.preventDefault();
  }, []);

  return (
    <div
      className={`absolute inset-0 select-none ${className}`}
      onMouseMove={showControls}
      onContextMenu={handleContextMenu}
    >
      {/* Video surface */}
      <div className="absolute inset-0">{children}</div>

      {/* Gesture capture layer */}
      <div
        className="absolute inset-0 z-10 touch-none"
        onClick={onZoneClick}
        onTouchEnd={onZoneTouchEnd}
        onTouchStart={(e) => {
          gestureHandlers.onTouchStart(e);
          showControls();
        }}
        onTouchMove={gestureHandlers.onTouchMove}
        onTouchCancel={gestureHandlers.onTouchCancel}
        {...longPressHandlers}
        style={{ touchAction: "none" }}
      >
        {/* Center play/pause pulse */}
        <div
          className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-200 ${
            centerPulse ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="bg-black/60 rounded-full p-5 scale-100 animate-[pulseIcon_0.26s_ease-out]">
            {isPlaying ? (
              <Pause size={40} className="text-white" fill="currentColor" />
            ) : (
              <Play size={40} className="text-white" fill="currentColor" />
            )}
          </div>
        </div>

        {/* Seek indicators */}
        {seekIndicator && (
          <div
            key={seekIndicator.key}
            className={`absolute top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 pointer-events-none animate-[seekFade_0.65s_ease-out] ${
              seekIndicator.dir === "back" ? "left-[12%]" : "right-[12%]"
            }`}
          >
            <div className="bg-black/70 rounded-full px-4 py-3 flex items-center gap-1.5 text-white">
              <span className="text-lg font-bold">
                {seekIndicator.dir === "back" ? "-10s" : "+10s"}
              </span>
            </div>
          </div>
        )}

        {/* 2x speed-boost indicator */}
        {isBoosted && (
          <div className="absolute top-6 left-1/2 -translate-x-1/2 pointer-events-none">
            <div className="bg-black/75 border border-[#D4A237]/40 rounded-full px-4 py-1.5 flex items-center gap-1.5 text-[#D4A237] font-bold text-sm animate-[fadeIn_0.15s_ease-out]">
              2x ►
            </div>
          </div>
        )}

        {/* Brightness / volume swipe overlay */}
        {gesture.kind && (
          <div
            className={`absolute top-1/2 -translate-y-1/2 flex flex-col items-center gap-2 pointer-events-none ${
              gesture.kind === "brightness" ? "left-8" : "right-8"
            }`}
          >
            <div className="h-32 w-8 bg-black/60 rounded-full flex flex-col-reverse overflow-hidden border border-white/10">
              <div
                className="w-full bg-[#D4A237] transition-[height] duration-75"
                style={{ height: `${gesture.value * 100}%` }}
              />
            </div>
            {gesture.kind === "brightness" ? (
              <Sun size={16} className="text-white" />
            ) : (
              <Volume2 size={16} className="text-white" />
            )}
          </div>
        )}

        {/* Buffering spinner */}
        {isBuffering && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-black/50 rounded-full p-4 animate-[fadeIn_0.2s_ease-out]">
              <Loader2 size={32} className="text-[#D4A237] animate-spin" />
            </div>
          </div>
        )}
      </div>

      {/* Control bar */}
      {player && (
        <div
          className={`absolute inset-x-0 bottom-0 z-20 transition-opacity duration-300 ${
            controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <ControlBar
            player={player}
            qualities={qualities}
            audioTracks={audioTracks}
            subtitleTracks={subtitleTracks}
            onQualityChange={onQualityChange}
            onAudioTrackChange={onAudioTrackChange}
            onSubtitleChange={onSubtitleChange}
            onSeekingChange={setIsSeeking}
            onSettingsOpenChange={setIsSettingsOpen}
            keyboardEnabled={true}
          />
        </div>
      )}

      <style>{`
        @keyframes pulseIcon {
          0% { transform: scale(0.6); opacity: 0; }
          60% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes seekFade {
          0% { opacity: 0; transform: translateY(-50%) scale(0.85); }
          15% { opacity: 1; transform: translateY(-50%) scale(1); }
          80% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
