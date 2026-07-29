/**
 * Announcement Detail — Full-page view for a single announcement.
 *
 * Shows the complete announcement content with rich formatting:
 *   - Hero section with type-specific color banner
 *   - Full title, subtitle, and detailed body text
 *   - Action button (if configured)
 *   - Date display
 *
 * Route: /announcement/[id]
 * Data is read from cached announcements in AsyncStorage (via announcement service).
 */

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeNavigation } from "@/lib/navigation";
import {
  fetchAnnouncements,
  dismissAnnouncement,
} from "../../lib/announcements";
import type { Announcement } from "../../lib/announcements";
import { colors } from "../../theme/colors";

// ── Type-to-color and labels ──

const TYPE_META: Record<
  Announcement["type"],
  {
    label: string;
    accent: string;
    bg: string;
    icon: keyof typeof Ionicons.glyphMap;
  }
> = {
  feature: {
    label: "New Feature",
    accent: colors.gold,
    bg: colors.bgActiveDrag,
    icon: "megaphone-outline",
  },
  alert: {
    label: "Alert",
    accent: colors.amber,
    bg: "rgba(245,158,11,0.08)",
    icon: "alert-circle-outline",
  },
  info: {
    label: "Info",
    accent: colors.info,
    bg: "rgba(91,156,246,0.08)",
    icon: "information-circle-outline",
  },
  critical: {
    label: "Important",
    accent: colors.error,
    bg: "rgba(239,68,68,0.08)",
    icon: "warning-outline",
  },
};

export default function AnnouncementDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();

  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch announcements and find the one matching the id
  useEffect(() => {
    (async () => {
      try {
        // Fetch with includeDismissed=true so previously dismissed announcements
        // can still be viewed from a deep link / share
        const all = await fetchAnnouncements({
          includeDismissed: true,
          force: true,
        });
        const found = all.find((a) => a.id === id);
        if (found) {
          setAnnouncement(found);
        } else {
          // Could not find announcement — possibly expired
          // The UI will show a "not found" state
        }
      } catch {
        // Silently handle
      }
      setLoading(false);
    })();
  }, [id]);

  const handleAction = () => {
    if (!announcement) return;
    if (announcement.externalUrl) {
      Linking.openURL(announcement.externalUrl).catch(() => {});
    } else if (announcement.detailRoute) {
      nav.push(announcement.detailRoute as any);
    }
  };

  const typeMeta = announcement
    ? (TYPE_META[announcement.type] ?? TYPE_META.info)
    : null;

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
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        // Never show blank — show loader centered
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" color={colors.gold} />
        </View>
      ) : !announcement ? (
        // Not found state
        <View className="flex-1 items-center justify-center px-8">
          <View
            className="w-16 h-16 rounded-full items-center justify-center mb-4"
            style={{ backgroundColor: colors.bgTop }}
          >
            <Ionicons
              name="document-outline"
              size={28}
              color={colors.textTertiary}
            />
          </View>
          <Text
            className="text-base font-semibold mb-2"
            style={{ color: colors.textPrimary }}
          >
            Announcement not found
          </Text>
          <Text
            className="text-sm text-center leading-5 mb-6"
            style={{ color: colors.textSecondary }}
          >
            This announcement may have expired or the link is invalid.
          </Text>
          <TouchableOpacity
            onPress={() => nav.goBack({ fallback: "/(tabs)" })}
            className="bg-zinc-800 rounded-xl py-3 px-6"
            activeOpacity={0.7}
          >
            <Text className="text-zinc-300 font-bold text-sm">Go Back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero banner */}
          {typeMeta && (
            <View
              className="mx-5 rounded-2xl overflow-hidden mb-5"
              style={{
                backgroundColor: typeMeta.bg,
                borderWidth: 1,
                borderColor: `${typeMeta.accent}30`,
              }}
            >
              {/* Accent top bar */}
              <View style={{ height: 3, backgroundColor: typeMeta.accent }} />

              <View className="px-5 py-5">
                {/* Type badge */}
                <View
                  className="flex-row items-center self-start rounded-full px-3 py-1 mb-3"
                  style={{
                    backgroundColor: `${typeMeta.accent}18`,
                    borderWidth: 0.5,
                    borderColor: `${typeMeta.accent}30`,
                  }}
                >
                  <Ionicons
                    name={typeMeta.icon}
                    size={12}
                    color={typeMeta.accent}
                  />
                  <Text
                    className="text-[10px] font-semibold ml-1.5"
                    style={{ color: typeMeta.accent }}
                  >
                    {typeMeta.label}
                  </Text>
                </View>

                {/* Title */}
                <Text
                  className="text-xl font-bold mb-1"
                  style={{
                    color: colors.textPrimary,
                    fontFamily: "PlayfairDisplay_700Bold",
                  }}
                >
                  {announcement.title}
                </Text>

                {/* Date */}
                {announcement.date && (
                  <Text
                    className="text-[10px] mt-1"
                    style={{ color: colors.textTertiary }}
                  >
                    {announcement.date}
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* Content */}
          <View className="px-5">
            {/* Subtitle as lead paragraph */}
            <Text
              className="text-sm leading-6 mb-5"
              style={{ color: colors.textSecondary }}
            >
              {announcement.subtitle}
            </Text>

            {/* Body content — rich paragraphs */}
            {announcement.body && announcement.body.length > 0 && (
              <View className="mb-5">
                {announcement.body.map((paragraph, i) => (
                  <Text
                    key={i}
                    className="text-sm leading-6 mb-4"
                    style={{ color: colors.textSecondary }}
                  >
                    {paragraph}
                  </Text>
                ))}
              </View>
            )}

            {/* Action button */}
            {(announcement.externalUrl || announcement.detailRoute) && (
              <TouchableOpacity
                onPress={handleAction}
                activeOpacity={0.8}
                className="rounded-xl py-3.5 items-center mb-6"
                style={{
                  backgroundColor: typeMeta?.accent ?? colors.gold,
                }}
                accessibilityRole="button"
                accessibilityLabel={announcement.actionLabel || "Learn More"}
              >
                <Text
                  className="text-sm font-bold"
                  style={{ color: colors.voidBlack }}
                >
                  {announcement.actionLabel || "Learn More"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
