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

import React, { useEffect, useRef } from "react";
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
  const reduceMotionRef = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      reduceMotionRef.current = enabled;
    });

    if (!reduceMotionRef.current) {
      const animation = Animated.loop(
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1600,
          easing: Easing.ease,
          useNativeDriver: true,
        }),
      );
      animation.start();
      return () => animation.stop();
    }
  }, [shimmerAnim]);

  const translateX = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-200, (typeof width === "number" ? width : 300) + 200],
  });

  const opacity = shimmerAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.5, 1, 0.5],
  });

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
