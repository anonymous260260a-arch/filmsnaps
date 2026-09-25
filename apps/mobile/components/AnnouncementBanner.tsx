/**
 * AnnouncementBanner — Inline feed notice card under the home hero.
 *
 * - Color-coded by type (feature/alert/info/critical)
 * - Dismissible with X (persists to AsyncStorage)
 * - Secondary visual weight: quieter and smaller than content rows
 * - maxHeight ~120dp (inner content scrolls if longer — parent ScrollView)
 * - Entrance/exit animations are supplied by the parent via
 *   reanimated FadeInDown / FadeOutUp on the wrapper (Phase 1D FIX 1)
 *
 * Usage:
 *   <AnnouncementBanner announcement={ann} onDismiss={handleDismiss} />
 */

import React from "react";
import { View, Text, TouchableOpacity, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeNavigation } from "@/lib/navigation";
import type { Announcement } from "../lib/announcements";
import { colors } from "../theme/colors";

// ── Type-to-color mapping ──

const TYPE_STYLES: Record<
  Announcement["type"],
  {
    accent: string;
    bg: string;
    border: string;
    icon: keyof typeof Ionicons.glyphMap;
    iconColor: string;
  }
> = {
  feature: {
    accent: colors.gold,
    bg: "rgba(212,162,55,0.08)",
    border: "rgba(212,162,55,0.2)",
    icon: "megaphone-outline",
    iconColor: colors.gold,
  },
  alert: {
    accent: colors.amber,
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.2)",
    icon: "alert-circle-outline",
    iconColor: colors.amber,
  },
  info: {
    accent: colors.info,
    bg: "rgba(91,156,246,0.08)",
    border: "rgba(91,156,246,0.2)",
    icon: "information-circle-outline",
    iconColor: colors.info,
  },
  critical: {
    accent: colors.error,
    bg: "rgba(239,68,68,0.08)",
    border: "rgba(239,68,68,0.2)",
    icon: "warning-outline",
    iconColor: colors.error,
  },
};

// ── Component ──

interface AnnouncementBannerProps {
  announcement: Announcement;
  onDismiss: (id: string) => void;
}

export function AnnouncementBanner({
  announcement,
  onDismiss,
}: AnnouncementBannerProps) {
  const nav = useSafeNavigation();
  const style = TYPE_STYLES[announcement.type] ?? TYPE_STYLES.info;

  const handlePress = () => {
    if (announcement.externalUrl) {
      Linking.openURL(announcement.externalUrl).catch(() => {});
    } else if (announcement.detailRoute) {
      nav.push(announcement.detailRoute as any);
    }
  };

  const isDismissible = announcement.dismissible !== false;

  return (
    <View style={{ marginBottom: 8 }}>
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={
          announcement.detailRoute || announcement.externalUrl ? 0.7 : 1
        }
        disabled={!announcement.detailRoute && !announcement.externalUrl}
        accessibilityRole="button"
        accessibilityLabel={`${announcement.type} announcement: ${announcement.title}`}
      >
        <View
          className="rounded-xl overflow-hidden"
          style={{
            backgroundColor: style.bg,
            borderWidth: 1,
            borderColor: style.border,
          }}
        >
          {/* Top accent line */}
          <View
            style={{
              height: 2,
              backgroundColor: style.accent,
              opacity: 0.6,
            }}
          />

          <View className="flex-row items-start px-3 py-2.5">
            {/* Type icon — compact */}
            <View
              className="w-7 h-7 rounded-lg items-center justify-center mr-2.5 mt-0.5"
              style={{ backgroundColor: `${style.accent}18` }}
            >
              <Ionicons name={style.icon} size={14} color={style.iconColor} />
            </View>

            {/* Text content */}
            <View className="flex-1">
              <Text
                className="text-xs font-semibold mb-0.5"
                style={{
                  color: style.accent,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                {announcement.title}
              </Text>
              <Text
                className="text-xs leading-4"
                style={{ color: colors.textSecondary }}
                numberOfLines={2}
              >
                {announcement.subtitle}
              </Text>
            </View>

            {/* Dismiss button */}
            {isDismissible && (
              <TouchableOpacity
                onPress={() => onDismiss(announcement.id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                className="ml-2 -mr-1 -mt-0.5"
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityLabel="Dismiss announcement"
              >
                <Ionicons name="close" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Detail chevron footer (only if has a detail route) */}
          {(announcement.detailRoute || announcement.externalUrl) && (
            <TouchableOpacity
              onPress={handlePress}
              activeOpacity={0.6}
              className="flex-row items-center justify-center py-1.5"
              style={{
                borderTopWidth: 0.5,
                borderTopColor: style.border,
              }}
            >
              <Text
                className="text-[11px] font-semibold mr-1"
                style={{ color: style.accent }}
              >
                {announcement.actionLabel || "Learn More"}
              </Text>
              <Ionicons name="chevron-forward" size={12} color={style.accent} />
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
}
