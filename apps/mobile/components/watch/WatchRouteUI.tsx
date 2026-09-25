/**
 * Small presentation pieces for the watch route:
 *  - BackExitToast — floating "Press back again to exit player" toast
 *  - InvalidWatchScreen — full-screen error for malformed route segments
 */
import React from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { colors } from "../../theme/colors";

export function BackExitToast({
  visible,
  opacity,
  bottomInset,
}: {
  visible: boolean;
  opacity: Animated.Value;
  bottomInset: number;
}) {
  if (!visible) return null;
  return (
    <Animated.View
      style={{
        position: "absolute",
        bottom: bottomInset + 24,
        alignSelf: "center",
        opacity,
        zIndex: 9999,
      }}
      pointerEvents="none"
    >
      <View
        className="flex-row items-center px-4 py-2.5 rounded-full border shadow-lg"
        style={{
          backgroundColor: "rgba(14, 14, 17, 0.92)",
          borderColor: colors.borderSubtle,
        }}
      >
        <Ionicons
          name="arrow-back-circle-outline"
          size={16}
          color={colors.gold}
          style={{ marginRight: 8 }}
        />
        <Text
          className="text-xs font-medium"
          style={{ color: colors.textPrimary }}
        >
          Press back again to exit player
        </Text>
      </View>
    </Animated.View>
  );
}

export function InvalidWatchScreen({ onGoBack }: { onGoBack: () => void }) {
  return (
    <View
      className="flex-1 items-center justify-center px-6"
      style={{ backgroundColor: colors.bg }}
    >
      <View
        className="w-16 h-16 rounded-2xl items-center justify-center mb-5 border"
        style={{
          backgroundColor: colors.bgCard,
          borderColor: colors.borderSubtle,
        }}
      >
        <Ionicons name="alert-circle-outline" size={32} color={colors.gold} />
      </View>
      <Text
        className="text-lg font-semibold mb-2 text-center"
        style={{ color: colors.textPrimary, fontFamily: "Inter_600SemiBold" }}
      >
        Invalid Video URL
      </Text>
      <Text
        className="text-sm text-center mb-6 leading-6 max-w-xs"
        style={{ color: colors.textSecondary }}
      >
        This link doesn't point to a valid movie or TV show.
      </Text>
      <TouchableOpacity
        onPress={onGoBack}
        className="rounded-xl py-3 px-8"
        style={{ backgroundColor: colors.gold }}
        activeOpacity={0.8}
      >
        <Text
          className="font-bold text-sm"
          style={{ color: colors.bg, fontFamily: "Inter_600SemiBold" }}
        >
          Go Back
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/** Blurred-backdrop full-screen wrapper for first-run overlays (language prompt). */
export function BackdropGate({
  backdropUrl,
  children,
}: {
  backdropUrl?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="flex-1" style={{ backgroundColor: colors.playerBg }}>
      {backdropUrl ? (
        <Image
          source={{ uri: backdropUrl }}
          contentFit="cover"
          blurRadius={12}
          style={StyleSheet.absoluteFill}
          transition={200}
        />
      ) : null}
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(7,7,8,0.72)" }]}
      />
      {children}
    </View>
  );
}

