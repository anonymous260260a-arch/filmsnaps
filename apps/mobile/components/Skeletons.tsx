import React from "react";
import { View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme/colors";

function ShimmerBar({
  width,
  height,
  borderRadius = 4,
  style,
}: {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: any;
}) {
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
      <View
        style={{
          flex: 1,
          backgroundColor: colors.skeletonHighlight,
          opacity: 0.45,
        }}
      />
    </View>
  );
}

/**
 * Skeleton loading state for movie/TV detail screens.
 * Exactly matches the modern layout:
 * - Floating top glass navigation bar (back on left, bookmark & share on right)
 * - Backdrop header with fade
 * - Elevated poster + spaced info column (Title, Rating/Year/Runtime, Genres)
 * - Full-width Watch CTA + Secondary Action Row (Trailer & Download)
 * - Overview lines + Cast avatars
 */
export function DetailSkeleton() {
  const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const BACKDROP_HEIGHT = Math.min(SCREEN_HEIGHT * 0.42, 350);
  const POSTER_WIDTH = 104;
  const POSTER_OVERLAP = 52;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* ── Floating Top Glass Bar ── */}
      <View
        style={{
          position: "absolute",
          top: insets.top + 8,
          left: 16,
          right: 16,
          zIndex: 20,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Circular Back button */}
        <ShimmerBar width={38} height={38} borderRadius={19} />

        {/* Right actions: Bookmark & Share */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <ShimmerBar width={38} height={38} borderRadius={19} />
          <ShimmerBar width={38} height={38} borderRadius={19} />
        </View>
      </View>

      {/* ── Backdrop skeleton ── */}
      <ShimmerBar
        width={SCREEN_WIDTH}
        height={BACKDROP_HEIGHT}
        borderRadius={0}
        style={{ backgroundColor: colors.skeletonBgAlt }}
      />

      {/* ── Content Section ── */}
      <View style={{ paddingHorizontal: 16, marginTop: -POSTER_OVERLAP }}>
        {/* Poster + Info row */}
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {/* Elevated Poster */}
          <ShimmerBar
            width={POSTER_WIDTH}
            height={POSTER_WIDTH * 1.5}
            borderRadius={12}
            style={{
              backgroundColor: colors.skeletonBg,
              borderWidth: 0.5,
              borderColor: colors.borderSubtle,
            }}
          />

          {/* Info column */}
          <View style={{ flex: 1, marginLeft: 18, justifyContent: "center" }}>
            {/* Title */}
            <ShimmerBar width="85%" height={20} borderRadius={6} />

            {/* Rating + Year + Runtime row */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                marginTop: 8,
              }}
            >
              <ShimmerBar width={48} height={18} borderRadius={6} />
              <ShimmerBar width={42} height={18} borderRadius={6} />
              <ShimmerBar width={54} height={18} borderRadius={6} />
            </View>

            {/* Genre badges */}
            <View style={{ flexDirection: "row", gap: 4, marginTop: 8 }}>
              <ShimmerBar width={46} height={16} borderRadius={4} />
              <ShimmerBar width={52} height={16} borderRadius={4} />
              <ShimmerBar width={44} height={16} borderRadius={4} />
            </View>
          </View>
        </View>

        {/* ── Action Buttons ── */}
        <View style={{ marginTop: 18 }}>
          {/* Primary Watch CTA */}
          <ShimmerBar
            width="100%"
            height={48}
            borderRadius={12}
            style={{ backgroundColor: "rgba(212, 162, 55, 0.18)" }}
          />

          {/* Secondary Action Row: Trailer & Download */}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <ShimmerBar
              width="48.5%"
              height={40}
              borderRadius={12}
              style={{ backgroundColor: colors.skeletonBg }}
            />
            <ShimmerBar
              width="48.5%"
              height={40}
              borderRadius={12}
              style={{ backgroundColor: colors.skeletonBg }}
            />
          </View>
        </View>

        {/* ── Overview ── */}
        <View style={{ marginTop: 22 }}>
          <ShimmerBar width={80} height={16} borderRadius={4} />
          <ShimmerBar
            width="100%"
            height={12}
            borderRadius={4}
            style={{ marginTop: 10 }}
          />
          <ShimmerBar
            width="94%"
            height={12}
            borderRadius={4}
            style={{ marginTop: 6 }}
          />
          <ShimmerBar
            width="75%"
            height={12}
            borderRadius={4}
            style={{ marginTop: 6 }}
          />
        </View>

        {/* ── Cast Carousel ── */}
        <View style={{ marginTop: 24 }}>
          <ShimmerBar width={60} height={16} borderRadius={4} />
          <View style={{ flexDirection: "row", marginTop: 12, gap: 14 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <View key={i} style={{ alignItems: "center" }}>
                <ShimmerBar width={54} height={54} borderRadius={27} />
                <ShimmerBar
                  width={42}
                  height={10}
                  borderRadius={4}
                  style={{ marginTop: 6 }}
                />
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * Skeleton loading state for person detail screen.
 */
export function PersonSkeleton() {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}
    >
      {/* Back button */}
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <ShimmerBar width={80} height={28} borderRadius={14} />
      </View>

      {/* Avatar + Name */}
      <View
        style={{
          alignItems: "center",
          paddingHorizontal: 24,
          paddingBottom: 24,
        }}
      >
        <ShimmerBar width={120} height={120} borderRadius={60} />
        <ShimmerBar
          width={140}
          height={22}
          borderRadius={4}
          style={{ marginTop: 16 }}
        />
        <ShimmerBar
          width={90}
          height={14}
          borderRadius={4}
          style={{ marginTop: 8 }}
        />
        <ShimmerBar
          width={100}
          height={12}
          borderRadius={4}
          style={{ marginTop: 8 }}
        />
        <ShimmerBar
          width={130}
          height={12}
          borderRadius={4}
          style={{ marginTop: 6 }}
        />
      </View>

      {/* Biography */}
      <View style={{ paddingHorizontal: 24, marginBottom: 32 }}>
        <ShimmerBar width={80} height={18} borderRadius={4} />
        <ShimmerBar
          width="100%"
          height={12}
          borderRadius={4}
          style={{ marginTop: 12 }}
        />
        <ShimmerBar
          width="95%"
          height={12}
          borderRadius={4}
          style={{ marginTop: 6 }}
        />
        <ShimmerBar
          width="80%"
          height={12}
          borderRadius={4}
          style={{ marginTop: 6 }}
        />
        <ShimmerBar
          width="90%"
          height={12}
          borderRadius={4}
          style={{ marginTop: 6 }}
        />
      </View>
    </View>
  );
}

/**
 * Skeleton loading state for card rails/grids.
 */
export function MediaCardSkeleton({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  return (
    <View
      style={{
        width,
        height,
        borderRadius: 12,
        backgroundColor: colors.skeletonBg,
        borderWidth: 0.5,
        borderColor: colors.borderSubtle,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: colors.skeletonHighlight,
          opacity: 0.45,
        }}
      />
    </View>
  );
}
