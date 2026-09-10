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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import type { PlayerAdapter } from "./types";

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
  const tracks = player.getAudioTracks();
  const selectedId = player.getSelectedAudioTrackId?.() ?? null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={styles.sheet}>
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
            renderItem={({ item }) => {
              const isSelected = item.id === selectedId;
              return (
                <TouchableOpacity
                  style={[styles.trackItem, isSelected && styles.trackSelected]}
                  onPress={() => {
                    player.setAudioTrack(item.id);
                    onSelectTrack?.();
                    onClose();
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Audio track: ${item.language || item.label}${isSelected ? ", currently selected" : ""}`}
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
                      {item.language || item.label || "Audio"}
                    </Text>
                    {item.label && item.language ? (
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
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "60%",
    paddingBottom: 32,
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
