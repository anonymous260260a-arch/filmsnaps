/**
 * AnimatedBackdrop — Scroll-driven backdrop blur using Reanimated worklets.
 *
 * The animation runs ENTIRELY on the UI thread via Reanimated worklets.
 * The JS thread is NEVER touched during scroll/animation, preventing the
 * frame drops that would occur with the standard Animated API.
 *
 * Usage:
 *   const scrollY = useSharedValue(0);
 *   <AnimatedScrollView onScroll={scrollHandler} />
 *   <AnimatedBackdrop scrollY={scrollY}>
 *     {children}
 *   </AnimatedBackdrop>
 */

import React from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  interpolate,
  type SharedValue,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";

interface AnimatedBackdropProps {
  /** The scroll position shared value from a Reanimated scroll handler */
  scrollY: SharedValue<number>;
  /**
   * The scroll range over which the backdrop fades in.
   * Default: [0, 200] — starts fully transparent, fully visible at 200px scrolled.
   */
  scrollRange?: [number, number];
  /**
   * The blur intensity when fully visible.
   * Default: 50 (matches expo-blur's scale, 0-100).
   */
  maxIntensity?: number;
  /** Children to render inside the backdrop */
  children: React.ReactNode;
}

export function AnimatedBackdrop({
  scrollY,
  scrollRange = [0, 200],
  maxIntensity = 50,
  children,
}: AnimatedBackdropProps) {
  // This worklet runs on the UI thread — no JS thread involvement
  const animatedStyle = useAnimatedStyle(() => {
    "worklet";
    const opacity = interpolate(scrollY.value, scrollRange, [0, 1], {
      extrapolateRight: "clamp",
    });
    return { opacity };
  });

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, animatedStyle]}
      pointerEvents="none"
    >
      <BlurView
        intensity={maxIntensity}
        tint="dark"
        style={StyleSheet.absoluteFill}
      >
        {children}
      </BlurView>
    </Animated.View>
  );
}
