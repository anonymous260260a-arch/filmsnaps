import React, { useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  Animated,
} from "react-native";
import { getImageUrl } from "@filmsnaps/shared";
import { ProgressiveImage } from "./ProgressiveImage";
import type { Movie } from "@filmsnaps/shared";

interface MediaCardProps {
  item: Movie;
  onPress: (item: Movie) => void;
  variant?: "default" | "search";
}

/**
 * Movie/show poster card with 2:3 aspect ratio.
 *
 * - Press animation: spring scale 1.0 -> 0.96
 * - Rating star inline with title (moved from poster overlay for cleaner look)
 * - Title in #A1A1AA, 12px, single line truncated
 */
export function MediaCard({
  item,
  onPress,
  variant = "default",
}: MediaCardProps) {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const cardWidth =
    variant === "search"
      ? (SCREEN_WIDTH - 16 * 2 - 8 * 2) / 3
      : (SCREEN_WIDTH - 48) / 3;
  const cardHeight = cardWidth * 1.5; // 2:3 ratio

  const posterUrl = getImageUrl(item.poster_path, "w342");

  const onPressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.96,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [scaleAnim]);

  const onPressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [scaleAnim]);

  const title = item.title || item.name || "Untitled";
  const accessibilityLabel = `${title}${item.vote_average ? `, rated ${item.vote_average.toFixed(1)} out of 10` : ""}`;

  return (
    <TouchableOpacity
      onPress={() => onPress(item)}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      activeOpacity={1}
      style={{ marginBottom: 14 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Double tap to view details"
    >
      <Animated.View
        style={{
          width: cardWidth,
          transform: [{ scale: scaleAnim }],
        }}
      >
        <View
          className="bg-elevated rounded-xl overflow-hidden"
          style={{ width: cardWidth, height: cardHeight }}
        >
          {item.poster_path ? (
            <ProgressiveImage
              uri={posterUrl}
              style={{ width: cardWidth, height: cardHeight }}
              resizeMode="cover"
            />
          ) : (
            <View className="flex-1 items-center justify-center bg-elevated px-2">
              <Text className="text-text-tertiary text-3xl mb-1">{"🎬"}</Text>
              <Text
                className="text-text-tertiary text-xs text-center"
                numberOfLines={3}
              >
                {item.title || item.name}
              </Text>
            </View>
          )}
        </View>

        {/* Title row with inline rating — no overlay on poster */}
        <View
          style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}
        >
          <Text
            style={{
              color: "#A1A1AA",
              fontSize: 12,
              fontFamily: "Inter_500Medium",
              flex: 1,
            }}
            numberOfLines={1}
          >
            {item.title || item.name}
          </Text>
          {item.vote_average != null && item.vote_average > 0 && (
            <Text style={{ color: "#D4A237", fontSize: 10, marginLeft: 4 }}>
              {"★"} {item.vote_average.toFixed(1)}
            </Text>
          )}
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}
