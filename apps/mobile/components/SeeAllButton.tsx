/**
 * SeeAllButton — Standardised "See All" link for section headers.
 *
 * - Accent-tinted text + ForwardIcon when a hero accent is live (falls back
 *   to the brand gold-dim otherwise)
 * - Consistent hitSlop, font, and spacing
 * - accessibilityRole="button" with hint
 */

import React from "react";
import { TouchableOpacity, Text, View } from "react-native";
import { ForwardIcon } from "./Icons";
import { colors } from "../theme/colors";

interface SeeAllButtonProps {
  onPress: () => void;
  label?: string;
  /** Live hero accent — omit (or null) to keep the brand gold-dim look. */
  accent?: string | null;
}

export function SeeAllButton({
  onPress,
  label = "See All",
  accent,
}: SeeAllButtonProps) {
  const tint = accent ?? colors.goldDim;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={`View all ${label.toLowerCase()}`}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text
          style={{
            color: tint,
            fontSize: 12,
            fontFamily: "Inter_500Medium",
          }}
        >
          {label}
        </Text>
        <ForwardIcon width={12} height={12} color={tint} />
      </View>
    </TouchableOpacity>
  );
}
