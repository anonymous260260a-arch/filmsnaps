/**
 * PlayerOverlay — YouTube-style interaction state machine & controls overlay.
 *
 * Features:
 * - Interaction state machine: WATCHING, CONTROLS_VISIBLE, SEEKING, MENU_OPEN, BUFFERING, PAUSED.
 * - Single tap vs Double tap disambiguation via RNGH Gesture.Exclusive.
 * - Single tap toggles controls overlay visibility without accidental seeking.
 * - Double tap left/right (40% zones) triggers cumulative seeking (-10s, -20s, +10s, +20s).
 * - Long press (300ms) triggers temporary 2x playback speed with top pill indicator.
 * - Zero haptics across all interactions.
 * - LinearGradient top and bottom shadow fades for 100% legibility.
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../theme/colors";
import type { PlayerAdapter } from "./types";
import type { SubtitleSearchQuery } from "../../lib/subtitleSearch";
import { ProgressBar } from "./ProgressBar";
import { AudioTrackSheet } from "./AudioTrackSheet";
import { SubtitleSheet, markSubtitleSheetRequested } from "./SubtitleSheet";
import { PlayerSettingsSheet } from "./PlayerSettingsSheet";
import { DoubleTapRippleOverlay } from "./DoubleTapRippleOverlay";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export type OverlayState =
  | "WATCHING"
  | "CONTROLS_VISIBLE"
  | "SEEKING"
  | "MENU_OPEN"
  | "BUFFERING"
  | "PAUSED";

interface PlayerOverlayProps {
  player: PlayerAdapter;
  title?: string;
  backdropUrl?: string;
  isFullscreen: boolean;
  /** Label shown on the source pill (e.g. "1080p · MP4 · MULTI"). */
  sourceLabel?: string;
  /** True until the current source delivers its first frames — hides the
   *  center play/seek controls so the loading indicator is unobstructed. */
  isStreamLoading?: boolean;
  /** Non-null while switching sources — shows a pill with this label. */
  switchingLabel?: string | null;
  /** True while an error/exhausted card is up — hides the controls layer. */
  overlaySuppressed?: boolean;
  /** Detail line under the buffering spinner (which source, verified count). */
  loadingDetail?: string;
  /** Non-null inside a Skip Intro/Recap window — shows the skip button. */
  skipLabel?: string | null;
  onSkipSegment?: () => void;
  /** Fired when the user manually picks an audio track (disables auto-select). */
  onAudioTrackSelected?: () => void;
  /** Series identity for persisting the subtitle sync offset. Omit = don't persist. */
  subtitleKey?: string;
  /** Enables the "Load subtitles online" section in the subtitle sheet. */
  subtitleOnlineSearch?: SubtitleSearchQuery;
  /** Called when user taps the source pill. Omit to hide the pill. */
  onSourcePicker?: () => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
  /** Embedded mode: hide the back button — the host watch page provides close. */
  hideBack?: boolean;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "0:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function PlayerOverlay({
  player,
  title = "",
  backdropUrl,
  isFullscreen,
  sourceLabel,
  isStreamLoading = false,
  switchingLabel = null,
  overlaySuppressed = false,
  loadingDetail = "",
  skipLabel = null,
  onSkipSegment,
  onAudioTrackSelected,
  subtitleKey,
  subtitleOnlineSearch,
  onSourcePicker,
  onToggleFullscreen,
  onClose,
  hideBack = false,
}: PlayerOverlayProps) {
  const insets = useSafeAreaInsets();
  const [isPaused, setIsPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isBuffering, setIsBuffering] = useState(true);
  const [showRemainingTime, setShowRemainingTime] = useState(false);

  // Sheets state (MENU_OPEN)
  const [showAudioSheet, setShowAudioSheet] = useState(false);
  const [showSubtitleSheet, setShowSubtitleSheet] = useState(false);
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);

  // CC button beside fullscreen: show when there's anything to pick
  // (embedded tracks or online search); gold while a track is active.
  const subtitleTracks = player.getSubtitleTracks();
  const subtitleButtonVisible =
    subtitleTracks.length > 0 || !!subtitleOnlineSearch;
  const subtitleSelected = player.getSelectedSubtitleTrackId?.() != null;

  // Freeze time-driven re-renders while a sheet is open: the sheets sit on
  // top, and 4 Hz state updates under a Modal made the sheet feel laggy.
  // Time display values resume from live updates when the sheet closes.
  const anySheetOpenRef = useRef(false);
  anySheetOpenRef.current =
    showAudioSheet || showSubtitleSheet || showSettingsSheet;

  const closeAudioSheet = useCallback(() => setShowAudioSheet(false), []);
  const closeSubtitleSheet = useCallback(() => setShowSubtitleSheet(false), []);
  const closeSettingsSheet = useCallback(() => setShowSettingsSheet(false), []);

  // Interaction State Machine
  const [overlayState, setOverlayState] =
    useState<OverlayState>("CONTROLS_VISIBLE");
  const overlayOpacity = useSharedValue(1);
  const autoHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 2X Speed Hold state
  const [is2xSpeedActive, setIs2xSpeedActive] = useState(false);

  // Control lock (pocket viewing) — freezes every gesture; only the unlock
  // affordance stays tappable.
  const [isLocked, setIsLocked] = useState(false);
  const isLockedRef = useRef(false);
  isLockedRef.current = isLocked;

  // Multi-tap double tap seek state
  const [doubleTapSide, setDoubleTapSide] = useState<"left" | "right" | null>(
    null,
  );
  const [doubleTapCount, setDoubleTapCount] = useState(0);
  const doubleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset playback timing when player changes (new source loaded)
  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setIsBuffering(true);
    setIsPaused(true);
  }, [player]);

  // ── Optimistic Seek Lock State Machine ──
  // Prevents stale timeUpdate events from causing the progress bar to rubber-band / bounce-back
  const isSeekLockedRef = useRef(false);
  const targetSeekTimeRef = useRef(0);
  const seekLockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const releaseSeekLock = useCallback(() => {
    isSeekLockedRef.current = false;
    setIsBuffering(false);
    if (seekLockTimeoutRef.current) {
      clearTimeout(seekLockTimeoutRef.current);
      seekLockTimeoutRef.current = null;
    }
  }, []);

  const acquireSeekLock = useCallback((seekTime: number) => {
    isSeekLockedRef.current = true;
    targetSeekTimeRef.current = seekTime;
    setCurrentTime(seekTime);
    setIsBuffering(true);

    if (seekLockTimeoutRef.current) clearTimeout(seekLockTimeoutRef.current);
    // Safety release after 6s in case remote network stream takes time to buffer new chunk
    seekLockTimeoutRef.current = setTimeout(() => {
      isSeekLockedRef.current = false;
      setIsBuffering(false);
    }, 6000);
  }, []);

  // ── Auto-hide timer control (2.8s) ──
  const scheduleAutoHide = useCallback(() => {
    if (autoHideTimer.current) clearTimeout(autoHideTimer.current);

    autoHideTimer.current = setTimeout(() => {
      if (
        !player.isPaused() &&
        !showAudioSheet &&
        !showSubtitleSheet &&
        !showSettingsSheet
      ) {
        overlayOpacity.value = withTiming(0, { duration: 250 }, (finished) => {
          if (finished) {
            runOnJS(setOverlayState)("WATCHING");
          }
        });
      }
    }, 2800);
  }, [
    player,
    showAudioSheet,
    showSubtitleSheet,
    showSettingsSheet,
    overlayOpacity,
  ]);

  const resetInteractionTimer = useCallback(() => {
    if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
    overlayOpacity.value = withTiming(1, { duration: 180 });
    setOverlayState((prev) =>
      prev === "WATCHING" ? "CONTROLS_VISIBLE" : prev,
    );

    if (
      !player.isPaused() &&
      !showAudioSheet &&
      !showSubtitleSheet &&
      !showSettingsSheet
    ) {
      scheduleAutoHide();
    }
  }, [
    player,
    showAudioSheet,
    showSubtitleSheet,
    showSettingsSheet,
    overlayOpacity,
    scheduleAutoHide,
  ]);

  // ── State Machine Synchronization ──
  useEffect(() => {
    if (isLockedRef.current) return; // controls stay hidden while locked
    if (isPaused) {
      setOverlayState("PAUSED");
      overlayOpacity.value = withTiming(1, { duration: 180 });
      if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
    } else if (showAudioSheet || showSubtitleSheet || showSettingsSheet) {
      setOverlayState("MENU_OPEN");
      overlayOpacity.value = withTiming(1, { duration: 180 });
      if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
    } else {
      setOverlayState("CONTROLS_VISIBLE");
      scheduleAutoHide();
    }
  }, [
    isPaused,
    showAudioSheet,
    showSubtitleSheet,
    showSettingsSheet,
    overlayOpacity,
    scheduleAutoHide,
  ]);

  // ── Subscribe to player events with Seek Lock filter ──
  useEffect(() => {
    const unsubs = [
      player.onTimeUpdate((time, dur) => {
        if (anySheetOpenRef.current) return;
        if (Number.isFinite(dur) && dur > 0) {
          setDuration(dur);
        }
        if (isSeekLockedRef.current) {
          const target = targetSeekTimeRef.current;
          const diff = Math.abs(time - target);
          const isLanded =
            target <= 10
              ? time >= 0 && time <= 20
              : time > 2.0 && (diff <= 60 || time >= target - 30);
          if (isLanded) {
            releaseSeekLock();
            setCurrentTime(time);
          }
        } else {
          setCurrentTime(time);
        }
      }),
      player.onPlayPause((paused) => {
        setIsPaused(paused);
      }),
      player.onBuffering((buf) => {
        setIsBuffering(buf);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [player, releaseSeekLock]);

  useEffect(() => {
    return () => {
      if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
      if (doubleTapTimer.current) clearTimeout(doubleTapTimer.current);
      if (seekDebounceTimer.current) clearTimeout(seekDebounceTimer.current);
      if (seekLockTimeoutRef.current) clearTimeout(seekLockTimeoutRef.current);
    };
  }, []);

  // ── 2X Speed hold callbacks ──
  const handleStart2xSpeed = useCallback(() => {
    if (isLockedRef.current) return;
    player.setPlaybackRate(2.0);
    setIs2xSpeedActive(true);
  }, [player]);

  const handleStop2xSpeed = useCallback(() => {
    player.setPlaybackRate(1.0);
    setIs2xSpeedActive(false);
  }, [player]);

  // ── Multi-tap cumulative seek (-10s / +10s) ──
  const handleSideDoubleTap = useCallback(
    (side: "left" | "right") => {
      if (isLockedRef.current) return;
      // If controls are already open, refresh the auto-hide timer; DO NOT reveal controls if user is watching!
      if (overlayState !== "WATCHING") {
        scheduleAutoHide();
      }

      const delta = side === "left" ? -10 : 10;
      const current = isSeekLockedRef.current
        ? targetSeekTimeRef.current
        : player.getCurrentTime();
      const newTarget = Math.max(
        0,
        Math.min(duration > 0 ? duration : 99999, current + delta),
      );

      acquireSeekLock(newTarget);

      // Debounce the native seek so rapid taps (+10s, +20s, +30s) don't trigger repeated buffer aborts
      if (seekDebounceTimer.current) clearTimeout(seekDebounceTimer.current);
      seekDebounceTimer.current = setTimeout(() => {
        player.seek(newTarget);
      }, 250);

      setDoubleTapSide(side);
      setDoubleTapCount((prev) => (doubleTapSide === side ? prev + 10 : 10));

      if (doubleTapTimer.current) clearTimeout(doubleTapTimer.current);
      doubleTapTimer.current = setTimeout(() => {
        setDoubleTapSide(null);
        setDoubleTapCount(0);
      }, 650);
    },
    [
      player,
      duration,
      overlayState,
      scheduleAutoHide,
      doubleTapSide,
      acquireSeekLock,
    ],
  );

  // ── Single Tap (Show/Hide Controls) ──
  const handleSingleTap = useCallback(() => {
    if (isLockedRef.current) return;
    if (overlayState === "WATCHING") {
      overlayOpacity.value = withTiming(1, { duration: 200 });
      setOverlayState("CONTROLS_VISIBLE");
      scheduleAutoHide();
    } else {
      overlayOpacity.value = withTiming(0, { duration: 220 }, (finished) => {
        if (finished) {
          runOnJS(setOverlayState)("WATCHING");
        }
      });
      if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
    }
  }, [overlayState, overlayOpacity, scheduleAutoHide]);

  // ── Control lock actions ──
  const handleLock = useCallback(() => {
    setIsLocked(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
    overlayOpacity.value = withTiming(0, { duration: 200 }, (finished) => {
      if (finished) {
        runOnJS(setOverlayState)("WATCHING");
      }
    });
  }, [overlayOpacity]);

  const handleUnlock = useCallback(() => {
    setIsLocked(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    overlayOpacity.value = withTiming(1, { duration: 180 });
    setOverlayState("CONTROLS_VISIBLE");
    scheduleAutoHide();
  }, [overlayOpacity, scheduleAutoHide]);

  // ── RNGH Gestures ──
  // Long Press for 2X Speed
  const longPressGesture = Gesture.LongPress()
    .minDuration(300)
    .onStart(() => {
      runOnJS(handleStart2xSpeed)();
    })
    .onFinalize(() => {
      runOnJS(handleStop2xSpeed)();
    });

  // Double Tap gesture
  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(280)
    .onEnd((e) => {
      const tapX = e.x;
      const threshold = SCREEN_WIDTH * 0.4;
      if (tapX < threshold) {
        runOnJS(handleSideDoubleTap)("left");
      } else if (tapX > SCREEN_WIDTH - threshold) {
        runOnJS(handleSideDoubleTap)("right");
      } else {
        runOnJS(handleSideDoubleTap)("right");
      }
    });

  // Single Tap gesture
  const singleTapGesture = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => {
      runOnJS(handleSingleTap)();
    });

  const exclusiveTapGesture = Gesture.Exclusive(
    doubleTapGesture,
    singleTapGesture,
  );
  const composedGestures = Gesture.Simultaneous(
    longPressGesture,
    exclusiveTapGesture,
  );

  // ── Control Actions ──
  const togglePlayPause = useCallback(() => {
    if (player.isPaused()) {
      player.play();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } else {
      player.pause();
    }
    resetInteractionTimer();
  }, [player, resetInteractionTimer]);

  const seekForward = useCallback(() => {
    const current = isSeekLockedRef.current
      ? targetSeekTimeRef.current
      : player.getCurrentTime();
    const target = Math.min(duration > 0 ? duration : 99999, current + 10);
    acquireSeekLock(target);
    player.seek(target);
    resetInteractionTimer();
  }, [player, duration, acquireSeekLock, resetInteractionTimer]);

  const seekBackward = useCallback(() => {
    const current = isSeekLockedRef.current
      ? targetSeekTimeRef.current
      : player.getCurrentTime();
    const target = Math.max(0, current - 10);
    acquireSeekLock(target);
    player.seek(target);
    resetInteractionTimer();
  }, [player, acquireSeekLock, resetInteractionTimer]);

  const handleSeek = useCallback(
    (time: number) => {
      acquireSeekLock(time);
      player.seek(time);
      resetInteractionTimer();
    },
    [player, acquireSeekLock, resetInteractionTimer],
  );

  const handleScrubStart = useCallback(() => {
    setOverlayState("SEEKING");
    if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
  }, []);

  const handleScrubEnd = useCallback(() => {
    setOverlayState("CONTROLS_VISIBLE");
    scheduleAutoHide();
  }, [scheduleAutoHide]);

  const animatedOverlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const paddingTop = isFullscreen ? 8 : insets.top;
  const paddingBottom = isFullscreen ? 8 : insets.bottom;

  const formattedCurrentTime = formatTime(currentTime);
  const formattedDuration = formatTime(duration);
  const remainingTimeStr = formatTime(Math.max(0, duration - currentTime));

  const timeDisplayStr = showRemainingTime
    ? `${formattedCurrentTime} / -${remainingTimeStr}`
    : `${formattedCurrentTime} / ${formattedDuration}`;

  const isControlsVisible = overlayState !== "WATCHING";

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
      {/* ── Gesture Layer (Layer 2) ── */}
      <GestureDetector gesture={composedGestures}>
        <View style={styles.gestureSurface} collapsable={false}>
          {/* Multi-Tap Seek Arc Overlay */}
          <DoubleTapRippleOverlay
            side={doubleTapSide}
            seekAmount={doubleTapCount}
          />

          {/* 2X Speed Indicator Pill */}
          {is2xSpeedActive && (
            <View
              style={[styles.speed2xPill, { top: paddingTop + 16 }]}
              pointerEvents="none"
            >
              <Ionicons name="flash" size={13} color={colors.gold} />
              <Text style={styles.speed2xText}>2X SPEED</Text>
            </View>
          )}

          {/* Center loading states — mutually exclusive, always unobstructed:
              switching pill while changing sources, plain spinner otherwise */}
          {switchingLabel ? (
            <View style={styles.switchingOverlay} pointerEvents="none">
              <View style={styles.switchingPill}>
                <ActivityIndicator size="small" color={colors.gold} />
                <Text style={styles.switchingText} numberOfLines={1}>
                  {switchingLabel}
                </Text>
              </View>
            </View>
          ) : isBuffering ? (
            <View style={styles.bufferingIndicator} pointerEvents="none">
              <ActivityIndicator size="large" color={colors.gold} />
              {loadingDetail ? (
                <Text style={styles.loadingDetail}>{loadingDetail}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </GestureDetector>

      {/* ── Controls Overlay (Layer 3) ── */}
      {isControlsVisible && !overlaySuppressed && (
        <Animated.View
          style={[styles.controlsOverlay, animatedOverlayStyle]}
          pointerEvents={isControlsVisible ? "box-none" : "none"}
        >
          {/* Top Bar Area — contains back/title on left, and source/audio/settings on top right */}
          <LinearGradient
            colors={["rgba(0,0,0,0.85)", "rgba(0,0,0,0.4)", "transparent"]}
            style={[styles.topBarGradient, { paddingTop: paddingTop + 8 }]}
            pointerEvents="box-none"
          >
            <View style={styles.topBar}>
              {!hideBack && !isFullscreen && (
                <TouchableOpacity
                  onPress={onClose}
                  style={styles.iconButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Close player"
                >
                  <Ionicons
                    name="chevron-back"
                    size={24}
                    color={colors.textPrimary}
                  />
                </TouchableOpacity>
              )}

              {title ? (
                <Text style={styles.title} numberOfLines={1}>
                  {title}
                </Text>
              ) : null}

              <View style={styles.topRightRow}>
                {onSourcePicker && sourceLabel && (
                  <TouchableOpacity
                    onPress={onSourcePicker}
                    style={styles.sourcePill}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Current source: ${sourceLabel}. Open source list`}
                  >
                    <Ionicons
                      name="server-outline"
                      size={12}
                      color={colors.gold}
                    />
                    <Text style={styles.sourcePillText} numberOfLines={1}>
                      {sourceLabel}
                    </Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  onPress={() => setShowAudioSheet(true)}
                  style={styles.iconButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Audio tracks"
                >
                  <Ionicons
                    name="musical-notes-outline"
                    size={20}
                    color={colors.textPrimary}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setShowSettingsSheet(true)}
                  style={styles.iconButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Playback settings"
                >
                  <Ionicons
                    name="options-outline"
                    size={20}
                    color={colors.textPrimary}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleLock}
                  style={styles.iconButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Lock controls"
                >
                  <Ionicons
                    name="lock-closed-outline"
                    size={18}
                    color={colors.textPrimary}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </LinearGradient>

          {/* Center Playback Area — hidden while the stream is loading so the
              buffering/switching indicator is never covered by buttons */}
          {!isStreamLoading && (
            <View style={styles.centerControls} pointerEvents="box-none">
              <TouchableOpacity
                onPress={seekBackward}
                style={styles.seekButton}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Rewind 10 seconds"
              >
                <MaterialIcons
                  name="replay-10"
                  size={38}
                  color={colors.textPrimary}
                />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={togglePlayPause}
                style={styles.playButton}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={isPaused ? "Play" : "Pause"}
              >
                <View style={styles.playButtonInner}>
                  {isBuffering ? (
                    <ActivityIndicator size="small" color="#0B0B0E" />
                  ) : (
                    <Ionicons
                      name={isPaused ? "play" : "pause"}
                      size={36}
                      color="#0B0B0E"
                      style={{ marginLeft: isPaused ? 4 : 0 }}
                    />
                  )}
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={seekForward}
                style={styles.seekButton}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Forward 10 seconds"
              >
                <MaterialIcons
                  name="forward-10"
                  size={38}
                  color={colors.textPrimary}
                />
              </TouchableOpacity>
            </View>
          )}

          {/* Bottom Area — YouTube-style: time + fullscreen ABOVE the timeline */}
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.55)", "rgba(0,0,0,0.92)"]}
            style={[
              styles.bottomBarGradient,
              { paddingBottom: paddingBottom + 8 },
            ]}
            pointerEvents="box-none"
          >
            {/* Time + Fullscreen row */}
            <View style={styles.timeRow}>
              <TouchableOpacity
                onPress={() => setShowRemainingTime((prev) => !prev)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Toggle remaining time display"
              >
                <Text style={styles.timeText}>{timeDisplayStr}</Text>
              </TouchableOpacity>

              <View
                style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
              >
                {subtitleButtonVisible && (
                  <TouchableOpacity
                    onPress={() => {
                      markSubtitleSheetRequested();
                      setShowSubtitleSheet(true);
                    }}
                    style={styles.iconButton}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Subtitles"
                  >
                    <Ionicons
                      name="logo-closed-captioning"
                      size={20}
                      color={
                        subtitleSelected ? colors.gold : colors.textPrimary
                      }
                    />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={onToggleFullscreen}
                  style={styles.iconButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
                  }
                >
                  <Ionicons
                    name={isFullscreen ? "contract-outline" : "expand-outline"}
                    size={20}
                    color={colors.textPrimary}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Timeline Progress Bar */}
            <ProgressBar
              currentTime={currentTime}
              duration={duration}
              backdropUrl={backdropUrl}
              onSeek={handleSeek}
              onScrubStart={handleScrubStart}
              onScrubEnd={handleScrubEnd}
            />
          </LinearGradient>
        </Animated.View>
      )}

      {/* Skip Intro/Recap — stays tappable even when the controls are hidden */}
      {skipLabel && onSkipSegment && !overlaySuppressed && !isLocked && (
        <TouchableOpacity
          style={[styles.skipSegmentBtn, { bottom: paddingBottom + 96 }]}
          onPress={onSkipSegment}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={skipLabel}
        >
          <Ionicons name="play-skip-forward" size={15} color={colors.gold} />
          <Text style={styles.skipSegmentText}>{skipLabel}</Text>
        </TouchableOpacity>
      )}

      {/* Unlock affordance — the only control that responds while locked */}
      {isLocked && (
        <TouchableOpacity
          style={styles.unlockButton}
          onPress={handleUnlock}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Unlock controls"
        >
          <Ionicons name="lock-open-outline" size={18} color={colors.gold} />
        </TouchableOpacity>
      )}

      {/* Settings & Option Sheets */}
      <AudioTrackSheet
        visible={showAudioSheet}
        player={player}
        onSelectTrack={onAudioTrackSelected}
        onClose={closeAudioSheet}
      />
      <SubtitleSheet
        visible={showSubtitleSheet}
        player={player}
        storageKey={subtitleKey}
        onlineSearch={subtitleOnlineSearch}
        onClose={closeSubtitleSheet}
      />
      <PlayerSettingsSheet
        visible={showSettingsSheet}
        player={player}
        sourceLabel={sourceLabel}
        onOpenAudioSheet={() => setShowAudioSheet(true)}
        onOpenSubtitleSheet={() => setShowSubtitleSheet(true)}
        onOpenSourcePicker={onSourcePicker}
        onClose={closeSettingsSheet}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gestureSurface: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    zIndex: 20,
  },
  topBarGradient: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    marginHorizontal: 12,
  },
  topRightRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    marginLeft: "auto",
  },
  sourcePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: 14,
    paddingHorizontal: 10,
    height: 28,
    borderWidth: 1,
    borderColor: "rgba(212,162,55,0.3)",
  },
  sourcePillText: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "600",
    maxWidth: 75,
  },
  centerControls: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 36,
  },
  seekButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(14, 14, 18, 0.55)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  playButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  playButtonInner: {
    alignItems: "center",
    justifyContent: "center",
  },
  bottomBarGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 8,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  timeText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  switchingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  switchingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(0,0,0,0.8)",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    maxWidth: "86%",
  },
  switchingText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  bufferingIndicator: {
    position: "absolute",
    alignSelf: "center",
    top: "50%",
    marginTop: -20,
  },
  speed2xPill: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(14, 14, 17, 0.92)",
    borderColor: "rgba(212, 162, 55, 0.5)",
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    zIndex: 40,
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  speed2xText: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  loadingDetail: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 12,
    textAlign: "center",
  },
  skipSegmentBtn: {
    position: "absolute",
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(14, 14, 17, 0.92)",
    borderColor: "rgba(212, 162, 55, 0.4)",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
    zIndex: 40,
    elevation: 8,
  },
  skipSegmentText: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: "700",
  },
  unlockButton: {
    position: "absolute",
    top: 70,
    right: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(14, 14, 17, 0.6)",
    borderWidth: 1,
    borderColor: "rgba(212, 162, 55, 0.4)",
    zIndex: 40,
    elevation: 8,
  },
});
