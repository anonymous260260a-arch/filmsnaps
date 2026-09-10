/**
 * Unified ControlBar — works with NativePlayerAdapter, VideoJSPlayerAdapter,
 * and WebCodecsPlayerAdapter.
 *
 * Features: play/pause, smooth 60fps progress bar with scrubbing, time
 * display, volume, settings (quality/audio/subtitles/speed), fullscreen,
 * keyboard shortcuts.
 *
 * Rendered inside PlayerShell, which handles auto-hide, gestures, and the
 * center play/pause + seek indicators — this component only owns the bottom
 * bar UI itself.
 */

"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  Pause,
  Volume2,
  Volume1,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  SkipForward,
} from "lucide-react";
import type {
  PlayerAdapter,
  QualityOption,
  AudioTrack,
  SubtitleTrack,
} from "./player-adapters";
import { ProgressBar } from "./ProgressBar";
import { SettingsPanel } from "./SettingsPanel";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

export interface ControlBarProps {
  player: PlayerAdapter;
  qualities?: QualityOption[];
  audioTracks?: AudioTrack[];
  subtitleTracks?: SubtitleTrack[];
  onQualityChange?: (quality: QualityOption) => void;
  onAudioTrackChange?: (trackId: string) => void;
  onSubtitleChange?: (trackId: string | null) => void;
  onPlaybackRateChange?: (rate: number) => void;
  initialRate?: number;
  keyboardEnabled?: boolean;
  /** Lets the parent (PlayerShell) keep controls visible while scrubbing. */
  onSeekingChange?: (seeking: boolean) => void;
  /** Lets the parent keep controls visible while the settings panel is open. */
  onSettingsOpenChange?: (open: boolean) => void;
}

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ControlBar({
  player,
  qualities,
  audioTracks,
  subtitleTracks,
  onQualityChange,
  onAudioTrackChange,
  onSubtitleChange,
  onPlaybackRateChange,
  initialRate = 1,
  keyboardEnabled = true,
  onSeekingChange,
  onSettingsOpenChange,
}: ControlBarProps) {
  const [isPlaying, setIsPlaying] = useState(!player.isPaused());
  const [displayTime, setDisplayTime] = useState(player.getCurrentTime());
  const [duration, setDuration] = useState(player.getDuration());
  const [volume, setVolume] = useState(player.getVolume());
  const [isMuted, setIsMuted] = useState(player.isMuted());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(initialRate);
  const settingsRef = useRef<HTMLDivElement>(null);

  const handleRateChange = useCallback(
    (rate: number) => {
      setPlaybackRate(rate);
      player.setPlaybackRate(rate);
      onPlaybackRateChange?.(rate);
    },
    [player, onPlaybackRateChange],
  );

  useEffect(() => {
    const unsubPlayPause =
      player.onPlayPause?.(() => setIsPlaying(!player.isPaused())) ??
      (() => {});
    return unsubPlayPause;
  }, [player]);

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handleFsChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(e.target as Node)
      ) {
        setShowSettings(false);
      }
    };
    if (showSettings) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showSettings]);

  useEffect(() => {
    onSettingsOpenChange?.(showSettings);
  }, [showSettings, onSettingsOpenChange]);

  useKeyboardShortcuts(player, keyboardEnabled);

  const handlePlayPause = () => {
    if (isPlaying) player.pause();
    else player.play();
  };

  const handleSeek = (time: number) => {
    player.seek(time);
    setDisplayTime(time);
  };

  const handleSeekStart = () => onSeekingChange?.(true);

  const handleSeekEnd = () => {
    onSeekingChange?.(false);
    setDisplayTime(player.getCurrentTime());
    setDuration(player.getDuration());
  };

  const handleFrame = useCallback((t: number, d: number) => {
    setDisplayTime(t);
    setDuration(d);
  }, []);

  const handleVolumeChange = (newVolume: number) => {
    player.setVolume(newVolume);
    player.setMuted(newVolume === 0);
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
  };

  const handleMuteToggle = () => {
    player.setMuted(!isMuted);
    setIsMuted(!isMuted);
  };

  const handleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      player.requestFullscreen();
    }
  };

  const audioTracksCount =
    audioTracks?.length ?? player.getAudioTracks?.().length ?? 0;
  const resolvedAudioTracks = audioTracks ?? player.getAudioTracks?.() ?? [];

  const handleAudioTrackChange = useCallback(
    (trackId: string) => {
      player.setAudioTrack?.(trackId);
      onAudioTrackChange?.(trackId);
    },
    [player, onAudioTrackChange],
  );

  return (
    <div className="bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pt-8 pb-3">
      <ProgressBar
        player={player}
        onSeek={handleSeek}
        onSeekStart={handleSeekStart}
        onSeekEnd={handleSeekEnd}
        onFrame={handleFrame}
      />

      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={handlePlayPause}
          className="text-white hover:text-[#D4A237] transition-colors flex-shrink-0"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <Pause size={22} fill="currentColor" />
          ) : (
            <Play size={22} fill="currentColor" />
          )}
        </button>

        <div className="text-white text-xs font-mono tabular-nums min-w-[120px]">
          {formatTime(displayTime)} / {formatTime(duration)}
        </div>

        <button
          onClick={() =>
            player.seek(Math.min(duration, player.getCurrentTime() + 10))
          }
          className="text-white/60 hover:text-white transition-colors flex-shrink-0"
          aria-label="Skip forward 10 seconds"
          title="Skip forward 10s (L)"
        >
          <SkipForward size={18} />
        </button>

        <div className="flex-1" />

        <div className="hidden sm:flex items-center gap-1">
          <button
            onClick={handleMuteToggle}
            className="text-white/60 hover:text-white transition-colors flex-shrink-0"
            aria-label={isMuted || volume === 0 ? "Unmute" : "Mute"}
            title={isMuted || volume === 0 ? "Unmute (M)" : "Mute (M)"}
          >
            {isMuted || volume === 0 ? (
              <VolumeX size={18} />
            ) : volume < 0.5 ? (
              <Volume1 size={18} />
            ) : (
              <Volume2 size={18} />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={isMuted ? 0 : volume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            className="w-16 h-1 accent-[#D4A237] opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Volume"
          />
        </div>

        {playbackRate !== 1 && (
          <span
            className="text-xs font-mono px-2 py-0.5 rounded text-[#D4A237]"
            aria-label={`Playback rate ${playbackRate}x`}
            title={`Playback rate: ${playbackRate}x`}
          >
            {playbackRate.toFixed(2)}x
          </span>
        )}

        {(qualities?.length ||
          audioTracksCount > 1 ||
          subtitleTracks?.length ||
          onPlaybackRateChange) && (
          <div ref={settingsRef} className="relative">
            <button
              onClick={() => setShowSettings((v) => !v)}
              className="text-white/60 hover:text-white transition-colors flex-shrink-0"
              aria-label="Settings"
              aria-expanded={showSettings}
            >
              <Settings size={18} />
            </button>

            {showSettings && (
              <SettingsPanel
                qualities={qualities}
                audioTracks={resolvedAudioTracks}
                subtitleTracks={subtitleTracks}
                currentRate={playbackRate}
                playbackRates={PLAYBACK_RATES}
                onQualityChange={onQualityChange}
                onAudioTrackChange={handleAudioTrackChange}
                onSubtitleChange={onSubtitleChange}
                onRateChange={handleRateChange}
                onClose={() => setShowSettings(false)}
              />
            )}
          </div>
        )}

        <button
          onClick={handleFullscreen}
          className="text-white/60 hover:text-white transition-colors flex-shrink-0"
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          title="Fullscreen (F)"
        >
          {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
        </button>
      </div>
    </div>
  );
}
