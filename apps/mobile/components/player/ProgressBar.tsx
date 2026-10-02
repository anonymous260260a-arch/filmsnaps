/**
 * ProgressBar — YouTube-style gesture seek bar with buffered fill, skip-window
 * notch and a time bubble. UI-thread scrubbing via Reanimated shared values.
 *
 * Improvements over the old bar:
 * - Tap anywhere seeks there (full-bleed hit area; gutters clamp to 0%/100%).
 * - Drag follows the finger; touching near the thumb keeps the grab offset.
 * - Buffered range rendered as a dim gold fill behind the playhead (expo-video
 *   exposes player.bufferedPosition; the adapter surfaces it).
 * - Intro skip window drawn as a subtle notch on the track (teaches the user
 *   where the intro is; pairs with the floating Skip button).
 * - Scrub feedback is a clamped time bubble — the previous static-backdrop
 *   "preview card" showed an image unrelated to the target time.
 * - Duration-0 links disable scrubbing instead of dividing by zero.
 */

import React, { useCallback, useRef, useEffect, useState } from "react";
import { View, Text, StyleSheet, LayoutChangeEvent } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withSpring,
  withTiming,
  withSequence,
  withDelay,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { colors } from "../../theme/colors";
import type { IntroDbResponse } from "../../lib/introDetect";

const BAR_HEIGHT = 44; // ≥44dp touch target
const THUMB_SIZE = 14;
const THUMB_SIZE_ACTIVE = 18;
const TRACK_HEIGHT_NORMAL = 3.5;
const TRACK_HEIGHT_ACTIVE = 6;
const BUBBLE_WIDTH = 88;
// Visual gutter: the track ends this far from the screen edge so the thumb
// never clips off-phone — while the GESTURE area stays full-bleed, so the
// gutters are live (tap/drag there clamps to 0% / 100%).
const VISUAL_INSET = 10;
// Touch within this distance of the thumb drags it relatively (grab feel);
// touching anywhere else jumps the playhead straight to the finger.
const GRAB_RADIUS = 16;

// YouTube-style intent detection: a touch on the bar only becomes a scrub
// once it moves HORIZONTALLY. Vertical-first movement (Android gesture-nav
// swipe from bottom center, home swipe) FAILS the gesture so the system
// gets it — the old code committed a seek at the touch-down point for
// every touch that ended on the bar, swipe or not.
const VERTICAL_FAIL_PX = 12;
const HORIZONTAL_ACTIVATE_PX = 8;

/** Map playhead fraction → thumb x in full-bleed bar coordinates. */
function fractionToX(fraction: number, width: number): number {
  "worklet";
  const trackW = Math.max(0, width - VISUAL_INSET * 2);
  const f = Math.min(1, Math.max(0, fraction));
  return VISUAL_INSET + f * trackW;
}

/** Map a touch x (full-bleed) → fraction, clamped to the visual track. */
function xToFraction(x: number, width: number): number {
  "worklet";
  const trackW = Math.max(0, width - VISUAL_INSET * 2);
  if (trackW <= 0) return 0;
  return Math.min(1, Math.max(0, (x - VISUAL_INSET) / trackW));
}

/** Clamp a touch x to the visual track span (gutters → 0% / 100%). */
function clampToTrack(x: number, width: number): number {
  "worklet";
  const maxX = Math.max(VISUAL_INSET, width - VISUAL_INSET);
  return Math.min(maxX, Math.max(VISUAL_INSET, x));
}

