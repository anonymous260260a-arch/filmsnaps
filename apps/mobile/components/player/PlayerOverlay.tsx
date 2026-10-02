/**
 * PlayerOverlay — modern direct-player controls chrome over the gesture layer.
 *
 * Features:
 * - Interaction state machine: WATCHING, CONTROLS_VISIBLE, SEEKING, MENU_OPEN, BUFFERING, PAUSED.
 * - Single tap vs Double tap disambiguation via RNGH Gesture.Exclusive.
 * - Double tap left/right (40% zones) cumulative seeking, long-press 2x hold.
 * - Top bar: close · title · AUDIO · SOURCE · SUBS · FULLSCREEN (portrait) / ⋮ (fullscreen).
 * - Lock is fullscreen/landscape-only (pocket-watch scenario) with a11y alternative via ⋮.
 * - ⋮ menu sheet: playback speed, audio language, screen fit.
 * - Zero layout jump: buffering spinner replaces the play icon in place.
 * - LinearGradient top/bottom scrims; all fades use shared constants.
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  useWindowDimensions,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { LinearGradient } from "expo-linear-gradient";
import {
  Ionicons,
  MaterialIcons,
  MaterialCommunityIcons,
} from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../theme/colors";
import type { PlayerAdapter } from "./types";
import type { SubtitleSearchQuery } from "../../lib/subtitleSearch";
import { ProgressBar } from "./ProgressBar";
import { AudioTrackSheet } from "./AudioTrackSheet";
import { SubtitleSheet, type SidecarSubtitle } from "./SubtitleSheet";
import type { AutoSyncSourceInfo } from "./AutoSyncButton";
import { PlayerSettingsSheet } from "./PlayerSettingsSheet";
import { DoubleTapRippleOverlay } from "./DoubleTapRippleOverlay";
import { audioTrackTitle, audioChipLabel } from "../../lib/audioLanguage";
import { trackFeatureUsed, trackSeekLatency } from "../../lib/telemetry";
import { useSettings } from "../../lib/settings";
import type { IntroDbResponse } from "../../lib/introDetect";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

/** Single source of truth for chrome motion — replaces the 180/220/250/300 zoo. */
const CHROME_FADE_MS = 200;
const CHROME_AUTO_HIDE_MS = 3000;

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
  /** introdb segments for this episode — draws the skip window notch on the track. */
  introSegments?: IntroDbResponse | null;
  /** Non-null inside a Skip Intro/Recap window — shows the skip button. */
  skipLabel?: string | null;
  onSkipSegment?: () => void;
  /** Fired when the user manually picks an audio track (disables auto-select). */
  onAudioTrackSelected?: () => void;
  /** Series identity for persisting the subtitle sync offset. Omit = don't persist. */
  subtitleKey?: string;
  /** Enables the "Load subtitles online" section in the subtitle sheet. */
  subtitleOnlineSearch?: SubtitleSearchQuery;
  /** Subtitle files shipped with the active stream ("With this source"). */
  subtitleSidecars?: SidecarSubtitle[];
  /** Enables the Auto Sync button in the subtitle sheet. */
  autoSync?: {
    contentId: string;
    sourceInfo: () => AutoSyncSourceInfo;
    getDefaultSubtitleUri?: () => string | null;
  };
  /** Called when user taps the source pill. Omit to hide the pill. */
  onSourcePicker?: () => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
  /** Embedded mode: hide the back button — the host watch page provides close. */
  hideBack?: boolean;
  /** Announcements for TalkBack/VoiceOver (source switched, resumed, etc). */
  liveAnnouncement?: string | null;
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
  introSegments = null,
  skipLabel = null,
  onSkipSegment,
  onAudioTrackSelected,
  subtitleKey,
  subtitleOnlineSearch,
  subtitleSidecars,
  autoSync,
  onSourcePicker,
  onToggleFullscreen,
  onClose,
  hideBack = false,
  liveAnnouncement = null,
}: PlayerOverlayProps) {
  const insets = useSafeAreaInsets();
  const { settings, updateSetting } = useSettings();
  const [isPaused, setIsPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  // Ref mirror of the displayed position. Seek gestures (double-tap, ±10s
  // buttons) base their math on this instead of player.getCurrentTime():
  // the native position lags behind pending seeks/buffering on network
  // streams, so "+10" computed from it could land BEHIND what the user is
  // looking at (reported as "double right does -10").
  const currentTimeRef = useRef(0);
  const applyTime = useCallback((t: number) => {
    currentTimeRef.current = t;
    setCurrentTime(t);
  }, []);
  const [duration, setDuration] = useState(0);
  const [bufferedPosition, setBufferedPosition] = useState(0);
  const [isBuffering, setIsBuffering] = useState(true);
  const [showRemainingTime, setShowRemainingTime] = useState(false);

  // Sheets state (MENU_OPEN)
  const [showAudioSheet, setShowAudioSheet] = useState(false);
  const [showSubtitleSheet, setShowSubtitleSheet] = useState(false);
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);

  // ── Chrome context ──
  const audioTracks = player.getAudioTracks();
  const selectedAudioId = player.getSelectedAudioTrackId?.() ?? null;
  const selectedAudio = audioTracks.find((t) => t.id === selectedAudioId);
  const audioChip = selectedAudio
    ? audioChipLabel(
        audioTrackTitle(
          selectedAudio,
          audioTracks.findIndex((t) => t.id === selectedAudioId),
        ),
      )
    : null;
  const subtitleTracks = player.getSubtitleTracks();
  const subtitleSelected = player.getSelectedSubtitleTrackId?.() != null;
  /** Lock is a pocket-watching feature — it only exists in fullscreen/landscape. */
  const lockAvailable = isFullscreen;

  // Freeze time-driven re-renders while a sheet is open: the sheets sit on
  // top, and 4 Hz state updates under a Modal made the sheet feel laggy.
  // Time display values resume from live updates when the sheet closes.
  const anySheetOpenRef = useRef(false);
  anySheetOpenRef.current =
    showAudioSheet || showSubtitleSheet || showSettingsSheet;

  // Latest source-picker opener for the pill's RNGH tap gesture (ref so the
  // gesture closure never goes stale).
  const onSourcePickerRef = useRef(onSourcePicker);
  useEffect(() => {
    onSourcePickerRef.current = onSourcePicker;
  }, [onSourcePicker]);

  const onSourcePickerRefCurrentOpen = useCallback(() => {
    onSourcePickerRef.current?.();
  }, []);

  const closeAudioSheet = useCallback(() => setShowAudioSheet(false), []);
  const closeSubtitleSheet = useCallback(() => setShowSubtitleSheet(false), []);
  const closeSettingsSheet = useCallback(() => setShowSettingsSheet(false), []);

  // Interaction State Machine
  const [overlayState, setOverlayState] =
    useState<OverlayState>("CONTROLS_VISIBLE");
  const overlayOpacity = useSharedValue(1);
  // Live width of the gesture surface (updates on rotation/fullscreen), used
  // by the double-tap worklet. SCREEN_WIDTH is captured once at module load
  // and goes stale in fullscreen landscape — left-zone taps then classify as
  // middle and wrongly seek +10.
  const gestureSurfaceWidth = useSharedValue(0);
  const autoHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 2X Speed Hold state
  const [is2xSpeedActive, setIs2xSpeedActive] = useState(false);
  const is2xSpeedActiveRef = useRef(false);
  is2xSpeedActiveRef.current = is2xSpeedActive;

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
    applyTime(0);
    setDuration(0);
    setIsBuffering(true);
    setIsPaused(true);
  }, [player, applyTime]);

  // ── Optimistic Seek Lock State Machine ──
  // Prevents stale timeUpdate events from causing the progress bar to rubber-band / bounce-back
  const isSeekLockedRef = useRef(false);
  const targetSeekTimeRef = useRef(0);
  /** One "[Seek] lock holding" log per lock — per-update logging would spam. */
  const seekHoldLogRef = useRef(false);
  const seekLockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // P5 — seek-latency stopwatch: starts when a seek is requested, stops when
  // the seek-lock releases (playhead landed) or the 6s safety fires.
  const seekStartedAtRef = useRef<number | null>(null);
  const seekKindRef = useRef<"double_tap" | "buttons" | "scrub" | "resume">(
    "buttons",
  );

  const releaseSeekLock = useCallback(() => {
    isSeekLockedRef.current = false;
    if (seekStartedAtRef.current != null) {
      trackSeekLatency({
        latencyMs: Date.now() - seekStartedAtRef.current,
        kind: seekKindRef.current,
      });
      seekStartedAtRef.current = null;
    }
    setIsBuffering(false);
    if (seekLockTimeoutRef.current) {
      clearTimeout(seekLockTimeoutRef.current);
      seekLockTimeoutRef.current = null;
    }
  }, []);

  const acquireSeekLock = useCallback(
    (seekTime: number, kind?: typeof seekKindRef.current) => {
      isSeekLockedRef.current = true;
      seekStartedAtRef.current = Date.now();
      if (kind) seekKindRef.current = kind;
      targetSeekTimeRef.current = seekTime;
      seekHoldLogRef.current = false;
      applyTime(seekTime);
      setIsBuffering(true);

      if (seekLockTimeoutRef.current) clearTimeout(seekLockTimeoutRef.current);
      // Safety release after 6s in case remote network stream takes time to buffer new chunk
      seekLockTimeoutRef.current = setTimeout(() => {
        isSeekLockedRef.current = false;
        setIsBuffering(false);
      }, 6000);
    },
    [],
  );

  // ── Auto-hide timer control ──
  const scheduleAutoHide = useCallback(() => {
    if (autoHideTimer.current) clearTimeout(autoHideTimer.current);

    autoHideTimer.current = setTimeout(() => {
      if (
        !player.isPaused() &&
        !showAudioSheet &&
        !showSubtitleSheet &&
        !showSettingsSheet
      ) {
        overlayOpacity.value = withTiming(
          0,
          { duration: CHROME_FADE_MS },
          (finished) => {
            if (finished) {
              runOnJS(setOverlayState)("WATCHING");
            }
          },
        );
      }
    }, CHROME_AUTO_HIDE_MS);
  }, [
    player,
    showAudioSheet,
    showSubtitleSheet,
    showSettingsSheet,
    overlayOpacity,
  ]);

  const resetInteractionTimer = useCallback(() => {
    if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
    overlayOpacity.value = withTiming(1, { duration: CHROME_FADE_MS });
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
      overlayOpacity.value = withTiming(1, { duration: CHROME_FADE_MS });
      if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
    } else if (showAudioSheet || showSubtitleSheet || showSettingsSheet) {
      setOverlayState("MENU_OPEN");
      overlayOpacity.value = withTiming(1, { duration: CHROME_FADE_MS });
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

  // Orientation change: entering fullscreen ALWAYS reveals the chrome — the
  // user just made a deliberate display change and must see the bar in the
  // new geometry. (Before, a stale WATCHING state kept the bar hidden in
  // fullscreen until a manual tap.) Exiting shows it too, since the layout
  // changed under it.
  useEffect(() => {
    if (isLockedRef.current) return;
    setOverlayState("CONTROLS_VISIBLE");
    overlayOpacity.value = withTiming(1, { duration: CHROME_FADE_MS });
    scheduleAutoHide();
  }, [isFullscreen, overlayOpacity, scheduleAutoHide]);

  // ── Subscribe to player events with Seek Lock filter ──
  useEffect(() => {
    const unsubs = [
      player.onTimeUpdate((time, dur) => {
        if (anySheetOpenRef.current) return;
        if (Number.isFinite(dur) && dur > 0) {
          setDuration(dur);
        }
        const buffered = player.getBufferedPosition?.();
        if (typeof buffered === "number" && Number.isFinite(buffered)) {
          setBufferedPosition(buffered);
        }
        if (isSeekLockedRef.current) {
          const target = targetSeekTimeRef.current;
          // Mirror the adapter's tight landing rule — the old
          // `diff <= 60` also matched the still-playing pre-seek position,
          // releasing the lock early and bouncing the timeline back.
          const isLanded =
            target <= 15 ? time <= target + 3 : Math.abs(time - target) <= 3;
          if (isLanded) {
            releaseSeekLock();
            applyTime(time);
          } else if (!seekHoldLogRef.current) {
            seekHoldLogRef.current = true;
          }
        } else {
          applyTime(time);
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
  }, [player, releaseSeekLock, applyTime]);

  // Unlock automatically when leaving fullscreen — lock is landscape-only and
  // must never persist into portrait where its button wouldn't be reachable.
  useEffect(() => {
    if (!isFullscreen && isLockedRef.current) {
      setIsLocked(false);
    }
  }, [isFullscreen]);

  useEffect(() => {
    return () => {
      if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
      if (doubleTapTimer.current) clearTimeout(doubleTapTimer.current);
      if (seekDebounceTimer.current) clearTimeout(seekDebounceTimer.current);
      if (seekLockTimeoutRef.current) clearTimeout(seekLockTimeoutRef.current);
    };
  }, []);

  // ── 2X Speed hold callbacks ──
  // Remember the user's chosen rate — releasing the hold restores THEIR
  // speed (e.g. 1.25×), not a hardcoded 1.0.
  const rateBefore2xRef = useRef(1.0);
  const handleStart2xSpeed = useCallback(() => {
    if (isLockedRef.current) return;
    rateBefore2xRef.current = player.getPlaybackRate();
    player.setPlaybackRate(2.0);
    setIs2xSpeedActive(true);
    trackFeatureUsed("speed_2x_hold", "player");
  }, [player]);

  const handleStop2xSpeed = useCallback(() => {
    if (!is2xSpeedActiveRef.current) return; // failed/aborted hold — no-op
    player.setPlaybackRate(rateBefore2xRef.current || 1.0);
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
      // Base the math on the displayed (optimistic) position — during rapid
      // taps the native player is still catching up to the previous seek,
      // and a stale native base makes +10 land behind the visible position.
      const current = isSeekLockedRef.current
        ? targetSeekTimeRef.current
        : currentTimeRef.current;
      const newTarget = Math.max(
        0,
        Math.min(duration > 0 ? duration : 99999, current + delta),
      );

      acquireSeekLock(newTarget, "double_tap");

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
      overlayOpacity.value = withTiming(1, { duration: CHROME_FADE_MS });
      setOverlayState("CONTROLS_VISIBLE");
      scheduleAutoHide();
    } else {
      overlayOpacity.value = withTiming(
        0,
        { duration: CHROME_FADE_MS },
        (finished) => {
          if (finished) {
            runOnJS(setOverlayState)("WATCHING");
          }
        },
      );
      if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
    }
  }, [overlayState, overlayOpacity, scheduleAutoHide]);

  // ── Control lock actions ──
  const handleLock = useCallback(() => {
    setIsLocked(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
    overlayOpacity.value = withTiming(
      0,
      { duration: CHROME_FADE_MS },
      (finished) => {
        if (finished) {
          runOnJS(setOverlayState)("WATCHING");
        }
      },
    );
    trackFeatureUsed("lock", "player");
  }, [overlayOpacity]);

  const handleUnlock = useCallback(() => {
    setIsLocked(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    overlayOpacity.value = withTiming(1, { duration: CHROME_FADE_MS });
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
      // e.x is relative to the gesture surface; threshold against that same
      // surface's live width (falls back to the captured screen width until
      // the first onLayout fires).
      const width =
        gestureSurfaceWidth.value > 0
          ? gestureSurfaceWidth.value
          : SCREEN_WIDTH;
      const threshold = width * 0.4;
      if (e.x < threshold) {
        runOnJS(handleSideDoubleTap)("left");
      } else if (e.x > width - threshold) {
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

  // Source pill tap — RNGH Tap over the gesture surface so the pill is
  // reliably tappable while the full-screen tap gestures are active.
  const tapOpenSourceGesture = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => {
      runOnJS(resetInteractionTimer)();
      runOnJS(onSourcePickerRefCurrentOpen)();
    });

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
      : currentTimeRef.current;
    const target = Math.min(duration > 0 ? duration : 99999, current + 10);
    acquireSeekLock(target, "buttons");
    player.seek(target);
    resetInteractionTimer();
  }, [player, duration, acquireSeekLock, resetInteractionTimer]);

  const seekBackward = useCallback(() => {
    const current = isSeekLockedRef.current
      ? targetSeekTimeRef.current
      : currentTimeRef.current;
    const target = Math.max(0, current - 10);
    acquireSeekLock(target, "buttons");
    player.seek(target);
    resetInteractionTimer();
  }, [player, acquireSeekLock, resetInteractionTimer]);

  const handleSeek = useCallback(
    (time: number) => {
      acquireSeekLock(time, "scrub");
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

  // In portrait the video extends under the status bar (flush-top, YouTube-
  // style), so chrome clears it; in fullscreen the OS bar is hidden, but the
  // system nav/gesture area can still overlap the bottom in landscape — keep
  // whatever inset exists and always retain an 8dp floor so the timeline can
  // never sit under system UI. Physical landscape adds a fixed lift: its
  // bottom inset is often ~0 (gesture nav), which left the progress bar
  // hugging the screen edge.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;
  const paddingTop = Math.max(insets.top, isFullscreen ? 8 : 0);
  const paddingBottom =
    Math.max(insets.bottom, isFullscreen ? 8 : 0) + (isLandscape ? 36 : 0);

  const formattedCurrentTime = formatTime(currentTime);
  const formattedDuration = formatTime(duration);
  const remainingTimeStr = formatTime(Math.max(0, duration - currentTime));

  const timeDisplayStr = showRemainingTime
    ? `${formattedCurrentTime} / -${remainingTimeStr}`
    : `${formattedCurrentTime} / ${formattedDuration}`;

  const isControlsVisible = overlayState !== "WATCHING";

  // Duration-0 guard: some direct links never expose duration; the bar would
  // divide by zero and the scrub math is meaningless. Show a static time only.
  const hasDuration = Number.isFinite(duration) && duration > 0;

  // ── Sheet openers (close-then-open keeps one Modal at a time) ──
  const openAudioSheet = useCallback(() => {
    setShowSettingsSheet(false);
    setShowAudioSheet(true);
  }, []);
  const openSubtitleSheet = useCallback(() => {
    setShowSettingsSheet(false);
    setShowSubtitleSheet(true);
  }, []);

  const screenFit = settings.playerScreenFit ?? "contain";

  const fitOptions: {
    value: "contain" | "cover" | "fill";
    label: string;
    hint: string;
  }[] = [
    {
      value: "contain",
      label: "Fit to screen",
      hint: "Full picture, black bars if needed",
    },
    { value: "cover", label: "Fill screen", hint: "Crops the edges slightly" },
    { value: "fill", label: "Stretch", hint: "Fills the screen, may distort" },
  ];
  const fitLabel =
    fitOptions.find((o) => o.value === screenFit)?.label ?? "Fit to screen";

  const handleSelectFit = useCallback(
    (value: "contain" | "cover" | "fill") => {
      updateSetting("playerScreenFit", value);
    },
    [updateSetting],
  );

  const handleSelectSpeed = useCallback(
    (speed: number) => {
      player.setPlaybackRate(speed);
      trackFeatureUsed("speed_changed", "player");
    },
    [player],
  );

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
      {/* ── Gesture Layer (Layer 2) ── */}
      <GestureDetector gesture={composedGestures}>
        <View
          style={styles.gestureSurface}
          collapsable={false}
          onLayout={(e) => {
            gestureSurfaceWidth.value = e.nativeEvent.layout.width;
          }}
        >
          {/* Multi-Tap Seek Arc Overlay */}
          <DoubleTapRippleOverlay
            side={doubleTapSide}
            seekAmount={doubleTapCount}
          />

          {/* 2X Speed Indicator Pill */}
          {is2xSpeedActive && (
            <View
              style={[styles.speed2xPill, { top: paddingTop + 8 }]}
              pointerEvents="none"
            >
              <Ionicons name="flash" size={12} color={colors.gold} />
              <Text style={styles.speed2xText}>2× speed</Text>
            </View>
          )}

          {/* Center loading states — mutually exclusive, never double up:
              - switching pill while changing sources (most specific)
              - big spinner + detail only during INITIAL load (no controls yet)
              - mid-play stalls use the in-place spinner in the play button —
                no takeover, ±10 stays live */}
          {switchingLabel ? (
            <View style={styles.switchingOverlay} pointerEvents="none">
              <View style={styles.switchingPill}>
                <ActivityIndicator size="small" color={colors.gold} />
                <Text style={styles.switchingText} numberOfLines={1}>
                  {switchingLabel}
                </Text>
              </View>
            </View>
          ) : isStreamLoading ? (
            <View style={styles.bufferingIndicator} pointerEvents="none">
              <ActivityIndicator size="large" color={colors.gold} />
              {loadingDetail ? (
                <Text style={styles.loadingDetail}>{loadingDetail}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </GestureDetector>

      {/* ── A11y live region — announces playback state changes ── */}
      <View style={styles.a11yLive} accessibilityLiveRegion="polite">
        {liveAnnouncement ? (
          <Text style={styles.a11yHiddenText}>{liveAnnouncement}</Text>
        ) : null}
        {switchingLabel ? (
          <Text style={styles.a11yHiddenText}>{switchingLabel}</Text>
        ) : null}
      </View>

      {/* ── Controls Overlay (Layer 3) ── */}
      {isControlsVisible && !overlaySuppressed && (
        <Animated.View
          style={[styles.controlsOverlay, animatedOverlayStyle]}
          pointerEvents="box-none"
        >
          {/* Top bar — soft gradient scrim, icons only, no boxes */}
          <LinearGradient
            colors={["rgba(0,0,0,0.72)", "rgba(0,0,0,0.35)", "transparent"]}
            style={[styles.topBarGradient, { paddingTop: paddingTop + 8 }]}
            pointerEvents="box-none"
          >
            <View style={styles.topBar}>
              {/* Top-left: always close (fullscreen exit lives bottom-right,
                    so there is exactly one fullscreen button on screen) */}
              {!hideBack && (
                <TouchableOpacity
                  onPress={onClose}
                  style={styles.iconButton}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel="Close player"
                >
                  <Ionicons
                    name="chevron-down"
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
                {/* Audio — direct access when the file has multiple tracks */}
                {audioTracks.length > 1 && (
                  <TouchableOpacity
                    onPress={openAudioSheet}
                    style={styles.iconButton}
                    activeOpacity={0.6}
                    accessibilityRole="button"
                    accessibilityLabel={
                      audioChip
                        ? `Audio tracks, currently ${audioChip}`
                        : "Audio tracks"
                    }
                  >
                    <Ionicons
                      name="musical-notes-outline"
                      size={21}
                      color={colors.textPrimary}
                    />
                    {audioChip ? (
                      <View style={styles.iconBadge}>
                        <Text style={styles.iconBadgeText}>{audioChip}</Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                )}

                {/* Source pill — RNGH tap so it stays responsive over the
                    full-screen tap-gesture surface below. */}
                {onSourcePicker && sourceLabel && (
                  <GestureDetector gesture={tapOpenSourceGesture}>
                    <Animated.View style={styles.sourcePill}>
                      <Ionicons
                        name="layers-outline"
                        size={14}
                        color={colors.gold}
                      />
                      <Text style={styles.sourcePillText} numberOfLines={1}>
                        {sourceLabel}
                      </Text>
                    </Animated.View>
                  </GestureDetector>
                )}

                {/* ⋮ menu — speed / audio language / screen fit (landscape: + lock) */}
                <TouchableOpacity
                  onPress={() => setShowSettingsSheet(true)}
                  style={styles.iconButton}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel="More playback options"
                >
                  <Ionicons
                    name="ellipsis-vertical"
                    size={20}
                    color={colors.textPrimary}
                  />
                </TouchableOpacity>

                {/* Lock — landscape/fullscreen only (pocket watching), also
                    reachable from the ⋮ menu as the a11y alternative */}
                {lockAvailable && !isLocked && (
                  <TouchableOpacity
                    onPress={handleLock}
                    style={styles.iconButton}
                    activeOpacity={0.6}
                    accessibilityRole="button"
                    accessibilityLabel="Lock controls"
                  >
                    <Ionicons
                      name="lock-closed-outline"
                      size={20}
                      color={colors.textPrimary}
                    />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </LinearGradient>

          {/* Center Playback Area — the container is the column's flex:1
              spacer, so it must NEVER unmount: unmounting collapsed the
              column and parked the bottom bar directly under the top bar
              (~20% down) until the first frame arrived. Buttons stay hidden
              while the stream loads so the buffering indicator is never
              covered. */}
          <View style={styles.centerControls} pointerEvents="box-none">
            {!isStreamLoading && (
              <>
                <TouchableOpacity
                  onPress={seekBackward}
                  style={styles.seekButton}
                  activeOpacity={0.7}
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
                        size={34}
                        color="#0B0B0E"
                        style={{ marginLeft: isPaused ? 4 : 0 }}
                      />
                    )}
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={seekForward}
                  style={styles.seekButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Forward 10 seconds"
                >
                  <MaterialIcons
                    name="forward-10"
                    size={38}
                    color={colors.textPrimary}
                  />
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Bottom area — title time row, then the timeline */}
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.45)", "rgba(0,0,0,0.88)"]}
            style={[
              styles.bottomBarGradient,
              { paddingBottom: paddingBottom + 10 },
            ]}
            pointerEvents="box-none"
          >
            {/* Time row (duration-0 safe: times render, bar stays put) */}
            <View style={styles.timeRow}>
              <TouchableOpacity
                onPress={() => setShowRemainingTime((prev) => !prev)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Time display, currently shows ${showRemainingTime ? "remaining" : "elapsed"} time. Activate to ${showRemainingTime ? "show elapsed" : "show remaining"} time`}
                accessibilityState={{ selected: showRemainingTime }}
              >
                <Text style={styles.timeText}>{timeDisplayStr}</Text>
              </TouchableOpacity>

              {/* Bottom-right: CC + fullscreen (proper corner-bracket icons) */}
              <View style={styles.bottomRightRow}>
                {(subtitleTracks.length > 0 ||
                  !!subtitleOnlineSearch ||
                  (subtitleSidecars?.length ?? 0) > 0) && (
                  <TouchableOpacity
                    onPress={openSubtitleSheet}
                    style={styles.iconButton}
                    activeOpacity={0.6}
                    accessibilityRole="button"
                    accessibilityLabel="Subtitles"
                    accessibilityState={{ selected: subtitleSelected }}
                  >
                    <Ionicons
                      name="logo-closed-captioning"
                      size={22}
                      color={
                        subtitleSelected ? colors.gold : colors.textPrimary
                      }
                    />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={onToggleFullscreen}
                  style={styles.iconButton}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
                  }
                >
                  <MaterialCommunityIcons
                    name={
                      isFullscreen ? "arrow-collapse-all" : "arrow-expand-all"
                    }
                    size={22}
                    color={colors.textPrimary}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Timeline Progress Bar */}
            <ProgressBar
              currentTime={currentTime}
              duration={duration}
              hasDuration={hasDuration}
              bufferedPosition={bufferedPosition}
              introSegments={introSegments}
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
          style={[styles.skipSegmentBtn, { bottom: paddingBottom + 112 }]}
          onPress={() => {
            trackFeatureUsed("skip_intro", "player");
            onSkipSegment();
          }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={skipLabel}
        >
          <Ionicons name="play-forward" size={14} color={colors.gold} />
          <Text style={styles.skipSegmentText}>{skipLabel}</Text>
        </TouchableOpacity>
      )}

      {/* Unlock affordance — the only control that responds while locked */}
      {isLocked && (
        <TouchableOpacity
          style={styles.unlockButton}
          onPress={handleUnlock}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel="Unlock controls. Screen is locked for pocket viewing"
        >
          <Ionicons name="lock-open" size={19} color={colors.gold} />
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
        sidecars={subtitleSidecars}
        autoSync={autoSync}
        onClose={closeSubtitleSheet}
      />
      <PlayerSettingsSheet
        visible={showSettingsSheet}
        player={player}
        isFullscreen={isFullscreen}
        currentSpeed={player.getPlaybackRate()}
        onSelectSpeed={handleSelectSpeed}
        screenFit={screenFit}
        onSelectFit={handleSelectFit}
        subtitleBottomMargin={settings.subtitleBottomMargin}
        onSelectSubtitleMargin={(fraction) =>
          updateSetting("subtitleBottomMargin", fraction)
        }
        lockAvailable={lockAvailable}
        isLocked={isLocked}
        onLock={handleLock}
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
    // Strict column flow: top bar → center (flex:1) → bottom bar. The center
    // controls are then mathematically centered BETWEEN the bars (the old
    // absoluteFill centering ignored bar heights and sat visually low in
    // fullscreen), and the bottom bar can never be pushed off-screen.
    flexDirection: "column",
    zIndex: 20,
  },
  topBarGradient: {
    paddingHorizontal: 8,
    paddingBottom: 20,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBadge: {
    position: "absolute",
    right: 2,
    bottom: 0,
    backgroundColor: colors.goldBadge,
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  iconBadgeText: {
    color: colors.gold,
    fontSize: 9,
    fontWeight: "800",
  },
  title: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    marginHorizontal: 10,
  },
  topRightRow: {
    flexDirection: "row",
    gap: 2,
    alignItems: "center",
    marginLeft: "auto",
  },
  sourcePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 999,
    paddingHorizontal: 10,
    height: 30,
  },
  sourcePillText: {
    color: colors.gold,
    fontSize: 11.5,
    fontWeight: "700",
    maxWidth: 78,
  },
  centerControls: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 40,
  },
  seekButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 8,
  },
  playButtonInner: {
    alignItems: "center",
    justifyContent: "center",
  },
  bottomBarGradient: {
    paddingTop: 10,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 2,
  },
  bottomRightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
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
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
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
    gap: 5,
    backgroundColor: "rgba(0,0,0,0.72)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    zIndex: 40,
  },
  speed2xText: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "700",
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
    backgroundColor: "rgba(0,0,0,0.72)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    zIndex: 40,
  },
  skipSegmentText: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: "700",
  },
  unlockButton: {
    position: "absolute",
    top: 56,
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    zIndex: 40,
  },
  a11yLive: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    overflow: "hidden",
  },
  a11yHiddenText: {
    fontSize: 1,
    color: "transparent",
  },
});
