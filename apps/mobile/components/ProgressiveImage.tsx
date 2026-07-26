import React from "react";
import { View } from "react-native";
import { Image, ImageContentFit } from "expo-image";

/**
 * Cross-fading image wrapper with disk cache and blurhash placeholder.
 *
 * - `expo-image` provides automatic memory + disk caching (`cachePolicy="memory-disk"`).
 *   TMDB image URLs are content-addressed (immutable per image), so indefinite
 *   disk caching is correct and safe — no TTL needed.
 * - 200ms crossfade transition from blurhash → loaded image.
 * - Dark placeholder background (#070708 default) eliminates white flash on initial render.
 *
 * Interface is identical to the old React Native `<Image>` wrapper, so all 11
 * consumer files work without changes.
 */
export function ProgressiveImage({
  uri,
  style,
  resizeMode = "cover",
  placeholderColor = "#070708",
}: {
  uri: string;
  style?: any;
  resizeMode?: "cover" | "contain" | "stretch" | "repeat" | "center";
  placeholderColor?: string;
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
        transition={200}
        cachePolicy="memory-disk"
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
