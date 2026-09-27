/**
 * AudioTrackSheet — bottom sheet for selecting audio tracks.
 * Works with PlayerAdapter interface (not raw expo-video player).
 *
 * Visual language matches StreamPickerSheet: leading icon column, selected
 * row tinted gold with a checkmark, plain otherwise — nothing else to parse.
 */

import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
  useWindowDimensions,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import type { PlayerAdapter } from "./types";
import { audioTrackTitle } from "../../lib/audioLanguage";
import { trackFeatureUsed } from "../../lib/telemetry";
import { useBottomSheetEntrance } from "./useBottomSheetEntrance";

interface AudioTrackSheetProps {
  visible: boolean;
  player: PlayerAdapter;
  /** Fired when the user manually picks a track (disables HevcPlayer auto-select). */
  onSelectTrack?: () => void;
  onClose: () => void;
}

export function AudioTrackSheet({
  visible,
  player,
  onSelectTrack,
  onClose,
}: AudioTrackSheetProps) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const tracks = player.getAudioTracks();
  const selectedId = player.getSelectedAudioTrackId?.() ?? null;
  const { mounted, backdrop, translateY } = useBottomSheetEntrance(visible);

  return (
    <Modal visible={mounted} transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
          <TouchableOpacity
            style={styles.backdropTouch}
            activeOpacity={1}
            onPress={onClose}
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            isLandscape && styles.sheetLandscape,
            { transform: [{ translateY }] },
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Audio track</Text>
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Close audio tracks"
            >
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <FlatList
            data={tracks}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => {
              const isSelected = item.id === selectedId;
              const title = audioTrackTitle(item, index);
              const showSecondary =
                item.label &&
                item.label !== title &&
                item.label.toLowerCase() !== "audio" &&
                item.label.toLowerCase() !== "audio track";
              return (
                <TouchableOpacity
                  style={[styles.trackItem, isSelected && styles.trackSelected]}
                  onPress={() => {
                    player.setAudioTrack(item.id);
                    // Telemetry hygiene: the sheet only opens when the file
                    // genuinely has 2+ tracks, but guard here too so a stale
                    // single-track render can never fire a false pick event.
                    if (tracks.length > 1) {
                      trackFeatureUsed("audio_track_pick", "player");
                    }
                    onSelectTrack?.();
                    onClose();
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Audio track: ${title}${isSelected ? ", currently selected" : ""}`}
                >
                  <View style={styles.trackIconWrap}>
                    <Ionicons
                      name="musical-notes-outline"
                      size={16}
                      color={isSelected ? colors.gold : colors.textTertiary}
                    />
                  </View>
                  <View style={styles.trackInfo}>
                    <Text
                      style={[
                        styles.trackLanguage,
                        isSelected && styles.trackTextSelected,
                      ]}
                      numberOfLines={1}
                    >
                      {title}
                    </Text>
                    {showSecondary ? (
                      <Text style={styles.trackName} numberOfLines={1}>
                        {item.label}
                      </Text>
                    ) : null}
                  </View>
                  {isSelected && (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={colors.gold}
                    />
                  )}
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />

          {tracks.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons
                name="musical-notes"
                size={48}
                color={colors.emptyIcon}
              />
              <Text style={styles.emptyText}>
                No selectable audio tracks — this source has a single track
              </Text>
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  backdropTouch: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "60%",
    paddingBottom: 32,
  },
  sheetLandscape: {
    width: 440,
    alignSelf: "center",
    maxHeight: "92%",
    marginBottom: 12,
    borderRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.zinc800,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
  },
  trackItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  trackSelected: {
    backgroundColor: colors.goldBadge,
  },
  trackIconWrap: {
    width: 26,
    alignItems: "center",
    marginRight: 10,
  },
  trackInfo: {
    flex: 1,
  },
  trackLanguage: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
  trackTextSelected: {
    color: colors.gold,
  },
  trackName: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  separator: {
    height: 1,
    backgroundColor: colors.zinc800,
    marginHorizontal: 20,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  emptyText: {
    color: colors.zinc500,
    fontSize: 14,
    marginTop: 12,
    textAlign: "center",
    lineHeight: 20,
  },
});
