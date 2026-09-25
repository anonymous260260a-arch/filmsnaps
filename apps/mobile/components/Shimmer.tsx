/**
 * Shimmer — Animated shimmer skeleton component.
 *
 * Uses React Native Animated API for cross-platform compatibility.
 * Replaces the static ShimmerBar in Skeletons.tsx with a fluid
 * shimmer wave effect.
 *
 * - Uses Animated.loop with interpolation for the moving highlight
 * - Respects reduceMotion accessibility setting
 * - Accepts width, height, borderRadius, and optional style overrides
 */

import React, { useEffect, useRef, useState } from "react";
import { View, Animated, Easing, AccessibilityInfo } from "react-native";
import { colors } from "../theme/colors";

interface ShimmerProps {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: any;
}

export function Shimmer({
  width,
  height,
  borderRadius = 4,
  style,
}: ShimmerProps) {
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  // Start STATIC — only animate after the async reduce-motion check confirms
  // animation is allowed (initial frames must not move when reduce-motion is on).
  const [allowAnimation, setAllowAnimation] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let animation: Animated.CompositeAnimation | null = null;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (cancelled || enabled) return;
        setAllowAnimation(true);
        animation = Animated.loop(
          Animated.timing(shimmerAnim, {
            toValue: 1,
            duration: 1600,
            easing: Easing.ease,
            useNativeDriver: true,
          }),
        );
        animation.start();
      })
      .catch(() => {
        // If the check fails, stay static (safe default).
      });

    return () => {
      cancelled = true;
      animation?.stop();
    };
  }, [shimmerAnim]);

  // Static skeleton until reduce-motion is known-allowed.
  const translateX = allowAnimation
    ? shimmerAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [-200, (typeof width === "number" ? width : 300) + 200],
      })
    : 0;

  const opacity = allowAnimation
    ? shimmerAnim.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [0.5, 1, 0.5],
      })
    : 0.75;

  return (
    <View
      style={{
        width: width as any,
        height,
        borderRadius,
        backgroundColor: colors.skeletonBg,
        overflow: "hidden",
        ...style,
      }}
    >
      <Animated.View
        style={{
          width: "40%",
          height: "100%",
          backgroundColor: colors.skeletonHighlight,
          opacity,
          transform: [{ translateX }],
        }}
      />
    </View>
  );
}
