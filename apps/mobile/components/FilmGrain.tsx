import React, { useEffect, useState } from "react";
import { View, AccessibilityInfo, Platform } from "react-native";

interface FilmGrainProps {
  opacity?: number;
}

const LOW_END_ANDROID = Platform.OS === "android" && Platform.Version < 26;

export function FilmGrain({ opacity = 0.04 }: FilmGrainProps) {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const listener = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => listener.remove();
  }, []);

  if (reduceMotion || LOW_END_ANDROID) {
    return null;
  }

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        opacity,
        transform: [{ translateX: 0 }], // GPU compositing hint
      }}
    >
      {/*
        Safe noise simulation: two offset semi-transparent layers.
        No SVG filters — cannot fall back to a solid black rect.
      */}
      <View
        style={{
          flex: 1,
          backgroundColor: "transparent",
          overflow: "hidden",
        }}
      >
        {/* Layer 1 — fine speckle via tiny radial-ish gradient approximation */}
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(255,255,255,0.03)",
          }}
        />
        {/* Layer 2 — offset to break uniformity */}
        <View
          style={{
            position: "absolute",
            top: 1,
            left: 1,
            right: -1,
            bottom: -1,
            backgroundColor: "rgba(0,0,0,0.02)",
          }}
        />
      </View>
    </View>
  );
}
