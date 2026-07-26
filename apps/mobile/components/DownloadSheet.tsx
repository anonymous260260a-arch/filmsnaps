/**
 * DownloadSheet — bottom sheet modal for selecting a download source.
 *
 * Follows the same Modal + animationType="slide" pattern as ServerPickerSheet.
 * Shows 3 source options with descriptive labels and quality hints.
 * Supports direct enqueue for pre-resolved URLs.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useDownloadInfra } from "../lib/download/context";
import { prefetchArtwork } from "../lib/prefetchArtwork";
import type { DownloadServer } from "../lib/download/types";

interface SourceOption {
  id: DownloadServer;
  label: string;
  subtitle: string;
  description: string;
  recommended?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
}

interface DownloadSheetProps {
  visible: boolean;
  onClose: () => void;
  mediaType: "movie" | "tv";
  tmdbId: string;
  /** TV-specific: season/episode for per-episode download */
  season?: number;
  episode?: number;
  title?: string;
  /** If provided, enqueue directly instead of navigating */
  sourceUrls?: Partial<Record<DownloadServer, string>>;
  /** Custom filename for direct enqueue */
  fileName?: string;
  /** Poster/backdrop paths for offline prefetch */
  posterPath?: string | null;
  backdropPath?: string | null;
}

const SOURCES: SourceOption[] = [
  {
    id: "nxsha",
    label: "Best Quality",
    subtitle: "1080p · Multi language",
    description: "Larger file size, best viewing experience",
    recommended: true,
    icon: "download-outline",
  },
  {
    id: "falix",
    label: "Small File",
    subtitle: "Compressed · ~50% smaller",
    description: "Smaller file size, great for mobile storage",
    icon: "cloud-download-outline",
  },
  {
    id: "alt-dl",
    label: "Standard",
    subtitle: "720p · Compatible",
    description: "Balanced quality and file size",
    icon: "cloud-download-outline",
  },
];

