/**
 * SeeAllButton — Standardised "See All" link for section headers.
 *
 * - Gold-muted (#B88B2A) text + ForwardIcon
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
}

export function SeeAllButton({
  onPress,
  label = "See All",
}: SeeAllButtonProps) {
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
            color: colors.goldDim,
            fontSize: 12,
            fontFamily: "Inter_500Medium",
          }}
        >
          {label}
        </Text>
        <ForwardIcon width={12} height={12} color={colors.goldDim} />
      </View>
    </TouchableOpacity>
  );
}
