/**
 * Privacy Policy — Full privacy disclosure for FilmSnaps.
 *
 * Explains what data is / isn't collected, how it's stored,
 * and the app's commitment to user privacy.
 *
 * Redesigned for readability: larger section titles, more spacing,
 * numbered sections, subtle dividers, softer bullets, unified text color.
 */

import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackIcon } from "../components/Icons";
import { useSafeNavigation } from "@/lib/navigation";
import { colors } from "../theme/colors";
import PrivacyPolicyBody from "../components/PrivacyPolicyBody";

export default function PrivacyScreen() {
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-1"
      style={{ backgroundColor: colors.bg, paddingTop: insets.top }}
    >
      {/* Header */}
      <View className="px-5 pt-4 pb-2 flex-row items-center">
        <TouchableOpacity
          onPress={() => nav.goBack({ fallback: "/(tabs)" })}
          className="w-9 h-9 rounded-full bg-zinc-800/60 items-center justify-center mr-3"
          activeOpacity={0.7}
        >
          <BackIcon width={20} height={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text
          style={{
            fontFamily: "PlayfairDisplay_700Bold",
            fontSize: 22,
            color: colors.textPrimary,
          }}
        >
          Privacy Policy
        </Text>
      </View>

      <PrivacyPolicyBody />
    </View>
  );
}