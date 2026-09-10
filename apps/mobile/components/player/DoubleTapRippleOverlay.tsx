/**
 * DoubleTapRippleOverlay — YouTube-style multi-tap seek animation overlay.
 *
 * Renders curved semi-circular side ripples on left (-10s, -20s...) or right (+10s, +20s...)
 * with animated seek arrows and dynamic duration counter text.
 */

import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  Easing,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../theme/colors";

interface DoubleTapRippleOverlayProps {
  side: "left" | "right" | null;
  seekAmount: number; // e.g. 10, 20, 30...
}

export function DoubleTapRippleOverlay({
  side,
  seekAmount,
}: DoubleTapRippleOverlayProps) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.7);
  const iconTranslateX = useSharedValue(0);

  useEffect(() => {
    if (side) {
      // Reset & animate in
      opacity.value = withTiming(1, { duration: 150 });
      scale.value = withSpring(1, { damping: 12, stiffness: 200 });

      // Pulse arrows inside arc
      const dir = side === "left" ? -8 : 8;
      iconTranslateX.value = withSequence(
        withTiming(dir, { duration: 120, easing: Easing.out(Easing.ease) }),
        withTiming(0, { duration: 120, easing: Easing.in(Easing.ease) }),
      );
    } else {
      // Animate out
      opacity.value = withTiming(0, { duration: 250 });
      scale.value = withTiming(0.8, { duration: 250 });
    }
  }, [side, seekAmount, opacity, scale, iconTranslateX]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: iconTranslateX.value }],
  }));

  const isLeft = side === "left";

  return (
    <Animated.View
      style={[
        styles.overlay,
        isLeft ? styles.overlayLeft : styles.overlayRight,
        containerStyle,
      ]}
      pointerEvents="none"
    >
      <View
        style={[styles.arcShape, isLeft ? styles.arcLeft : styles.arcRight]}
      />
      <Animated.View style={[styles.contentContainer, contentStyle]}>
        <Animated.View style={iconStyle}>
          <Ionicons
            name={isLeft ? "play-back" : "play-forward"}
            size={36}
            color={colors.textPrimary}
          />
        </Animated.View>
        <Text style={styles.secondsText}>{seekAmount} seconds</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: "45%",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 25,
    overflow: "hidden",
  },
  overlayLeft: {
    left: 0,
  },
  overlayRight: {
    right: 0,
  },
  arcShape: {
    position: "absolute",
    top: -50,
    bottom: -50,
    width: "120%",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
  arcLeft: {
    left: "-20%",
    borderTopRightRadius: 200,
    borderBottomRightRadius: 200,
  },
  arcRight: {
    right: "-20%",
    borderTopLeftRadius: 200,
    borderBottomLeftRadius: 200,
  },
  contentContainer: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  secondsText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.3,
    textShadowColor: "rgba(0, 0, 0, 0.75)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
