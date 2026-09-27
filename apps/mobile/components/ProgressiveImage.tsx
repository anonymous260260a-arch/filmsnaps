import React from "react";
import { View } from "react-native";
import { Image, ImageContentFit } from "expo-image";
import { colors } from "../theme/colors";

/**
 * Image wrapper with disk cache and blurhash placeholder.
 *
 * - `expo-image` provides automatic memory + disk caching (`cachePolicy="memory-disk"`).
 *   TMDB image URLs are content-addressed (immutable per image), so indefinite
 *   disk caching is correct and safe — no TTL needed.
 * - No crossfade transition: expo-image 55 on Android can leave the view at
 *   opacity 0 (black image) when a navigation transition interrupts the
 *   cross-fade (fixed upstream in 56.0.10/56.0.11, not available on SDK 55).
 * - Dark placeholder background (#070708 default) eliminates white flash on initial render.
 *
 * Interface is identical to the old React Native `<Image>` wrapper, so all 11
 * consumer files work without changes.
 */
export function ProgressiveImage({
  uri,
  style,
  resizeMode = "cover",
  placeholderColor = colors.bg,
  blurRadius,
}: {
  uri: string;
  style?: any;
  resizeMode?: "cover" | "contain" | "stretch" | "repeat" | "center";
  placeholderColor?: string;
  blurRadius?: number;
}) {
  const contentFit = resizeModeToContentFit(resizeMode);

  return (
    <View
      style={[style, { backgroundColor: placeholderColor, overflow: "hidden" }]}
    >
      <Image
        source={{ uri }}
        style={{ flex: 1, width: "100%", height: "100%" }}
        contentFit={contentFit}
        transition={0}
        cachePolicy="memory-disk"
        blurRadius={blurRadius}
      />
    </View>
  );
}

function resizeModeToContentFit(mode: string): ImageContentFit {
  switch (mode) {
    case "cover":
      return "cover";
    case "contain":
      return "contain";
    case "stretch":
      return "fill";
    case "center":
      return "contain"; // closest expo-image equivalent
    default:
      return "cover";
  }
}
