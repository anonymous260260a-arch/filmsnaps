/**
 * SubtitlePicker — Bottom sheet for selecting subtitle tracks.
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
import type { VideoPlayer, SubtitleTrack } from "expo-video";

interface SubtitlePickerProps {
  visible: boolean;
  player: VideoPlayer;
  onClose: () => void;
}

export function SubtitlePicker({
  visible,
  player,
  onClose,
}: SubtitlePickerProps) {
  const tracks = player.availableSubtitleTracks;
  const selectedTrack = player.subtitleTrack;

  const handleSelect = (track: SubtitleTrack | null) => {
    player.subtitleTrack = track;
    onClose();
  };

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
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Subtitles</Text>
            <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Disable option */}
          <TouchableOpacity
            style={[
              styles.trackItem,
              selectedTrack === null && styles.trackItemSelected,
            ]}
            onPress={() => handleSelect(null)}
            activeOpacity={0.7}
          >
            <View style={styles.trackInfo}>
              <Text style={styles.trackLanguage}>Off</Text>
              <Text style={styles.trackName}>Disable subtitles</Text>
            </View>
            {selectedTrack === null && (
              <Ionicons name="checkmark" size={20} color={colors.gold} />
            )}
          </TouchableOpacity>

          <View style={styles.separator} />

          {/* Track List */}
          <FlatList
            data={tracks}
            keyExtractor={(item) => item.id || item.language}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.trackItem,
                  selectedTrack?.language === item.language &&
                    styles.trackItemSelected,
                ]}
                onPress={() => handleSelect(item)}
                activeOpacity={0.7}
              >
                <View style={styles.trackInfo}>
                  <Text style={styles.trackLanguage}>
                    {item.language || "Unknown"}
                  </Text>
                  <Text style={styles.trackName}>
                    {item.label || item.language || "Subtitle Track"}
                  </Text>
                </View>
                {selectedTrack?.language === item.language && (
                  <Ionicons name="checkmark" size={20} color={colors.gold} />
                )}
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />

          {/* No tracks message */}
          {tracks.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="text" size={48} color={colors.emptyIcon} />
              <Text style={styles.emptyText}>No subtitles available</Text>
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
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  trackItemSelected: {
    backgroundColor: colors.goldBadge,
  },
  trackInfo: {
    flex: 1,
  },
  trackLanguage: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "600",
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
  },
  emptyText: {
    color: colors.zinc500,
    fontSize: 14,
    marginTop: 12,
  },
});
