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
    label: "New Feature",
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

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      className="mx-5 mb-3 rounded-xl overflow-hidden"
      style={{
        backgroundColor: colors.bgSurface,
        borderWidth: 0.5,
        borderColor: colors.bgTop,
      }}
      accessibilityRole="button"
      accessibilityLabel={`${meta.label}: ${announcement.title}`}
    >
      {/* Left accent strip */}
      <View className="flex-row">
        <View style={{ width: 3, backgroundColor: meta.accent }} />
        <View className="flex-1 px-4 py-3.5">
          {/* Type badge */}
          <View
            className="flex-row items-center self-start rounded-full px-2.5 py-0.5 mb-2"
            style={{ backgroundColor: `${meta.accent}18` }}
          >
            <Ionicons name={meta.icon} size={10} color={meta.accent} />
            <Text
              className="text-[9px] font-semibold ml-1"
              style={{ color: meta.accent }}
            >
              {meta.label}
            </Text>
          </View>

          {/* Title */}
          <Text
            className="text-sm font-bold mb-1"
            style={{ color: colors.textPrimary }}
          >
            {announcement.title}
          </Text>

          {/* Subtitle preview + date */}
          <Text
            className="text-xs leading-5"
            style={{ color: colors.textSecondary }}
            numberOfLines={2}
          >
            {announcement.subtitle}
          </Text>

          {/* Footer row */}
          <View className="flex-row items-center justify-between mt-2.5">
            {announcement.date && (
              <Text
                className="text-[10px]"
                style={{ color: colors.textTertiary }}
              >
                {announcement.date}
              </Text>
            )}
            <View className="flex-row items-center ml-auto">
              <Text
                className="text-[10px] font-semibold mr-1"
                style={{ color: meta.accent }}
              >
                {announcement.actionLabel || "Read More"}
              </Text>
              <Ionicons name="chevron-forward" size={10} color={meta.accent} />
            </View>
          </View>
        </View>
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
        </ScrollView>
      )}
    </View>
  );
}
