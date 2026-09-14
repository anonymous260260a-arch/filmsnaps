/**
 * Unified ControlBar — modern YouTube/mobile-style player controls.
 *
 * Redesigned to match mobile HevcPlayer aesthetics:
 * - Big center play/pause with gold accent
 * - Smooth progress bar with hover time preview
 * - Source quality badge
 * - Clean volume slider
 * - Settings panel
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
  SkipBack,
  Server,
  Loader2,
  Headphones,
  Captions,
  Check,
  Search,
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
  /** Active track ids — drive the checkmark in the quick audio/CC menus. */
  currentAudioTrackId?: string;
  currentSubtitleTrackId?: string;
  /** Open the online-subtitle search. Presence adds "Load subtitles online…"
   *  to the CC menu (mpv only — HTML video can't consume remote subs). */
  onSubtitlesSearch?: () => void;
  onPlaybackRateChange?: (rate: number) => void;
  initialRate?: number;
  keyboardEnabled?: boolean;
  onSeekingChange?: (seeking: boolean) => void;
  onSettingsOpenChange?: (open: boolean) => void;
  sourceLabel?: string;
  onSourcePicker?: () => void;
  /** Where the source badge renders. "top" overlays the video (HTML video
   *  decoders); "row" puts it inline in the control row — mpv renders into a
   *  native OS window that covers all HTML above the bottom strip. */
  badgePosition?: "top" | "row";
  /** "strip" = flow layout below mpv video; "overlay" = absolute on top of video */
  layout?: "strip" | "overlay";
  /** Buffering state — shows spinner in strip mode (D9 fix) */
  isBuffering?: boolean;
  /** Source switching label — shows in strip mode (D9 fix) */
  switchingLabel?: string;
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
  sourceLabel,
  onSourcePicker,
  currentAudioTrackId,
  currentSubtitleTrackId,
  onSubtitlesSearch,
  badgePosition = "top",
  layout = "overlay",
  isBuffering = false,
  switchingLabel,
}: ControlBarProps) {
  const [isPlaying, setIsPlaying] = useState(!player.isPaused());
  const [displayTime, setDisplayTime] = useState(player.getCurrentTime());
  const [duration, setDuration] = useState(player.getDuration());
  const [volume, setVolume] = useState(player.getVolume());
  const [isMuted, setIsMuted] = useState(player.isMuted());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Quick track menus ("audio" | "subs") — visible buttons like mobile's
  // PlayerOverlay, instead of burying tracks inside the settings panel.
  const [trackMenu, setTrackMenu] = useState<"audio" | "subs" | null>(null);
  const trackMenuRef = useRef<HTMLDivElement>(null);
  const [playbackRate, setPlaybackRate] = useState(initialRate);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const progressBarRef = useRef<HTMLDivElement>(null);
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

  // Desktop: fullscreen lives on the OS window (toggled via the mpv bridge or
  // the provider IPC), so document.fullscreenElement never changes here. The
  // main process relays a "host-fullscreen" mpv:event on every window
  // enter/leave — it covers mpv AND embed playback, in the main window and
  // the overlay alike. (The payload's discriminant is `type`; mpv's raw JSON
  // events keep their own `event` field nested under `raw` — parsing `ev.event`
  // never matched, which left the fullscreen icon stuck.) In the plain web,
  // DOM fullscreen rules and the listener above handles it.
  const isMpvOverlay =
    typeof window !== "undefined" && (window as any).__MPV_OVERLAY__ === true;
  useEffect(() => {
    const mpv = (window as any).electronAPI?.mpv;
    if (!mpv?.onEvent) return;
    return mpv.onEvent((ev: any) => {
      if (ev?.type === "host-fullscreen") {
        setIsFullscreen(!!ev?.value);
      }
    });
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(e.target as Node)
      ) {
        setShowSettings(false);
      }
      if (
        trackMenuRef.current &&
        !trackMenuRef.current.contains(e.target as Node)
      ) {
        setTrackMenu(null);
      }
    };
    if (showSettings || trackMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showSettings, trackMenu]);

  // Reports ANY open HTML overlay (settings panel or quick track menus) —
  // native-window decoders (mpv) hide the video while one is open, otherwise
  // the OS window draws over the popover.
  useEffect(() => {
    onSettingsOpenChange?.(showSettings || trackMenu !== null);
  }, [showSettings, trackMenu, onSettingsOpenChange]);

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
    // mpv overlay: fullscreen toggles the main OS window via the mpv bridge —
    // element fullscreen on this window would fullscreen the controls only.
    if (isMpvOverlay) {
      (window as any).electronAPI?.mpv?.toggleFullscreen?.();
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      player.requestFullscreen();
    }
  };

  const handleProgressBarHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || duration <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const time = (x / rect.width) * duration;
    setHoverTime(time);
    setHoverX(x);
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

  const hasControls =
    qualities?.length ||
    audioTracksCount > 1 ||
    subtitleTracks?.length ||
    onPlaybackRateChange;

  // ── Strip variant (mpv mode): all controls in flow, min-h-[64px] floor ──
  if (layout === "strip") {
    return (
      <div
        data-mpv-control-bar
        className="flex min-h-[64px] w-full select-none flex-col bg-black"
      >
        {/* Row 1 — Progress bar. Full-width, in flow. */}
        <div
          ref={progressBarRef}
          className="relative flex h-6 items-center px-2 cursor-pointer"
          onMouseMove={handleProgressBarHover}
          onMouseLeave={() => setHoverTime(null)}
        >
          {hoverTime !== null && (
            <div
              className="absolute bottom-full mb-2 pointer-events-none z-20"
              style={{ left: `${hoverX}px`, transform: "translateX(-50%)" }}
            >
              <div className="bg-[#16161A] border border-white/10 rounded-md px-2 py-1 text-[11px] font-mono text-white tabular-nums">
                {formatTime(hoverTime)}
              </div>
            </div>
          )}
          <ProgressBar
            player={player}
            onSeek={handleSeek}
            onSeekStart={handleSeekStart}
            onSeekEnd={handleSeekEnd}
            onFrame={handleFrame}
          />
        </div>

        {/* Row 2 — Buttons. All in flow. */}
        <div className="flex items-center gap-1.5 px-2 pb-2 pt-1">
          {/* Play/Pause */}
          <button
            onClick={handlePlayPause}
            className="w-9 h-9 flex items-center justify-center rounded-full text-white hover:text-[#D4A237] hover:bg-white/10 transition-all active:scale-90"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause size={22} fill="currentColor" />
            ) : (
              <Play size={22} fill="currentColor" className="ml-0.5" />
            )}
          </button>

          {/* Skip back 10s */}
          <button
            onClick={() =>
              player.seek(Math.max(0, player.getCurrentTime() - 10))
            }
            className="w-8 h-8 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-all active:scale-90"
            aria-label="Skip back 10 seconds"
          >
            <SkipBack size={15} />
          </button>

          {/* Skip forward 10s */}
          <button
            onClick={() =>
              player.seek(Math.min(duration, player.getCurrentTime() + 10))
            }
            className="w-8 h-8 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-all active:scale-90"
            aria-label="Skip forward 10 seconds"
          >
            <SkipForward size={15} />
          </button>

          {/* Volume */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleMuteToggle}
              className="w-8 h-8 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-all active:scale-90"
              aria-label={isMuted || volume === 0 ? "Unmute" : "Mute"}
            >
              {isMuted || volume === 0 ? (
                <VolumeX size={16} />
              ) : volume < 0.5 ? (
                <Volume1 size={16} />
              ) : (
                <Volume2 size={16} />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={isMuted ? 0 : volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
              className="w-20 h-1 accent-white cursor-pointer"
              aria-label="Volume"
            />
          </div>

          {/* Time display */}
          <span className="ml-1 whitespace-nowrap text-xs tabular-nums text-white/80 font-mono">
            {formatTime(displayTime)} / {formatTime(duration)}
          </span>

          {/* D9 — Status indicators (moved out of video region) */}
          {(isBuffering || switchingLabel) && (
            <Loader2 size={14} className="animate-spin text-[#D4A237] ml-1" />
          )}
          {switchingLabel && (
            <span className="text-xs text-white/60 ml-1 max-w-[120px] truncate">
              {switchingLabel}
            </span>
          )}

          {/* Playback rate */}
          {playbackRate !== 1 && (
            <button
              onClick={() => handleRateChange(1)}
              className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-[#D4A237]/20 text-[#D4A237] hover:bg-[#D4A237]/30 transition-colors"
            >
              {playbackRate}x
            </button>
          )}

          <div className="flex-1" />

          {/* Source badge — inline, clickable. Always shown when a picker
              handler exists; label may still be loading. */}
          {onSourcePicker && (
            <button
              onClick={onSourcePicker}
              className="rounded-md border border-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/70 hover:text-white hover:border-white/30 transition-colors"
              title="Change source — switch if the video doesn't play or buffers"
            >
              {sourceLabel || "Source"}
            </button>
          )}

          {/* Quick audio / CC menus (mobile parity) — popovers float above
              the control row; the video window hides while one is open */}
          <TrackButtons
            size="sm"
            containerRef={trackMenuRef}
            audioTracks={resolvedAudioTracks}
            subtitleTracks={subtitleTracks ?? []}
            currentAudioTrackId={currentAudioTrackId}
            currentSubtitleTrackId={currentSubtitleTrackId}
            onAudioTrackChange={handleAudioTrackChange}
            onSubtitleChange={onSubtitleChange}
            onSubtitlesSearch={onSubtitlesSearch}
            trackMenu={trackMenu}
            setTrackMenu={(menu) => {
              setTrackMenu(menu);
              if (menu) setShowSettings(false);
            }}
          />

          {/* Settings */}
          {hasControls && (
            <div ref={settingsRef} className="relative">
              <button
                onClick={() => {
                  setShowSettings((v) => !v);
                  setTrackMenu(null);
                }}
                className={`w-8 h-8 flex items-center justify-center rounded-full transition-all active:scale-90 ${
                  showSettings
                    ? "text-[#D4A237] bg-[#D4A237]/15"
                    : "text-white/60 hover:text-white hover:bg-white/10"
                }`}
                aria-label="Settings"
                aria-expanded={showSettings}
              >
                <Settings size={16} />
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

          {/* Fullscreen */}
          <button
            onClick={handleFullscreen}
            className="w-8 h-8 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-all active:scale-90"
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>
      </div>
    );
  }

  // ── Overlay variant (HTML video mode): existing absolute-positioned layout ──
  return (
    <div className="relative select-none">
      {/* Top gradient overlay */}
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />

      {/* Source quality badge — top left (HTML-video decoders only; in mpv
          strip mode the native window would cover it). Always shown when a
          picker handler exists; label may still be loading. */}
      {onSourcePicker && badgePosition === "top" && (
        <button
          onClick={onSourcePicker}
          className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/60 backdrop-blur-sm border border-[#D4A237]/30 hover:bg-black/80 hover:border-[#D4A237]/50 transition-all"
        >
          <Server size={12} className="text-[#D4A237]" />
          <span className="text-[11px] font-bold text-[#D4A237] tracking-wide max-w-[180px] truncate">
            {sourceLabel || "Source"}
          </span>
        </button>
      )}

      {/* Bottom control bar */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
        {/* Progress bar area */}
        <div
          ref={progressBarRef}
          className="relative mx-4 h-6 flex items-center cursor-pointer group"
          onMouseMove={handleProgressBarHover}
          onMouseLeave={() => setHoverTime(null)}
        >
          {/* Hover time preview */}
          {hoverTime !== null && (
            <div
              className="absolute bottom-full mb-2 pointer-events-none z-20"
              style={{ left: `${hoverX}px`, transform: "translateX(-50%)" }}
            >
              <div className="bg-[#16161A] border border-white/10 rounded-md px-2 py-1 text-[11px] font-mono text-white tabular-nums">
                {formatTime(hoverTime)}
              </div>
            </div>
          )}
          <ProgressBar
            player={player}
            onSeek={handleSeek}
            onSeekStart={handleSeekStart}
            onSeekEnd={handleSeekEnd}
            onFrame={handleFrame}
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-1 px-4 pb-3 pt-1">
          {/* Left controls */}
          <button
            onClick={handlePlayPause}
            className="w-10 h-10 flex items-center justify-center rounded-full text-white hover:text-[#D4A237] hover:bg-white/10 transition-all active:scale-90"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause size={22} fill="currentColor" />
            ) : (
              <Play size={22} fill="currentColor" className="ml-0.5" />
            )}
          </button>

          {/* Skip back 10s */}
          <button
            onClick={() =>
              player.seek(Math.max(0, player.getCurrentTime() - 10))
            }
            className="w-9 h-9 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-all active:scale-90"
            aria-label="Skip back 10 seconds"
            title="Rewind 10s (J)"
          >
            <SkipBack size={16} />
          </button>

          {/* Skip forward 10s */}
          <button
            onClick={() =>
              player.seek(Math.min(duration, player.getCurrentTime() + 10))
            }
            className="w-9 h-9 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-all active:scale-90"
            aria-label="Skip forward 10 seconds"
            title="Forward 10s (L)"
          >
            <SkipForward size={16} />
          </button>

          {/* Time display */}
          <div className="text-white/80 text-xs font-mono tabular-nums min-w-[110px] ml-2">
            <span className="text-white">{formatTime(displayTime)}</span>
            <span className="text-white/40 mx-1">/</span>
            <span>{formatTime(duration)}</span>
          </div>

          {/* Source badge (mpv strip mode) — inline, clickable, opens picker.
              Always shown when a picker handler exists; label may be loading. */}
          {onSourcePicker && badgePosition === "row" && (
            <button
              onClick={onSourcePicker}
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#D4A237]/10 border border-[#D4A237]/30 hover:bg-[#D4A237]/20 hover:border-[#D4A237]/50 transition-all ml-1 max-w-[240px]"
              title="Change source — switch if the video doesn't play or buffers"
            >
              <Server size={12} className="text-[#D4A237] shrink-0" />
              <span className="text-[11px] font-bold text-[#D4A237] tracking-wide truncate">
                {sourceLabel || "Source"}
              </span>
            </button>
          )}

          <div className="flex-1" />

          {/* Volume */}
          <div className="hidden sm:flex items-center gap-1 group/vol">
            <button
              onClick={handleMuteToggle}
              className="w-9 h-9 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-all active:scale-90"
              aria-label={isMuted || volume === 0 ? "Unmute" : "Mute"}
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
              step={0.02}
              value={isMuted ? 0 : volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
              className="w-0 group-hover/vol:w-20 transition-all duration-200 h-1 accent-[#D4A237] opacity-0 group-hover/vol:opacity-100 cursor-pointer"
              aria-label="Volume"
            />
          </div>

          {/* Playback rate */}
          {playbackRate !== 1 && (
            <button
              onClick={() => handleRateChange(1)}
              className="text-[11px] font-bold px-2 py-1 rounded-md bg-[#D4A237]/20 text-[#D4A237] hover:bg-[#D4A237]/30 transition-colors"
            >
              {playbackRate}x
            </button>
          )}

          {/* Quick audio / CC menus (mobile parity) */}
          <TrackButtons
            size="md"
            containerRef={trackMenuRef}
            audioTracks={resolvedAudioTracks}
            subtitleTracks={subtitleTracks ?? []}
            currentAudioTrackId={currentAudioTrackId}
            currentSubtitleTrackId={currentSubtitleTrackId}
            onAudioTrackChange={handleAudioTrackChange}
            onSubtitleChange={onSubtitleChange}
            onSubtitlesSearch={onSubtitlesSearch}
            trackMenu={trackMenu}
            setTrackMenu={setTrackMenu}
          />

          {/* Settings */}
          {hasControls && (
            <div ref={settingsRef} className="relative">
              <button
                onClick={() => setShowSettings((v) => !v)}
                className={`w-9 h-9 flex items-center justify-center rounded-full transition-all active:scale-90 ${
                  showSettings
                    ? "text-[#D4A237] bg-[#D4A237]/15"
                    : "text-white/60 hover:text-white hover:bg-white/10"
                }`}
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

          {/* Fullscreen */}
          <button
            onClick={handleFullscreen}
            className="w-9 h-9 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-all active:scale-90"
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title="Fullscreen (F)"
          >
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Quick track buttons + popover menus (mobile parity) ──────────────
// Mobile's PlayerOverlay exposes audio + CC as first-class buttons. The
// settings panel keeps working — these are the fast path.

interface TrackMenuItem {
  id: string;
  label: string;
  active: boolean;
}

function TrackButtons({
  size,
  containerRef,
  inline = false,
  audioTracks,
  subtitleTracks,
  currentAudioTrackId,
  currentSubtitleTrackId,
  onAudioTrackChange,
  onSubtitleChange,
  onSubtitlesSearch,
  trackMenu,
  setTrackMenu,
}: {
  size: "sm" | "md";
  /** Attach when the popovers float (overlay mode) — drives outside-click. */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  /** Strip mode: buttons only; the panel renders in the in-flow panel row. */
  inline?: boolean;
  audioTracks: { id: string; label: string }[];
  subtitleTracks: { id: string; label: string }[];
  currentAudioTrackId?: string;
  currentSubtitleTrackId?: string;
  onAudioTrackChange?: (trackId: string) => void;
  onSubtitleChange?: (trackId: string | null) => void;
  onSubtitlesSearch?: () => void;
  trackMenu: "audio" | "subs" | null;
  setTrackMenu: (menu: "audio" | "subs" | null) => void;
}) {
  const showAudio = audioTracks.length > 1;
  // CC shows when the file has subtitle tracks, or when online search is
  // available (mpv) — otherwise there's nothing it could do.
  const showSubs = subtitleTracks.length > 0 || !!onSubtitlesSearch;
  if (!showAudio && !showSubs) return null;

  const btnCls = size === "sm" ? "w-8 h-8" : "w-9 h-9";
  const iconSize = size === "sm" ? 15 : 17;
  const baseCls = `${btnCls} flex items-center justify-center rounded-full transition-all active:scale-90`;
  const idleCls = "text-white/60 hover:text-white hover:bg-white/10";
  const activeCls = "text-[#D4A237] bg-[#D4A237]/15";

  return (
    <div className="flex items-center gap-0.5" ref={containerRef}>
      {showAudio && (
        <div className="relative">
          <button
            onClick={() => setTrackMenu(trackMenu === "audio" ? null : "audio")}
            className={`${baseCls} ${trackMenu === "audio" ? activeCls : idleCls}`}
            aria-label="Audio track"
            title="Audio track"
            aria-expanded={trackMenu === "audio"}
          >
            <Headphones size={iconSize} />
          </button>
          {trackMenu === "audio" && !inline && (
            <TrackMenuPopover
              title="Audio track"
              emptyText="No selectable audio tracks — this source has a single track"
              items={audioTracks.map((t) => ({
                id: t.id,
                label: t.label,
                active: t.id === currentAudioTrackId,
              }))}
              onSelect={(id) => {
                onAudioTrackChange?.(id);
                setTrackMenu(null);
              }}
            />
          )}
        </div>
      )}

      {showSubs && (
        <div className="relative">
          <button
            onClick={() => setTrackMenu(trackMenu === "subs" ? null : "subs")}
            className={`${baseCls} ${
              trackMenu === "subs" || currentSubtitleTrackId != null
                ? activeCls
                : idleCls
            }`}
            aria-label="Subtitles"
            title="Subtitles"
            aria-expanded={trackMenu === "subs"}
          >
            <Captions size={iconSize} />
          </button>
          {trackMenu === "subs" && !inline && (
            <TrackMenuPopover
              title="Subtitles"
              emptyText="No subtitles in this file"
              items={[
                {
                  id: "__off__",
                  label: "Off",
                  active: currentSubtitleTrackId == null,
                },
                ...subtitleTracks.map((t) => ({
                  id: t.id,
                  label: t.label,
                  active: t.id === currentSubtitleTrackId,
                })),
              ]}
              onSelect={(id) => {
                onSubtitleChange?.(id === "__off__" ? null : id);
                setTrackMenu(null);
              }}
              footer={
                onSubtitlesSearch
                  ? {
                      label: "Load subtitles online…",
                      onClick: () => {
                        setTrackMenu(null);
                        onSubtitlesSearch();
                      },
                    }
                  : undefined
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

function TrackMenuPopover({
  title,
  emptyText,
  items,
  onSelect,
  footer,
  inline = false,
}: {
  title: string;
  emptyText: string;
  items: TrackMenuItem[];
  onSelect: (id: string) => void;
  footer?: { label: string; onClick: () => void };
  /** In-flow (strip mode) — grows the control strip instead of floating. */
  inline?: boolean;
}) {
  return (
    <div
      className={
        inline
          ? "w-full max-w-[360px] max-h-[260px] overflow-y-auto bg-[#16161A] border border-white/10 rounded-xl shadow-2xl py-1.5"
          : "absolute bottom-full right-0 mb-2 min-w-[220px] max-h-[300px] overflow-y-auto bg-[#16161A] border border-white/10 rounded-xl shadow-2xl py-1.5 z-30"
      }
    >
      <p className="px-3.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-white/35">
        {title}
      </p>
      {items.length === 0 && (
        <p className="px-3.5 py-2 text-xs text-white/35">{emptyText}</p>
      )}
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={`w-full text-left flex items-center justify-between gap-3 px-3.5 py-2 text-xs transition-colors ${
            item.active
              ? "text-[#D4A237] font-semibold"
              : "text-white/70 hover:bg-white/[0.05]"
          }`}
        >
          <span className="truncate">{item.label}</span>
          {item.active && <Check size={13} className="shrink-0" />}
        </button>
      ))}
      {footer && (
        <button
          onClick={footer.onClick}
          className="w-full flex items-center gap-2 px-3.5 py-2 mt-1 text-xs font-semibold text-[#D4A237] hover:bg-white/[0.05] border-t border-white/[0.06]"
        >
          <Search size={12} />
          {footer.label}
        </button>
      )}
    </div>
  );
}
