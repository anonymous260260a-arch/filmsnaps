/**
 * ProgressBar — Gesture-based video seek bar with Reanimated SharedValues & Picture Preview.
 *
 * Runs smooth UI-thread progress rendering, gesture scrubbing with instant response,
 * clamped floating 16:9 video thumbnail preview card, and zero stutter.
 */

import React, { useCallback, useRef, useEffect, useState } from "react";
import { View, Text, StyleSheet, LayoutChangeEvent, Image } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withSpring,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../theme/colors";

const BAR_HEIGHT = 44; // Vertical touch target >= 44dp
const THUMB_SIZE = 14;
const THUMB_SIZE_ACTIVE = 20;
const TRACK_HEIGHT_NORMAL = 4;
const TRACK_HEIGHT_ACTIVE = 6;
const PREVIEW_WIDTH = 114;
const PREVIEW_HEIGHT = 64;

interface ProgressBarProps {
  currentTime: number;
  duration: number;
  backdropUrl?: string;
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
  backdropUrl,
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
  const panStartX = useSharedValue(0);
  const currentTimeSV = useSharedValue(0);
  const durationSV = useSharedValue(0);

  // Refs mirror latest prop values for JS thread callbacks
  const onSeekRef = useRef(onSeek);
  const onScrubStartRef = useRef(onScrubStart);
  const onScrubEndRef = useRef(onScrubEnd);
  const durationRef = useRef(duration);

  useEffect(() => {
    onSeekRef.current = onSeek;
  }, [onSeek]);
  useEffect(() => {
    onScrubStartRef.current = onScrubStart;
  }, [onScrubStart]);
  useEffect(() => {
    onScrubEndRef.current = onScrubEnd;
  }, [onScrubEnd]);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  // Keep SharedValues in sync with incoming props
  useEffect(() => {
    if (Number.isFinite(currentTime) && currentTime >= 0) {
      currentTimeSV.value = currentTime;
    }
    if (Number.isFinite(duration) && duration > 0) {
      durationSV.value = duration;
    }

    // If user is not currently scrubbing, update thumb position immediately
    if (
      !isDraggingSV.value &&
      duration > 0 &&
      trackWidthSV.value > 0 &&
      Number.isFinite(currentTime)
    ) {
      const pct = Math.max(0, Math.min(1, currentTime / duration));
      thumbX.value = pct * trackWidthSV.value;
    }
  }, [currentTime, duration]);

  const updateScrubTextJS = useCallback((pct: number) => {
    const dur = durationRef.current;
    if (dur > 0 && Number.isFinite(pct)) {
      const clampedPct = Math.max(0, Math.min(1, pct));
      const targetTime = clampedPct * dur;
      setScrubTimeText(formatTime(targetTime));
    }
  }, []);

  const handleCommitSeekJS = useCallback((pct: number) => {
    const dur = durationRef.current;
    if (dur > 0 && Number.isFinite(pct)) {
      const clampedPct = Math.max(0, Math.min(1, pct));
      const seekTime = clampedPct * dur;
      onSeekRef.current(seekTime);
    }
  }, []);

  const handleScrubStateJS = useCallback((scrubbing: boolean) => {
    setIsScrubbing(scrubbing);
    if (scrubbing) {
      onScrubStartRef.current?.();
    } else {
      onScrubEndRef.current?.();
    }
  }, []);