export function DownloadSheet({
  visible,
  onClose,
  mediaType,
  tmdbId,
  season,
  episode,
  title,
  sourceUrls,
  fileName,
  posterPath,
  backdropPath,
}: DownloadSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: SCREEN_HEIGHT } = useWindowDimensions();
  const router = useRouter();
  const { enqueue } = useDownloadInfra();
  const [selectedSource, setSelectedSource] = useState<DownloadServer>("nxsha");

  const handleStartDownload = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();

    // Prefetch poster/backdrop for offline viewing in Library/Downloads
    prefetchArtwork({
      poster_path: posterPath,
      backdrop_path: backdropPath,
    });

    // If sourceUrls are provided, enqueue directly (no WebView capture needed)
    if (sourceUrls?.[selectedSource]) {
      const url = sourceUrls[selectedSource]!;
      const ext = url.split(".").pop()?.split("?")[0] || "mp4";
      const id = enqueue({
        url,
        fileName: fileName || `${tmdbId}_${selectedSource}`,
        server: selectedSource,
        mediaType,
        tmdbId,
        quality:
          selectedSource === "nxsha"
            ? "1080p"
            : selectedSource === "alt-dl"
              ? "720p"
              : undefined,
        season,
        episode,
        extension: ext,
        title: title
          ? `${title}${season != null && episode != null ? ` S${season}:E${episode}` : ""}`
          : undefined,
      });
      return;
    }

    // Otherwise, navigate to the WebView capture screen
    let route: string;
    if (selectedSource === "nxsha") {
      route = `/download/nxsha/${mediaType}/${tmdbId}`;
    } else if (selectedSource === "falix") {
      route = `/download/falix/${mediaType}/${tmdbId}`;
    } else {
      route = `/download2/${mediaType}/${tmdbId}`;
    }

    // Add season/episode for TV
    if (mediaType === "tv" && season != null && episode != null) {
      route += `/${season}/${episode}`;
    }

    router.push(route as any);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/60">
        <TouchableOpacity
          className="flex-1"
          activeOpacity={1}
          onPress={onClose}
        />

        <View
          className="bg-zinc-900 rounded-t-3xl"
          style={{
            maxHeight: SCREEN_HEIGHT * 0.6,
            paddingBottom: insets.bottom + 16,
          }}
        >
          {/* Drag handle */}
          <View className="items-center pt-3 pb-2">
            <View className="w-10 h-1 rounded-full bg-zinc-600" />
          </View>

          {/* Header */}
          <View className="flex-row items-center justify-between px-6 py-3 border-b border-zinc-800">
            <Text
              className="text-white text-base font-bold"
              style={{ fontFamily: "Inter_600SemiBold", fontSize: 16 }}
              numberOfLines={1}
            >
              Download{title ? ` · ${title}` : ""}
            </Text>
            <View className="flex-row items-center" style={{ gap: 12 }}>
              <TouchableOpacity
                onPress={() => router.push("/guide?section=downloading")}
                activeOpacity={0.7}
                accessibilityLabel="Help with downloads"
                accessibilityRole="button"
              >
                <Ionicons
                  name="help-circle-outline"
                  size={20}
                  color="#71717a"
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onClose}
                activeOpacity={0.7}
                accessibilityLabel="Close download options"
              >
                <Ionicons name="close" size={22} color="#71717a" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Source options */}
          <ScrollView
            className="px-4 pt-3"
            showsVerticalScrollIndicator={false}
          >
            {SOURCES.map((source) => {
              const isSelected = source.id === selectedSource;
              return (
                <TouchableOpacity
                  key={source.id}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedSource(source.id);
                  }}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderRadius: 12,
                    marginBottom: 6,
                    backgroundColor: isSelected
                      ? "rgba(212,162,55,0.1)"
                      : "rgba(39,39,42,0.4)",
                    borderWidth: isSelected ? 0.5 : 0,
                    borderColor: isSelected
                      ? "rgba(212,162,55,0.35)"
                      : "transparent",
                  }}
                >
                  {/* Icon */}
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: isSelected ? "#D4A237" : "#27272A",
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 14,
                    }}
                  >
                    <Ionicons
                      name={isSelected ? "checkmark" : (source.icon as any)}
                      size={18}
                      color={isSelected ? "#070708" : "#71717a"}
                    />
                  </View>

                  {/* Text */}
                  <View className="flex-1">
                    <View className="flex-row items-center">
                      <Text
                        style={{
                          fontSize: 14,
                          fontFamily: "Inter_600SemiBold",
                          color: isSelected ? "#D4A237" : "#e4e4e7",
                        }}
                      >
                        {source.label}
                      </Text>
                      {source.recommended && (
                        <View
                          style={{
                            marginLeft: 8,
                            backgroundColor: "rgba(212,162,55,0.2)",
                            borderRadius: 4,
                            paddingHorizontal: 5,
                            paddingVertical: 1,
                          }}
                        >
                          <Text
                            style={{
                              color: "#D4A237",
                              fontSize: 9,
                              fontFamily: "Inter_600SemiBold",
                            }}
                          >
                            Recommended
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text
                      style={{
                        color: "#A1A1AA",
                        fontSize: 11,
                        fontFamily: "Inter_400Regular",
                        marginTop: 2,
                      }}
                    >
                      {source.subtitle}
                    </Text>
                    <Text
                      style={{
                        color: "#52525B",
                        fontSize: 10,
                        fontFamily: "Inter_400Regular",
                        marginTop: 1,
                      }}
                    >
                      {source.description}
                    </Text>
                  </View>

                  {/* Radio indicator */}
                  {isSelected && (
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: "#D4A237",
                      }}
                    />
                  )}
                </TouchableOpacity>
              );
            })}

            {/* Start Download button */}
            <TouchableOpacity
              onPress={handleStartDownload}
              activeOpacity={0.9}
              style={{
                backgroundColor: "#D4A237",
                borderRadius: 10,
                paddingVertical: 14,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                marginTop: 12,
                marginBottom: 8,
              }}
            >
              <Ionicons
                name="download"
                size={16}
                color="#070708"
                style={{ marginRight: 8 }}
              />
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                  color: "#070708",
                }}
              >
                Start Download
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
