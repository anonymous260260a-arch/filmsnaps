import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { getImageUrl } from "@filmsnaps/shared";
import { ProgressiveImage } from "./ProgressiveImage";
import { typography } from "../theme/typography";
import { colors } from "../theme/colors";
import { FilmGrain } from "./FilmGrain";
import type { Movie } from "@filmsnaps/shared";

interface HeroProps {
  item: Movie;
  onWatchPress: (item: Movie) => void;
  onDetailsPress?: (item: Movie) => void;
}

export function Hero({ item, onWatchPress, onDetailsPress }: HeroProps) {
  const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = useWindowDimensions();
  const HERO_HEIGHT = Math.min(SCREEN_HEIGHT * 0.52, 430);
  const [overviewExpanded, setOverviewExpanded] = useState(false);

  const backdropUrl = getImageUrl(item.backdrop_path, "w780");
  const title = item.title || item.name || "";
  const overview = item.overview || "";
  const rating = item.vote_average ?? 0;
  const year =
    item.release_date?.split("-")[0] ??
    item.first_air_date?.split("-")[0] ??
    "";

  return (
    <View
      style={{
        height: HERO_HEIGHT,
        position: "relative",
        overflow: "hidden",
        borderBottomLeftRadius: 28,
        borderBottomRightRadius: 28,
      }}
    >
      {/* ── Backdrop image — full bleed ── */}
      {item.backdrop_path ? (
        <ProgressiveImage
          uri={backdropUrl}
          style={{
            width: SCREEN_WIDTH,
            height: HERO_HEIGHT,
            position: "absolute",
          }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{
            width: SCREEN_WIDTH,
            height: HERO_HEIGHT,
            position: "absolute",
            backgroundColor: colors.bg,
          }}
        />
      )}

      {/* ── Film grain texture overlay ── */}
      <FilmGrain opacity={0.03} />

      {/* ── Cinematic gradient ── */}
      <LinearGradient
        colors={[
          colors.heroGradientTransparent,
          colors.heroGradientTransparent,
          colors.heroGradientMid,
          colors.heroGradientSolid,
        ]}
        locations={[0, 0.35, 0.7, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
        pointerEvents="none"
      />

      {/* ── Content block — anchored to bottom ── */}
      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          paddingHorizontal: 20,
          paddingBottom: 24,
          paddingTop: 36,
          zIndex: 2,
        }}
      >
        {/* Rating & Format badge */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginBottom: 8,
            gap: 8,
          }}
        >
          {rating > 0 && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: "rgba(14, 14, 17, 0.80)",
                borderWidth: 0.5,
                borderColor: "rgba(212, 162, 55, 0.35)",
                borderRadius: 9999,
                paddingHorizontal: 8,
                paddingVertical: 2.5,
              }}
            >
              <Ionicons
                name="star"
                size={12}
                color={colors.gold}
                style={{ marginRight: 4 }}
              />
              <Text
                style={{ color: colors.gold, fontSize: 11, fontWeight: "700" }}
              >
                {rating.toFixed(1)}
              </Text>
            </View>
          )}

          {year ? (
            <View
              style={{
                backgroundColor: "rgba(255, 255, 255, 0.08)",
                borderRadius: 9999,
                paddingHorizontal: 8,
                paddingVertical: 2.5,
              }}
            >
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: 11,
                  fontFamily: "Inter_500Medium",
                }}
              >
                {year}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Title */}
        <Text
          style={[
            typography.display,
            {
              fontSize: 26,
              lineHeight: 32,
              marginBottom: 6,
              color: colors.textPrimary,
            },
          ]}
          numberOfLines={2}
        >
          {title}
        </Text>

        {/* Overview */}
        {overview ? (
          <View style={{ marginBottom: 16 }}>
            <Text
              style={[
                typography.body,
                { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
              ]}
              numberOfLines={overviewExpanded ? undefined : 2}
            >
              {overview}
            </Text>
            {overview.length > 90 && (
              <TouchableOpacity
                onPress={() => setOverviewExpanded(!overviewExpanded)}
                activeOpacity={0.7}
                style={{ marginTop: 2 }}
              >
                <Text
                  style={{
                    color: colors.gold,
                    fontSize: 11,
                    fontFamily: "Inter_500Medium",
                  }}
                >
                  {overviewExpanded ? "Show less" : "Read more"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        {/* Dual Actions CTA: Watch Now + Details */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {/* Primary: Watch Now */}
          <TouchableOpacity
            onPress={() => onWatchPress(item)}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel={`Watch ${title}`}
            accessibilityHint="Opens the video player"
            style={{
              flex: 1,
              backgroundColor: colors.gold,
              borderRadius: 12,
              paddingVertical: 13,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              ...Platform.select({
                ios: {
                  shadowColor: colors.gold,
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.35,
                  shadowRadius: 10,
                },
                android: { elevation: 6 },
              }),
            }}
          >
            <Ionicons
              name="play"
              size={16}
              color={colors.bg}
              style={{ marginRight: 6 }}
            />
            <Text
              style={{
                fontFamily: "Inter_600SemiBold",
                fontSize: 14,
                color: colors.bg,
              }}
            >
              Watch Now
            </Text>
          </TouchableOpacity>

          {/* Secondary: Details */}
          {onDetailsPress && (
            <TouchableOpacity
              onPress={() => onDetailsPress(item)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`View details for ${title}`}
              style={{
                backgroundColor: "rgba(14, 14, 17, 0.75)",
                borderWidth: 1,
                borderColor: colors.borderSubtle,
                borderRadius: 12,
                paddingVertical: 13,
                paddingHorizontal: 16,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons
                name="information-circle-outline"
                size={18}
                color={colors.textPrimary}
                style={{ marginRight: 6 }}
              />
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                  color: colors.textPrimary,
                }}
              >
                Details
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}
