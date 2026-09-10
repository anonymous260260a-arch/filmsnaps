/**
 * PlayerSettingsSheet — YouTube-style bottom sheet for player controls.
 *
 * Allows users to change playback speed (0.25x - 2.0x), switch audio tracks,
 * select subtitles, or change stream quality/source.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import { useSettings } from "../../lib/settings";
import type { PlayerAdapter } from "./types";

interface PlayerSettingsSheetProps {
  visible: boolean;
  player: PlayerAdapter;
  sourceLabel?: string;
  onOpenAudioSheet: () => void;
  onOpenSubtitleSheet: () => void;
  onOpenSourcePicker?: () => void;
  onClose: () => void;
}

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

const LANGUAGE_OPTIONS: {
  value: "auto" | "multi" | "hindi" | "english";
  label: string;
  hint: string;
}[] = [
  {
    value: "auto",
    label: "Auto",
    hint: "Multi audio, then Hindi, then English",
  },
  {
    value: "multi",
    label: "Multi audio",
    hint: "Multiple audio tracks preferred",
  },
  { value: "hindi", label: "Hindi", hint: "Hindi audio when available" },
  { value: "english", label: "English", hint: "English audio when available" },
];

export function PlayerSettingsSheet({
  visible,
  player,
  sourceLabel,
  onOpenAudioSheet,
  onOpenSubtitleSheet,
  onOpenSourcePicker,
  onClose,
}: PlayerSettingsSheetProps) {
  const [currentView, setCurrentView] = useState<"menu" | "speed" | "language">(
    "menu",
  );
  const { settings, updateSetting } = useSettings();
  const currentRate = player.getPlaybackRate();

  const handleSelectSpeed = (speed: number) => {
    player.setPlaybackRate(speed);
    setCurrentView("menu");
    onClose();
  };

  const speedLabel = currentRate === 1.0 ? "Normal" : `${currentRate}x`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        setCurrentView("menu");
        onClose();
      }}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={() => {
          setCurrentView("menu");
          onClose();
        }}
      >
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          {/* Header */}
          <View style={styles.header}>
            {currentView !== "menu" ? (
              <TouchableOpacity
                onPress={() => setCurrentView("menu")}
                style={styles.backButton}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Back to settings menu"
              >
                <Ionicons
                  name="arrow-back"
                  size={20}
                  color={colors.textPrimary}
                />
                <Text style={styles.headerTitle}>
                  {currentView === "speed"
                    ? "Playback Speed"
                    : "Audio Language"}
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.headerTitle}>Playback Settings</Text>
            )}

            <TouchableOpacity
              onPress={() => {
                setCurrentView("menu");
                onClose();
              }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Close settings"
            >
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Body Content */}
          <ScrollView contentContainerStyle={styles.content}>
            {currentView === "menu" ? (
              <>
                {/* ── Playback section ── */}
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionHeaderText}>Playback</Text>
                </View>

                {/* Speed Option */}
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => setCurrentView("speed")}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Playback speed"
                >
                  <View style={styles.menuItemLeft}>
                    <Ionicons
                      name="speedometer-outline"
                      size={20}
                      color={colors.gold}
                    />
                    <Text style={styles.menuItemText}>Playback speed</Text>
                  </View>
                  <View style={styles.menuItemRight}>
                    <Text style={styles.menuItemValue}>{speedLabel}</Text>
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={colors.textTertiary}
                    />
                  </View>
                </TouchableOpacity>

                <View style={styles.separator} />

                {/* Audio Language Option */}
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => setCurrentView("language")}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Preferred audio language"
                >
                  <View style={styles.menuItemLeft}>
                    <Ionicons
                      name="language-outline"
                      size={20}
                      color={colors.gold}
                    />
                    <Text style={styles.menuItemText}>Audio language</Text>
                  </View>
                  <View style={styles.menuItemRight}>
                    <Text style={styles.menuItemValue}>
                      {LANGUAGE_OPTIONS.find(
                        (o) => o.value === settings.preferredAudioLanguage,
                      )?.label ?? "Auto"}
                    </Text>
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={colors.textTertiary}
                    />
                  </View>
                </TouchableOpacity>

                {/* ── Media section ── */}
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionHeaderText}>Media</Text>
                </View>

                {/* Audio Track Option */}
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => {
                    onClose();
                    onOpenAudioSheet();
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Audio tracks"
                >
                  <View style={styles.menuItemLeft}>
                    <Ionicons
                      name="musical-notes-outline"
                      size={20}
                      color={colors.gold}
                    />
                    <Text style={styles.menuItemText}>Audio track</Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textTertiary}
                  />
                </TouchableOpacity>

                <View style={styles.separator} />

                {/* Subtitles Option */}
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => {
                    onClose();
                    onOpenSubtitleSheet();
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Subtitles"
                >
                  <View style={styles.menuItemLeft}>
                    <Ionicons
                      name="text-outline"
                      size={20}
                      color={colors.gold}
                    />
                    <Text style={styles.menuItemText}>Subtitles</Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textTertiary}
                  />
                </TouchableOpacity>

                {/* Source Quality Option */}
                {onOpenSourcePicker && sourceLabel && (
                  <>
                    <View style={styles.separator} />
                    <TouchableOpacity
                      style={styles.menuItem}
                      onPress={() => {
                        onClose();
                        onOpenSourcePicker();
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={styles.menuItemLeft}>
                        <Ionicons
                          name="server-outline"
                          size={20}
                          color={colors.gold}
                        />
                        <Text style={styles.menuItemText}>
                          Quality / Server
                        </Text>
                      </View>
                      <View style={styles.menuItemRight}>
                        <Text style={styles.menuItemValue}>{sourceLabel}</Text>
                        <Ionicons
                          name="chevron-forward"
                          size={18}
                          color={colors.textTertiary}
                        />
                      </View>
                    </TouchableOpacity>
                  </>
                )}
              </>
            ) : currentView === "speed" ? (
              /* Speed Selection List */
              SPEED_OPTIONS.map((speed) => {
                const isSelected = currentRate === speed;
                return (
                  <TouchableOpacity
                    key={speed}
                    style={[
                      styles.speedOption,
                      isSelected && styles.optionSelected,
                    ]}
                    onPress={() => handleSelectSpeed(speed)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Playback speed ${speed === 1.0 ? "normal" : `${speed}x`}`}
                  >
                    <Text
                      style={[
                        styles.speedOptionText,
                        isSelected && styles.speedOptionSelected,
                      ]}
                    >
                      {speed === 1.0 ? "Normal" : `${speed}x`}
                    </Text>
                    {isSelected && (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={colors.gold}
                      />
                    )}
                  </TouchableOpacity>
                );
              })
            ) : (
              /* Audio Language Selection List */
              LANGUAGE_OPTIONS.map((option) => {
                const isSelected =
                  settings.preferredAudioLanguage === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.speedOption,
                      isSelected && styles.optionSelected,
                    ]}
                    onPress={() => {
                      updateSetting("preferredAudioLanguage", option.value);
                      setCurrentView("menu");
                      onClose();
                    }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Preferred audio language: ${option.label}`}
                  >
                    <View style={styles.languageOptionTextWrap}>
                      <Text
                        style={[
                          styles.speedOptionText,
                          isSelected && styles.speedOptionSelected,
                        ]}
                      >
                        {option.label}
                      </Text>
                      <Text style={styles.languageOptionHint}>
                        {option.hint}
                      </Text>
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
              })
            )}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "70%",
    paddingBottom: 24,
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
    backgroundColor: colors.bgSubtle,
  },
  sectionHeaderText: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
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
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: "700",
  },
  content: {
    paddingVertical: 8,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  menuItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  menuItemRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  menuItemText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
  menuItemValue: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "500",
  },
  separator: {
    height: 1,
    backgroundColor: colors.zinc800,
    marginHorizontal: 20,
  },
  speedOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  optionSelected: {
    backgroundColor: colors.goldBadge,
  },
  speedOptionText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: "500",
  },
  speedOptionSelected: {
    color: colors.gold,
    fontWeight: "700",
  },
  languageOptionTextWrap: {
    flex: 1,
    gap: 2,
  },
  languageOptionHint: {
    color: colors.textTertiary,
    fontSize: 12,
  },
});