  // Measure container layout width
  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    if (width > 0) {
      trackWidthSV.value = width;
      const dur = durationRef.current;
      if (
        !isDraggingSV.value &&
        dur > 0 &&
        Number.isFinite(currentTimeSV.value)
      ) {
        const pct = Math.max(0, Math.min(1, currentTimeSV.value / dur));
        thumbX.value = pct * width;
      }
    }
  }, []);

  // Sync thumb position during video playback via Reanimated reaction
  useAnimatedReaction(
    () => ({
      time: currentTimeSV.value,
      dur: durationSV.value,
      w: trackWidthSV.value,
      dragging: isDraggingSV.value,
    }),
    (curr) => {
      if (
        !curr.dragging &&
        curr.dur > 0 &&
        curr.w > 0 &&
        Number.isFinite(curr.time) &&
        curr.time >= 0
      ) {
        const pct = Math.max(0, Math.min(1, curr.time / curr.dur));
        thumbX.value = pct * curr.w;
      }
    },
  );

  // --- Pan gesture: drag the thumb across timeline ---
  const panGesture = Gesture.Pan()
    .hitSlop({ top: 16, bottom: 16, left: 20, right: 20 })
    .onBegin((e) => {
      const width = trackWidthSV.value;
      if (width <= 0) return;

      isDraggingSV.value = true;
      runOnJS(handleScrubStateJS)(true);

      const startX = Math.max(0, Math.min(width, e.x));
      panStartX.value = startX;
      thumbX.value = startX;
      thumbScale.value = withSpring(THUMB_SIZE_ACTIVE / THUMB_SIZE, {
        damping: 14,
        stiffness: 350,
      });

      runOnJS(updateScrubTextJS)(startX / width);
    })
    .onUpdate((e) => {
      const width = trackWidthSV.value;
      if (width <= 0) return;

      const newX = Math.max(
        0,
        Math.min(width, panStartX.value + e.translationX),
      );
      thumbX.value = newX;
      runOnJS(updateScrubTextJS)(newX / width);
    })
    .onFinalize(() => {
      const width = trackWidthSV.value;
      isDraggingSV.value = false;
      thumbScale.value = withSpring(1.0, { damping: 14, stiffness: 350 });

      if (width > 0) {
        runOnJS(handleCommitSeekJS)(thumbX.value / width);
      }
      runOnJS(handleScrubStateJS)(false);
    });

  // --- Tap gesture: instant jump to a location on the timeline ---
  const tapGesture = Gesture.Tap()
    .hitSlop({ top: 16, bottom: 16, left: 20, right: 20 })
    .onBegin((e) => {
      const width = trackWidthSV.value;
      if (width <= 0) return;
      const targetX = Math.max(0, Math.min(width, e.x));
      thumbX.value = targetX;
      runOnJS(handleScrubStateJS)(true);
      runOnJS(updateScrubTextJS)(targetX / width);
    })
    .onEnd((e) => {
      const width = trackWidthSV.value;
      if (width <= 0) return;

      const targetX = Math.max(0, Math.min(width, e.x));
      thumbX.value = targetX;
      runOnJS(handleCommitSeekJS)(targetX / width);
      runOnJS(handleScrubStateJS)(false);
    });

  const composedGesture = Gesture.Race(panGesture, tapGesture);

  const thumbAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: thumbX.value - THUMB_SIZE / 2 },
      { scale: thumbScale.value },
    ],
  }));

  const trackProgressStyle = useAnimatedStyle(() => {
    const width = trackWidthSV.value;
    const progressWidth =
      width > 0 ? Math.max(0, Math.min(width, thumbX.value)) : thumbX.value;
    return {
      width: progressWidth,
    };
  });

  const trackHeightStyle = useAnimatedStyle(() => ({
    height: withTiming(
      isDraggingSV.value ? TRACK_HEIGHT_ACTIVE : TRACK_HEIGHT_NORMAL,
      {
        duration: 150,
      },
    ),
  }));

  const previewCardStyle = useAnimatedStyle(() => {
    const width = trackWidthSV.value || 0;
    const halfPreview = PREVIEW_WIDTH / 2;
    // Keep preview card clamped inside screen/track boundaries
    const clampedX =
      width > 0
        ? Math.max(halfPreview, Math.min(width - halfPreview, thumbX.value))
        : halfPreview;

    return {
      transform: [{ translateX: clampedX - halfPreview }],
      opacity: withTiming(isDraggingSV.value ? 1 : 0, { duration: 150 }),
    };
  });

  return (
    <View style={styles.container}>
      {/* Floating 16:9 Scrub Picture Preview Card */}
      {isScrubbing && (
        <Animated.View
          style={[styles.previewContainer, previewCardStyle]}
          pointerEvents="none"
        >
          <View style={styles.previewCard}>
            {backdropUrl ? (
              <Image
                source={{ uri: backdropUrl }}
                style={styles.previewBackdropImage}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.previewBackdropFallback} />
            )}
            <LinearGradient
              colors={["transparent", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.92)"]}
              style={styles.previewGradientOverlay}
            />
            <View style={styles.previewTimeBadge}>
              <Ionicons
                name="play"
                size={9}
                color={colors.gold}
                style={styles.previewIcon}
              />
              <Text style={styles.previewTimeText}>{scrubTimeText}</Text>
            </View>
          </View>
          <View style={styles.previewArrow} />
        </Animated.View>
      )}

      <GestureDetector gesture={composedGesture}>
        <Animated.View style={styles.trackContainer} onLayout={handleLayout}>
          <Animated.View style={[styles.trackBackground, trackHeightStyle]} />
          <Animated.View
            style={[styles.trackProgress, trackProgressStyle, trackHeightStyle]}
          />
          <Animated.View style={[styles.thumb, thumbAnimatedStyle]} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  previewContainer: {
    position: "absolute",
    top: -(PREVIEW_HEIGHT + 14),
    left: 16,
    width: PREVIEW_WIDTH,
    alignItems: "center",
    zIndex: 30,
  },
  previewCard: {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    backgroundColor: "rgba(18, 18, 24, 0.98)",
    borderColor: "rgba(212, 162, 55, 0.85)",
    borderWidth: 1.5,
    borderRadius: 8,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "flex-end",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.65,
    shadowRadius: 6,
    elevation: 9,
  },
  previewBackdropImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  previewBackdropFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(26, 26, 34, 0.95)",
  },
  previewGradientOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  previewTimeBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(10, 10, 14, 0.85)",
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 5,
    marginBottom: 5,
    borderWidth: 0.5,
    borderColor: "rgba(212, 162, 55, 0.5)",
  },
  previewIcon: {
    marginRight: 3,
  },
  previewTimeText: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.5,
  },
  previewArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "rgba(212, 162, 55, 0.85)",
    marginTop: -0.5,
  },
  trackContainer: {
    height: BAR_HEIGHT,
    justifyContent: "center",
    width: "100%",
  },
  trackBackground: {
    position: "absolute",
    left: 0,
    right: 0,
    height: TRACK_HEIGHT_NORMAL,
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    borderRadius: 3,
  },
  trackProgress: {
    position: "absolute",
    left: 0,
    height: TRACK_HEIGHT_NORMAL,
    backgroundColor: colors.gold,
    borderRadius: 3,
  },
  thumb: {
    position: "absolute",
    left: 0,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.gold,
    top: (BAR_HEIGHT - THUMB_SIZE) / 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 5,
  },
});