interface ProgressBarProps {
  currentTime: number;
  duration: number;
  /** False when the backend never reports a duration — times render, scrubbing is off. */
  hasDuration?: boolean;
  /** Seconds of buffered-ahead content (0 hides the fill). */
  bufferedPosition?: number;
  /** introdb segments — draws the intro skip window notch on the track. */
  introSegments?: IntroDbResponse | null;
  onSeek: (time: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function ProgressBar({
  currentTime,
  duration,
  hasDuration = true,
  bufferedPosition = 0,
  introSegments = null,
  onSeek,
  onScrubStart,
  onScrubEnd,
}: ProgressBarProps) {
  const [scrubTimeText, setScrubTimeText] = useState("0:00");
  const [isScrubbing, setIsScrubbing] = useState(false);

  // Shared values that live directly on the Reanimated UI thread
  const trackWidthSV = useSharedValue(0);
  const thumbX = useSharedValue(0);
  const thumbScale = useSharedValue(1);
  const isDraggingSV = useSharedValue(false);
  /** Touch-offset preserved when grabbing the thumb (0 = jump to finger). */
  const grabOffsetSV = useSharedValue(0);
  /** Touch-down X (view coords) — captured from touch events, which carry
   *  fresh motion data, rather than the discrete gesture's end payload. */
  const touchXSV = useSharedValue(-1);
  const currentTimeSV = useSharedValue(0);
  const durationSV = useSharedValue(0);
  const bufferedSV = useSharedValue(0);
  /** True between pan activation and finalize — guards the fail path. */
  const activatedSV = useSharedValue(false);

  // Refs mirror latest prop/callback values for the JS-thread callbacks
  const onSeekRef = useRef(onSeek);
  const onScrubStartRef = useRef(onScrubStart);
  const onScrubEndRef = useRef(onScrubEnd);
  const hasDurationRef = useRef(hasDuration);
  useEffect(() => {
    onSeekRef.current = onSeek;
    onScrubStartRef.current = onScrubStart;
    onScrubEndRef.current = onScrubEnd;
    hasDurationRef.current = hasDuration;
  }, [onSeek, onScrubStart, onScrubEnd, hasDuration]);

  // Intro notch geometry (fractions 0–1). Only when a usable intro exists and
  // duration is known. getActiveSkipSegment upstream prefers recap over intro
  // for the Skip button; the notch simply marks the intro window when present.
  const intro = introSegments?.intro ?? null;
  const notch =
    hasDuration && intro && duration > 0 && intro.end_sec > intro.start_sec
      ? {
          start: Math.max(0, intro.start_sec / duration),
          width: Math.min(1, (intro.end_sec - intro.start_sec) / duration),
        }
      : null;

  // Mirror props into shared values
  useEffect(() => {
    currentTimeSV.value = currentTime;
    durationSV.value = duration;
  }, [currentTime, duration, currentTimeSV, durationSV]);

  useEffect(() => {
    bufferedSV.value = bufferedPosition;
  }, [bufferedPosition, bufferedSV]);

  // Track the playhead while not scrubbing (UI thread); freeze while scrubbing.
  useAnimatedReaction(
    () => (durationSV.value > 0 ? currentTimeSV.value / durationSV.value : 0),
    (fraction, prev) => {
      if (isDraggingSV.value) return;
      if (fraction !== prev) {
        thumbX.value = fractionToX(fraction, trackWidthSV.value);
      }
    },
    [],
  );

  const trackLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const w = e.nativeEvent.layout.width;
      if (w !== trackWidthSV.value) {
        trackWidthSV.value = w;
        // Re-project the thumb on rotation/resize
        thumbX.value = fractionToX(
          durationSV.value > 0 ? currentTimeSV.value / durationSV.value : 0,
          w,
        );
      }
    },
    [trackWidthSV, durationSV, currentTimeSV, thumbX],
  );

  const updateScrubTimeText = useCallback((t: number) => {
    setScrubTimeText(formatTime(t));
  }, []);

  const beginScrubJS = useCallback(() => {
    setIsScrubbing(true);
    onScrubStartRef.current?.();
  }, []);

  const commitSeek = useCallback((t: number) => {
    setIsScrubbing(false);
    onScrubEndRef.current?.();
    if (hasDurationRef.current && Number.isFinite(t)) {
      onSeekRef.current(t);
    }
  }, []);

  // Tap-to-seek: a touch that never becomes a horizontal drag seeks to its
  // position (YouTube-style). Generous maxDuration means hold-then-release
  // still seeks; maxDistance keeps real swipes from ever counting as taps
  // while tolerating finger jitter. Race order matters: Tap only activates
  // on finger-up, so an 8px horizontal drag activates the Pan first and
  // cancels the Tap. The touch X comes from onTouchesDown (fresh motion
  // data) with the end payload as fallback, and every computed value is
  // NaN-guarded — a bad number here used to seek(NaN), which the adapter
  // silently drops while the time display resets to 0:00.
  const tapGesture = Gesture.Tap()
    .maxDistance(25)
    .maxDuration(6000)
    .onTouchesDown((e) => {
      const t0 = e.allTouches[0] ?? e.changedTouches[0];
      if (t0 && Number.isFinite(t0.x)) {
        touchXSV.value = t0.x;
      }
    })
    .onEnd((e, success) => {
      if (!success) return;
      if (durationSV.value <= 0) return;
      const w = trackWidthSV.value;
      if (w <= 0) return;
      const rawX =
        touchXSV.value >= 0 && Number.isFinite(touchXSV.value)
          ? touchXSV.value
          : e.x;
      if (!Number.isFinite(rawX)) return;
      const x = clampToTrack(rawX, w);
      thumbX.value = x;
      // Brief YouTube-style thumb pop so the tap reads as a seek, not a touch.
      thumbScale.value = withSequence(
        withSpring(THUMB_SIZE_ACTIVE / THUMB_SIZE, {
          damping: 14,
          stiffness: 350,
        }),
        withDelay(200, withSpring(1, { damping: 14, stiffness: 350 })),
      );
      const t = xToFraction(x, w) * durationSV.value;
      if (!Number.isFinite(t)) return;
      runOnJS(commitSeek)(t);
    });

