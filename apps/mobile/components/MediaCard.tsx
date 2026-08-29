import React, { useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  Animated,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getImageUrl } from "@filmsnaps/shared";
import { colors } from "../theme/colors";
import { ProgressiveImage } from "./ProgressiveImage";
import { useMediaDownloadState } from "../lib/download/context";
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
 * - Subtle border highlight to define dark covers
 * - Rating star inline with title
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

  // Download state badge
  const downloadState = useMediaDownloadState(
    (item.media_type as "movie" | "tv") || "movie",
    String(item.id),
  );

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
          style={{
            width: cardWidth,
            height: cardHeight,
            borderRadius: 12,
            overflow: "hidden",
            backgroundColor: colors.bgElevated,
            borderWidth: 0.5,
            borderColor: colors.borderSubtle,
          }}
        >
          {item.poster_path ? (
            <ProgressiveImage
              uri={posterUrl}
              style={{ width: cardWidth, height: cardHeight }}
              resizeMode="cover"
            />
          ) : (
            <View className="flex-1 items-center justify-center bg-elevated px-2">
              <Ionicons
                name="film-outline"
                size={28}
                color={colors.textTertiary}
                style={{ marginBottom: 4 }}
              />
              <Text
                className="text-text-tertiary text-xs text-center"
                numberOfLines={3}
              >
                {item.title || item.name}
              </Text>
            </View>
          )}

          {/* Download state badge — top-right corner */}
          {downloadState.state === "completed" && (
            <View style={styles.offlineBadge}>
              <Ionicons
                name="cloud-offline"
                size={10}
                color={colors.successGreen}
              />
            </View>
          )}
          {downloadState.state === "downloading" && (
            <View style={styles.downloadingBadge}>
              <Ionicons name="cloud-download" size={10} color={colors.gold} />
            </View>
          )}
        </View>

        {/* Title row with inline rating */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 6,
          }}
        >
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 12,
              fontFamily: "Inter_500Medium",
              flex: 1,
              marginRight: 4,
            }}
            numberOfLines={1}
          >
            {item.title || item.name}
          </Text>
          {item.vote_average != null && item.vote_average > 0 && (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Ionicons
                name="star"
                size={10}
                color={colors.gold}
                style={{ marginRight: 2 }}
              />
              <Text
                style={{
                  color: colors.gold,
                  fontSize: 10,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                {item.vote_average.toFixed(1)}
              </Text>
            </View>
          )}
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  offlineBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.5)",
  },
  downloadingBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(212, 162, 55, 0.5)",
  },
});
