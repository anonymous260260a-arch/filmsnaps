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
import { Play, Pause, Loader2, Sun, Volume2, ChevronLeft } from "lucide-react";
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
  /** Currently active track ids — drive the active marker in the quick menus. */
  currentAudioTrackId?: string;
  currentSubtitleTrackId?: string;
  /** Open the online-subtitle search (mpv). Presence enables the CC menu item. */
  onSubtitlesSearch?: () => void;
  className?: string;
  /** Source info text shown in the top-left (e.g. "1080p · H264 · HDHub") */
  sourceLabel?: string;
  /** Switching indicator label (e.g. "Trying source 2 of 5 — 1080p") */
  switchingLabel?: string;
  /** Open the source picker */
  onSourcePicker?: () => void;
  /** Show a back button (player-screen takeover) — leaves the player screen. */
  onBack?: () => void;
  /** "strip" = flex column (mpv native window); "overlay" = absolute (HTML video) */
  layout?: "strip" | "overlay";
  /** Ref forwarded to the video region div (mpv mode — measured for native window bounds) */
  videoRegionRef?: React.Ref<HTMLDivElement>;
  /** Native video surface (mpv): controls sit in a dedicated strip below the
   *  video window, so they must never auto-hide into an untouchable area. */
  alwaysShowControls?: boolean;
  /** Fired when an HTML overlay opens/closes over the video (settings panel).
   *  Native-window decoders (mpv) use this to hide the video window. */
  onOverlayChange?: (open: boolean) => void;
  /** Bind useKeyboardShortcuts inside ControlBar (K/J/L/arrows/M/F on the
   *  adapter). Desktop mpv passes false — useMpvDesktopShortcuts already owns
   *  those keys and double-binding made one press act twice. Default true. */
  keyboardEnabled?: boolean;
  /** Gate the Space tap/hold + long-press speed boost (mpv passes false while
   *  a picker/search/error overlay is open). Default true. */
  speedBoostEnabled?: boolean;
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
  currentAudioTrackId,
  currentSubtitleTrackId,
  onSubtitlesSearch,
  className = "",
  sourceLabel,
  switchingLabel,
  onSourcePicker,
  onBack,
  alwaysShowControls,
  onOverlayChange,
  keyboardEnabled = true,
  speedBoostEnabled = true,
  layout = "overlay",
  videoRegionRef,
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

  const forceVisible =
    isSeeking || isSettingsOpen || !isPlaying || alwaysShowControls;
  const { visible: controlsVisible, show: showControls } = useAutoHideControls(
    3200,
    forceVisible,
  );

  useEffect(() => {
    onOverlayChange?.(isSettingsOpen);
  }, [isSettingsOpen, onOverlayChange]);

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

  const { isBoosted, longPressHandlers: rawLongPressHandlers } = useSpeedBoost({
    player: player as PlayerAdapter,
    normalRate: player?.getPlaybackRate() ?? 1,
    boostRate: 2,
    enabled: !!player && speedBoostEnabled,
  });

  // Releasing a long-press speed boost also fires a click — which must not
  // register as a click-to-pause (desktop). Track boost state in a ref and
  // suppress the next click for a short window after a boosted release.
  const isBoostedRef = useRef(false);
  isBoostedRef.current = isBoosted;
  const suppressClickUntilRef = useRef(0);
  const longPressHandlers: typeof rawLongPressHandlers = {
    ...rawLongPressHandlers,
    onPointerUp: (e) => {
      if (isBoostedRef.current) {
        suppressClickUntilRef.current = Date.now() + 600;
      }
      rawLongPressHandlers.onPointerUp(e);
    },
  };

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

  // Desktop pointers get YouTube click semantics: single click = play/pause,
  // double click = fullscreen. Touch keeps mobile semantics (double-tap side
  // zones to seek, single tap toggles controls). Evaluated once — the player
  // never changes pointer environment mid-session.
  const desktopPointerRef = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches,
  );

  const handleToggleFullscreen = useCallback(() => {
    if (!player) return;
    player.requestFullscreen?.();
    showControls();
  }, [player, showControls]);

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
      onDoubleCenter: desktopPointerRef.current
        ? handleToggleFullscreen
        : handlePlayPause,
      // Desktop: single click toggles play/pause (YouTube). Touch: single tap
      // just reveals the controls. A click following a long-press speed boost
      // is suppressed so releasing the boost doesn't pause playback.
      onSingle: () => {
        if (Date.now() < suppressClickUntilRef.current) return;
        if (desktopPointerRef.current) handlePlayPause();
        else showControls();
      },
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
      className={`${layout === "strip" ? "flex h-full flex-col" : "absolute inset-0"} select-none ${className}`}
      onMouseMove={showControls}
      onContextMenu={handleContextMenu}
    >
      {/* Video surface — in strip mode this is the measured region for native window bounds */}
      <div
        ref={layout === "strip" ? videoRegionRef : undefined}
        className={
          layout === "strip"
            ? "relative min-h-0 flex-1 bg-black"
            : "absolute inset-0"
        }
      >
        {children}

        {/* Back button (player-screen takeover) — top-left, always reachable.
            Sits in the video surface layer; the ControlBar's source badge
            renders in the control-bar container, so they don't collide. */}
        {onBack && (
          <button
            onClick={onBack}
            className="absolute left-3 top-3 z-30 flex items-center justify-center w-9 h-9 rounded-full bg-black/60 border border-white/15 text-white/80 hover:text-white hover:bg-black/80 transition-all active:scale-95"
            aria-label="Back"
          >
            <ChevronLeft size={18} />
          </button>
        )}

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
          {isBuffering && !switchingLabel && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-black/50 rounded-full p-4 animate-[fadeIn_0.2s_ease-out]">
                <Loader2 size={32} className="text-[#D4A237] animate-spin" />
              </div>
            </div>
          )}

          {/* Switching indicator pill */}
          {switchingLabel && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
              <div className="flex items-center gap-2 bg-black/80 border border-white/10 rounded-full px-4 py-2 animate-[fadeIn_0.15s_ease-out]">
                <Loader2 size={14} className="text-[#D4A237] animate-spin" />
                <span className="text-xs font-semibold text-white max-w-[80%] truncate">
                  {switchingLabel}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Control bar — outside video region so it has natural height in strip mode */}
      {player && (
        <div
          data-mpv-control-bar
          className={
            layout === "strip"
              ? "relative shrink-0 border-t border-white/10 bg-black z-20"
              : `absolute inset-x-0 bottom-0 z-20 transition-opacity duration-300 ${
                  controlsVisible
                    ? "opacity-100"
                    : "opacity-0 pointer-events-none"
                }`
          }
        >
          <ControlBar
            layout={layout}
            player={player}
            qualities={qualities}
            audioTracks={audioTracks}
            subtitleTracks={subtitleTracks}
            onQualityChange={onQualityChange}
            onAudioTrackChange={onAudioTrackChange}
            onSubtitleChange={onSubtitleChange}
            currentAudioTrackId={currentAudioTrackId}
            currentSubtitleTrackId={currentSubtitleTrackId}
            onSubtitlesSearch={onSubtitlesSearch}
            onSeekingChange={setIsSeeking}
            onSettingsOpenChange={setIsSettingsOpen}
            keyboardEnabled={keyboardEnabled}
            sourceLabel={sourceLabel}
            onSourcePicker={onSourcePicker}
            badgePosition={alwaysShowControls ? "row" : "top"}
            isBuffering={isBuffering}
            switchingLabel={switchingLabel}
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
