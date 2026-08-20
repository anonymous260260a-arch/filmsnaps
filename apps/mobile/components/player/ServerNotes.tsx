/**
 * ServerNotes — Per-provider usage notes displayed below the player.
 *
 * Shows a small card with tips about the currently selected streaming source.
 * Can be permanently dismissed from the note itself or hidden via Settings.
 * Automatically hidden in fullscreen mode.
 */

import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../theme/colors";

// ── Per-provider notes ──

interface ServerNote {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  lines: string[];
}

const SERVER_NOTES: Record<string, ServerNote> = {
  nxsha: {
    title: "Using Source 1",
    icon: "film-outline",
    lines: [
      "Best for multi-language content with Hindi/Tamil/Telugu audio.",
      "Supports subtitle selection via the player's built-in controls.",
      "If the player doesn't load, try switching to another source.",
    ],
  },
  peachify: {
    title: "Using Source 2",
    icon: "musical-notes-outline",
    lines: [
      "Offers multiple audio tracks for supported titles.",
      "Tap the audio icon in the player to switch audio tracks.",
      "Works well as a reliable fallback source.",
    ],
  },
  screenscape: {
    title: "Using Source 3",
    icon: "speedometer-outline",
    lines: [
      "Fast streaming with multi-language support.",
      "Best performance on stable Wi-Fi connections.",
      "Supports subtitle and audio track switching.",
    ],
  },
  nhdapi: {
    title: "Using Source 4",
    icon: "globe-outline",
    lines: [
      "Fast source with Hindi language preference by default.",
      "Auto-plays next episode for TV shows.",
      "Subtitle and audio controls are available in the player overlay.",
    ],
  },
  zxcstream: {
    title: "Using Source 5",
    icon: "play-circle-outline",
    lines: [
      "Hindi-dubbed content source.",
      "Supports auto-play for seamless watching.",
      "Best for Indian regional content.",
    ],
  },
  cinemaos: {
    title: "Using Source 6",
    icon: "tv-outline",
    lines: [
      "Simple, lightweight player interface.",
      "Good performance across different network conditions.",
      "May require tapping the screen to show player controls.",
    ],
  },
  chillflix: {
    title: "Using Source 18",
    icon: "snow-outline",
    lines: [
      "Slower to load — please be patient after selecting.",
      "Once loaded, playback is smooth and reliable.",
      "Try a different source if loading takes too long.",
    ],
  },
  vidnest: {
    title: "Using Source 14",
    icon: "layers-outline",
    lines: [
      "Reliable source with good streaming quality.",
      "Supports resume playback from where you left off.",
      "Tap the player to reveal controls and source info.",
    ],
  },
  vidking: {
    title: "Using Source 19",
    icon: "flame-outline",
    lines: [
      "Supports standard playback controls.",
      "Works best with modern Android devices.",
      "Switch audio or subtitles via the player controls.",
    ],
  },
  toustream: {
    title: "Using Source 20",
    icon: "pulse-outline",
    lines: [
      "Lightweight streaming source.",
      "Good for quick playback testing.",
      "May not have all titles available.",
    ],
  },
  streamguide: {
    title: "Using StreamGuide",
    icon: "compass-outline",
    lines: [
      "Alternative streaming source with broad title coverage.",
      "Supports both movies and TV shows.",
      "Use the server picker to switch if unavailable.",
    ],
  },
};

// ── Fallback note for unlisted providers ──

const FALLBACK_NOTE: ServerNote = {
  title: "Streaming Tips",
  icon: "information-circle-outline",
  lines: [
    "Tap the screen to show player controls.",
    "Switch to fullscreen for the best experience.",
    "If playback is slow, try a different source from the server picker.",
  ],
};

// ── Component ──

interface ServerNotesProps {
  providerId: string;
  show: boolean;
  onDismiss: () => void;
}

export function ServerNotes({ providerId, show, onDismiss }: ServerNotesProps) {
  const [dismissed, setDismissed] = useState(false);

  if (!show || dismissed) return null;

  const note = SERVER_NOTES[providerId] ?? FALLBACK_NOTE;

  return (
    <View className="px-4 pt-3 pb-2">
      <View
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: colors.bgSurface,
          borderWidth: 0.5,
          borderColor: colors.bgTop,
        }}
      >
        {/* Header row */}
        <View className="flex-row items-center justify-between px-4 pt-3 pb-1">
          <View className="flex-row items-center flex-1">
            <View
              className="w-7 h-7 rounded-lg items-center justify-center mr-2.5"
              style={{ backgroundColor: `${colors.gold}18` }}
            >
              <Ionicons name={note.icon} size={14} color={colors.gold} />
            </View>
            <Text
              className="text-xs font-semibold"
              style={{
                color: colors.textPrimary,
                fontFamily: "Inter_600SemiBold",
              }}
            >
              {note.title}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              setDismissed(true);
              onDismiss();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.6}
          >
            <Ionicons
              name="close-circle-outline"
              size={18}
              color={colors.textTertiary}
            />
          </TouchableOpacity>
        </View>

        {/* Note lines */}
        <View className="px-4 pb-3 pt-0.5">
          {note.lines.map((line, i) => (
            <View key={i} className="flex-row items-start mt-1.5">
              <Text
                className="text-[6px] mt-1.5 mr-2"
                style={{ color: colors.gold }}
              >
                ●
              </Text>
              <Text
                className="text-xs leading-5 flex-1"
                style={{ color: colors.textSecondary }}
              >
                {line}
              </Text>
            </View>
          ))}
        </View>

        {/* "Don't show again" footer */}
        <TouchableOpacity
          onPress={() => {
            setDismissed(true);
            onDismiss();
          }}
          activeOpacity={0.6}
          className="flex-row items-center justify-center py-2.5"
          style={{
            backgroundColor: colors.bgActiveDrag,
            borderTopWidth: 0.5,
            borderTopColor: colors.bgTop,
          }}
        >
          <Ionicons
            name="eye-off-outline"
            size={13}
            color={colors.textTertiary}
            style={{ marginRight: 6 }}
          />
          <Text className="text-[11px]" style={{ color: colors.textTertiary }}>
            Don't show again
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