  const panGesture = Gesture.Pan()
    // Arm BOTH directions: a positive number alone (activeOffsetXEnd) only
    // activates on rightward movement, so touch-down-then-drag-BACK never
    // activated the pan (and Tap failed on distance) — the reported "tap and
    // scrub backward does nothing" bug. Same for failOffsetY: gesture-nav
    // swipes move DOWN first, but notification-shade pulls move UP.
    .activeOffsetX([-HORIZONTAL_ACTIVATE_PX, HORIZONTAL_ACTIVATE_PX])
    .failOffsetY([-VERTICAL_FAIL_PX, VERTICAL_FAIL_PX])
    .onTouchesDown(() => {
      activatedSV.value = false;
    })
    // onStart fires only when the pan ACTIVATES (horizontal intent) — a
    // vertical-first touch (gesture-nav swipe) fails the gesture and must
    // never open the scrub UI.
    .onStart((e) => {
      activatedSV.value = true;
      const w = trackWidthSV.value;
      // YouTube grab semantics: touching ON the thumb keeps the touch's
      // relative offset; touching anywhere else jumps the thumb to the finger.
      const anchorX =
        Number.isFinite(e.x) && e.x > 0
          ? e.x
          : touchXSV.value >= 0
            ? touchXSV.value
            : -1;
      grabOffsetSV.value =
        anchorX >= 0 && Math.abs(thumbX.value - anchorX) <= GRAB_RADIUS
          ? thumbX.value - anchorX
          : 0;
      // Jump + bubble text at ACTIVATION — a drag can activate and end with
      // zero onUpdate frames, which used to leave the bubble at 0:00 and
      // commit the untouched playhead (seek-to-current = no visible change).
      if (anchorX >= 0 && w > 0 && durationSV.value > 0) {
        const next = clampToTrack(anchorX + grabOffsetSV.value, w);
        thumbX.value = next;
        runOnJS(updateScrubTimeText)(xToFraction(next, w) * durationSV.value);
      }
      runOnJS(beginScrubJS)();
      isDraggingSV.value = true;
      thumbScale.value = withSpring(THUMB_SIZE_ACTIVE / THUMB_SIZE, {
        damping: 14,
        stiffness: 350,
      });
    })
    .onUpdate((e) => {
      if (durationSV.value <= 0) return;
      const w = trackWidthSV.value;
      if (w <= 0) return;
      const next = clampToTrack(e.x + grabOffsetSV.value, w);
      thumbX.value = next;
      const t = xToFraction(next, w) * durationSV.value;
      runOnJS(updateScrubTimeText)(t);
    })
    // onFinalize covers both end AND fail — the only safe cleanup point.
    .onFinalize(() => {
      if (!activatedSV.value) return; // failed gesture: nothing was scrubbing
      isDraggingSV.value = false;
      thumbScale.value = withSpring(1, { damping: 14, stiffness: 350 });
      const w = trackWidthSV.value;
      const t =
        w > 0 && durationSV.value > 0
          ? xToFraction(thumbX.value, w) * durationSV.value
          : 0;
      runOnJS(commitSeek)(t);
    });

