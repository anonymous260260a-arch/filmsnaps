/**
 * Announcements List — Shows all active announcements in a scrollable feed.
 *
 * Route: /announcements
 * Each card links to its full detail page at /announcement/[id].
 */

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useSafeNavigation } from "@/lib/navigation";
import { fetchAnnouncements } from "../lib/announcements";
import type { Announcement } from "../lib/announcements";
import { useSlotImpression } from "../hooks/useSlotImpression";
import { AdSlot } from "../lib/ads";
import { colors } from "../theme/colors";

// ── Type-to-color mapping (mirrors AnnouncementBanner) ──

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
    label: "New feature",
    accent: colors.gold,
    bg: "rgba(212,162,55,0.08)",
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

// ── Announcement Card ──

function AnnouncementCard({
  announcement,
  onPress,
}: {
  announcement: Announcement;
  onPress: () => void;
}) {
  const meta = TYPE_META[announcement.type] ?? TYPE_META.info;

  const isUrgent =
    announcement.type === "alert" || announcement.type === "critical";

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        backgroundColor: colors.bgSurface,
        borderWidth: 0.5,
        borderColor: colors.borderSubtle,
        borderRadius: 14,
        padding: 16,
        marginHorizontal: 20,
        marginBottom: 12,
      }}
      accessibilityRole="button"
      accessibilityLabel={`${meta.label}: ${announcement.title}`}
    >
      {/* Type + date */}
      <View className="flex-row items-center mb-1.5" style={{ gap: 6 }}>
        {isUrgent ? (
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: meta.accent,
            }}
          />
        ) : null}
        <Text
          style={{
            fontSize: 11,
            fontFamily: "Inter_500Medium",
            color: colors.textTertiary,
          }}
        >
          {meta.label}
        </Text>
        {announcement.date ? (
          <Text style={{ fontSize: 11, color: colors.textTertiary }}>
            · {announcement.date}
          </Text>
        ) : null}
      </View>

      {/* Title */}
      <Text
        className="text-sm mb-1"
        style={{ color: colors.textPrimary, fontFamily: "Inter_500Medium" }}
        numberOfLines={2}
      >
        {announcement.title}
      </Text>

      {/* Subtitle preview */}
      <Text
        style={{
          fontSize: 13,
          lineHeight: 19,
          fontFamily: "Inter_400Regular",
          color: colors.textSecondary,
        }}
        numberOfLines={2}
      >
        {announcement.subtitle}
      </Text>

      {/* Action hint */}
      <View className="flex-row items-center justify-end mt-2">
        <Text
          style={{
            fontSize: 12,
            fontFamily: "Inter_500Medium",
            color: colors.textSecondary,
            marginRight: 4,
          }}
        >
          {announcement.actionLabel || "Read more"}
        </Text>
        <Ionicons
          name="chevron-forward"
          size={14}
          color={colors.textTertiary}
        />
      </View>
    </TouchableOpacity>
  );
}

// ── Main Screen ──

export default function AnnouncementsScreen() {
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  // M1 — impression measurement: candidate ad slot on the announcements page.
  useSlotImpression("announcements_page", "announcements");

  useEffect(() => {
    (async () => {
      try {
        // Fetch with includeDismissed=true so the list shows everything
        const all = await fetchAnnouncements({ includeDismissed: true });
        setAnnouncements(all);
      } catch {
        // Silently handle
      }
      setLoading(false);
    })();
  }, []);

  return (
    <View
      className="flex-1"
      style={{ backgroundColor: colors.bg, paddingTop: insets.top }}
    >
      {/* Header */}
      <View className="px-5 pt-4 pb-3 flex-row items-center">
        <TouchableOpacity
          onPress={() => nav.goBack({ fallback: "/(tabs)" })}
          className="w-9 h-9 rounded-full bg-zinc-800/60 items-center justify-center mr-3"
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text
          style={{
            fontFamily: "PlayfairDisplay_700Bold",
            fontSize: 22,
            color: colors.textPrimary,
          }}
        >
          Announcements
        </Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" color={colors.gold} />
        </View>
      ) : announcements.length === 0 ? (
        // Empty state
        <View className="flex-1 items-center justify-center px-8">
          <View
            className="w-16 h-16 rounded-full items-center justify-center mb-4"
            style={{ backgroundColor: colors.bgTop }}
          >
            <Ionicons
              name="megaphone-outline"
              size={28}
              color={colors.textTertiary}
            />
          </View>
          <Text
            className="text-base font-semibold mb-2"
            style={{ color: colors.textPrimary }}
          >
            No announcements
          </Text>
          <Text
            className="text-sm text-center leading-5"
            style={{ color: colors.textSecondary }}
          >
            There are no announcements right now. Check back later.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Section header */}
          <View className="px-5 pb-2">
            <Text
              className="text-xs leading-5"
              style={{ color: colors.textTertiary }}
            >
              {announcements.length === 1
                ? "1 announcement"
                : `${announcements.length} announcements`}
            </Text>
          </View>

          {announcements.map((a) => (
            <AnnouncementCard
              key={a.id}
              announcement={a}
              onPress={() => nav.push(`/announcement/${a.id}` as any)}
            />
          ))}

          {/* M2 — candidate ad slot at the end of the announcements list. */}
          <AdSlot slot="announcements_page" />
        </ScrollView>
      )}
    </View>
  );
}
