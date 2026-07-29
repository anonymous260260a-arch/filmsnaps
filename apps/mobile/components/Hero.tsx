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
}

export function Hero({ item, onWatchPress }: HeroProps) {
  const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = useWindowDimensions();
  const HERO_HEIGHT = Math.min(SCREEN_HEIGHT * 0.48, 400);
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
      style={{ height: HERO_HEIGHT, position: "relative", overflow: "hidden" }}
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
      <FilmGrain opacity={0.04} />

      {/* ── Letterbox bars — 4 px void-black ── */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: 4,
          backgroundColor: colors.bg,
          zIndex: 1,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 4,
          backgroundColor: colors.bg,
          zIndex: 1,
        }}
      />

      {/* ── Cinematic gradient — the actual fix ──
          4 stops:
            0%   → fully transparent  (top of hero, image fully visible)
           40%   → still transparent  (image breathes)
           72%   → 55% void           (gentle darkening begins)
          100%   → 93% void           (text zone, readable but not a wall)
      */}
      <LinearGradient
        colors={[
          colors.heroGradientTransparent,
          colors.heroGradientTransparent,
          colors.heroGradientMid,
          colors.heroGradientSolid,
        ]}
        locations={[0, 0.4, 0.72, 1]}
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
          left: 4,
          right: 4,
          paddingHorizontal: 20,
          paddingBottom: 28,
          paddingTop: 40,
          zIndex: 2,
        }}
      >
        {/* Rating badge */}
        {rating > 0 && (
          <View
            style={{
              alignSelf: "flex-start",
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: colors.goldRatingBg,
              borderWidth: 0.5,
              borderColor: colors.goldRatingBorder,
              borderRadius: 4,
              paddingHorizontal: 8,
              paddingVertical: 3,
              marginBottom: 10,
            }}
          >
            <Ionicons
              name="star"
              size={14}
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

        {/* Title */}
        <Text
          style={[typography.display, { marginBottom: 6 }]}
          numberOfLines={2}
        >
          {title}
        </Text>

        {/* Metadata row */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          {year ? (
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {year}
            </Text>
          ) : null}
          {year && (
            <View
              style={{
                width: 2,
                height: 2,
                borderRadius: 1,
                backgroundColor: colors.textTertiary,
                marginHorizontal: 8,
              }}
            />
          )}
          <Text
            style={[typography.caption, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {rating.toFixed(1)}
          </Text>
          <View
            style={{
              width: 2,
              height: 2,
              borderRadius: 1,
              backgroundColor: colors.textTertiary,
              marginHorizontal: 8,
            }}
          />
          <Text
            style={[typography.caption, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            Movie
          </Text>
        </View>

        {/* Overview */}
        {overview ? (
          <View style={{ marginBottom: 20 }}>
            <Text
              style={[typography.body, { color: colors.textSecondary }]}
              numberOfLines={overviewExpanded ? undefined : 2}
            >
              {overview}
            </Text>
            {overview.length > 100 && (
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
                  {overviewExpanded ? "Less" : "More"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        {/* Watch Now CTA */}
        <TouchableOpacity
          onPress={() => onWatchPress(item)}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel={`Watch ${title}`}
          accessibilityHint="Opens the video player"
          style={{
            backgroundColor: colors.gold,
            borderRadius: 10,
            paddingVertical: 14,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            ...Platform.select({
              ios: {
                shadowColor: colors.gold,
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.35,
                shadowRadius: 12,
              },
              android: { elevation: 8 },
            }),
          }}
        >
          <Ionicons
            name="play"
            size={16}
            color={colors.bg}
            style={{ marginRight: 8 }}
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
      </View>
    </View>
  );
}