  const composedGesture = Gesture.Race(tapGesture, panGesture);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.value }, { scale: thumbScale.value }],
  }));

  const progressStyle = useAnimatedStyle(() => {
    const trackW = Math.max(0, trackWidthSV.value - VISUAL_INSET * 2);
    if (trackW <= 0) return { width: 0 };
    return {
      width: Math.max(0, Math.min(trackW, thumbX.value - VISUAL_INSET)),
    };
  });

  const bufferedStyle = useAnimatedStyle(() => {
    const trackW = Math.max(0, trackWidthSV.value - VISUAL_INSET * 2);
    if (durationSV.value <= 0 || trackW <= 0) return { width: 0 };
    const f = Math.min(1, Math.max(0, bufferedPosition / durationSV.value));
    return { width: f * trackW };
  });

  const trackHeightStyle = useAnimatedStyle(() => ({
    height: withTiming(
      isDraggingSV.value ? TRACK_HEIGHT_ACTIVE : TRACK_HEIGHT_NORMAL,
      { duration: 150 },
    ),
  }));

  const bubbleStyle = useAnimatedStyle(() => {
    const width = trackWidthSV.value || 0;
    const halfBubble = BUBBLE_WIDTH / 2;
    const minX = VISUAL_INSET + halfBubble;
    const maxX = Math.max(minX, width - VISUAL_INSET - halfBubble);
    const clampedX =
      width > 0 ? Math.max(minX, Math.min(maxX, thumbX.value)) : minX;
    return {
      transform: [{ translateX: clampedX - halfBubble }],
      opacity: withTiming(isDraggingSV.value ? 1 : 0, { duration: 150 }),
    };
  });

  return (
    <View style={styles.container}>
      {/* Time bubble — replaces the old static-backdrop "preview" card */}
      {isScrubbing && (
        <Animated.View
          style={[styles.bubble, bubbleStyle]}
          pointerEvents="none"
        >
          <Text style={styles.bubbleText}>{scrubTimeText}</Text>
        </Animated.View>
      )}

      <GestureDetector gesture={composedGesture}>
        <Animated.View
          style={styles.barHit}
          onLayout={trackLayout}
          collapsable={false}
        >
          <View style={styles.trackRow} pointerEvents="none">
            {/* Base track */}
            <Animated.View style={[styles.track, trackHeightStyle]} />
            {/* Buffered fill */}
            <Animated.View
              style={[
                styles.layer,
                styles.buffered,
                bufferedStyle,
                trackHeightStyle,
              ]}
            />
            {/* Intro notch — only when a usable segment + known duration */}
            {notch && (
              <View
                style={[
                  styles.layer,
                  styles.notch,
                  {
                    left: `${notch.start * 100}%`,
                    width: `${Math.max(0.5, notch.width * 100)}%`,
                  },
                ]}
              />
            )}
            {/* Played fill */}
            <Animated.View
              style={[
                styles.layer,
                styles.progress,
                progressStyle,
                trackHeightStyle,
              ]}
            />
          </View>
          {/* Thumb — centered on the track row, projected by thumbX */}
          <Animated.View
            style={[styles.thumbWrap, thumbStyle]}
            pointerEvents="none"
          >
            <View style={styles.thumbInner} />
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: "stretch",
    paddingVertical: 4,
    // Full-bleed so the gesture area reaches the phone edges (the gutters
    // clamp to 0%/100%); the visible track is inset via styles.trackRow so
    // the thumb never clips off-screen at 0%/100%.
  },
  bubble: {
    position: "absolute",
    top: -30,
    left: 0,
    width: BUBBLE_WIDTH,
    alignItems: "center",
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.85)",
    zIndex: 5,
  },
  bubbleText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  barHit: {
    height: BAR_HEIGHT,
    justifyContent: "center",
  },
  trackRow: {
    ...StyleSheet.absoluteFillObject,
    // Visual inset (gesture space stays full-bleed — see container).
    left: VISUAL_INSET,
    right: VISUAL_INSET,
    justifyContent: "center",
  },
  track: {
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  layer: {
    position: "absolute",
    left: 0,
    top: "50%",
    marginTop: -TRACK_HEIGHT_ACTIVE / 2,
  },
  buffered: {
    borderRadius: 3,
    backgroundColor: "rgba(212,162,55,0.30)",
  },
  notch: {
    height: TRACK_HEIGHT_NORMAL + 2,
    borderRadius: 2,
    backgroundColor: "rgba(212,162,55,0.22)",
    top: "50%",
    marginTop: -(TRACK_HEIGHT_NORMAL + 2) / 2,
  },
  progress: {
    borderRadius: 3,
    backgroundColor: colors.gold,
  },
  thumbWrap: {
    position: "absolute",
    left: 0,
    top: "50%",
    marginTop: -THUMB_SIZE / 2,
    marginLeft: -THUMB_SIZE / 2,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbInner: {
    width: THUMB_SIZE - 4,
    height: THUMB_SIZE - 4,
    borderRadius: (THUMB_SIZE - 4) / 2,
    backgroundColor: colors.gold,
  },
});
