/**
 * PlayerSettingsSheet — the ⋮ menu of the direct-player chrome.
 *
 * One screen, four rows, no sub-navigation:
 *  - Playback speed (inline selected-state, no drill-down)
 *  - Preferred audio language
 *  - Screen fit (contain / fill / stretch) — inline, no drill-down
 *  - Lock controls (landscape/fullscreen only — mirrors the top-bar lock
 *    button as its a11y-reachable alternative)
 *
 * Audio tracks, subtitles and source quality moved to dedicated top-bar
 * buttons (one tap, no menu) — this sheet holds only global preferences.
 */

import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import { useSettings } from "../../lib/settings";
import type { PlayerAdapter } from "./types";
import { trackFeatureUsed } from "../../lib/telemetry";

interface PlayerSettingsSheetProps {
  visible: boolean;
  player: PlayerAdapter;
  /** Fullscreen/landscape — enables the lock row (a11y alternative to the button). */
  isFullscreen: boolean;
  currentSpeed: number;
  onSelectSpeed: (speed: number) => void;
  screenFit: "contain" | "cover" | "fill";
  onSelectFit: (fit: "contain" | "cover" | "fill") => void;
  lockAvailable: boolean;
  isLocked: boolean;
  onLock: () => void;
  onClose: () => void;
}

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

const FIT_OPTIONS: {
  value: "contain" | "cover" | "fill";
  label: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    value: "contain",
    label: "Fit",
    hint: "Whole picture",
    icon: "resize-outline",
  },
  {
    value: "cover",
    label: "Fill",
    hint: "Crops edges",
    icon: "scan-outline",
  },
  {
    value: "fill",
    label: "Stretch",
    hint: "May distort",
    icon: "expand-outline",
  },
];

const LANGUAGE_OPTIONS: {
  value: "auto" | "multi" | "hindi" | "english";
  label: string;
}[] = [
  { value: "auto", label: "Auto" },
  { value: "multi", label: "Multi audio" },
  { value: "hindi", label: "Hindi" },
  { value: "english", label: "English" },
];

export function PlayerSettingsSheet({
  visible,
  player,
  isFullscreen,
  currentSpeed,
  onSelectSpeed,
  screenFit,
  onSelectFit,
  lockAvailable,
  isLocked,
  onLock,
  onClose,
}: PlayerSettingsSheetProps) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const { settings, updateSetting } = useSettings();

  const handleSelectSpeed = (speed: number) => {
    onSelectSpeed(speed);
    onClose();
  };

  const handleSelectLanguage = (
    value: "auto" | "multi" | "hindi" | "english",
  ) => {
    updateSetting("preferredAudioLanguage", value);
    // Telemetry hygiene: only a real CHANGE is a feature event. Tapping the
    // already-selected chip is a no-op — counting it inflated "prefAudioLang"
    // style data (user "changed" language N times without changing anything).
    if (value !== settings.preferredAudioLanguage) {
      trackFeatureUsed("audio_manual_override", "player");
    }
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
        <View
          style={[styles.sheet, isLandscape && styles.sheetLandscape]}
          onStartShouldSetResponder={() => true}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerGrip} />
            <Text style={styles.headerTitle}>Playback settings</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel="Close settings"
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {/* ── Screen fit ── */}
            <View style={styles.rowHeader}>
              <Ionicons name="albums-outline" size={16} color={colors.gold} />
              <Text style={styles.rowHeaderText}>Screen fit</Text>
            </View>
            <View style={styles.fitRow}>
              {FIT_OPTIONS.map((option) => {
                const isSelected = screenFit === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.fitCard, isSelected && styles.fitCardActive]}
                    onPress={() => {
                      if (!isSelected) {
                        trackFeatureUsed(
                          `screen_fit_${option.value}` as any,
                          "player",
                        );
                      }
                      onSelectFit(option.value);
                    }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Screen fit ${option.label}`}
                    accessibilityHint={option.hint}
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Ionicons
                      name={option.icon}
                      size={20}
                      color={isSelected ? colors.gold : colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.fitLabel,
                        isSelected && styles.fitLabelActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.divider} />

            {/* ── Playback speed ── */}
            <View style={styles.rowHeader}>
              <Ionicons
                name="speedometer-outline"
                size={16}
                color={colors.gold}
              />
              <Text style={styles.rowHeaderText}>Speed</Text>
            </View>
            <View style={styles.chipRow}>
              {SPEED_OPTIONS.map((speed) => {
                const isSelected = Math.abs(currentSpeed - speed) < 0.01;
                return (
                  <TouchableOpacity
                    key={speed}
                    style={[styles.chip, isSelected && styles.chipActive]}
                    onPress={() => handleSelectSpeed(speed)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Playback speed ${speed === 1.0 ? "normal" : `${speed}x`}`}
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        isSelected && styles.chipTextActive,
                      ]}
                    >
                      {speed === 1.0 ? "1×" : `${speed}×`}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.divider} />

            {/* ── Preferred audio language ── */}
            <View style={styles.rowHeader}>
              <Ionicons name="language-outline" size={16} color={colors.gold} />
              <Text style={styles.rowHeaderText}>Preferred audio</Text>
            </View>
            <View style={styles.chipRow}>
              {LANGUAGE_OPTIONS.map((option) => {
                const isSelected =
                  settings.preferredAudioLanguage === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.chip, isSelected && styles.chipActive]}
                    onPress={() => handleSelectLanguage(option.value)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Preferred audio language ${option.label}`}
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        isSelected && styles.chipTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* ── Lock (landscape/fullscreen only) ── */}
            {lockAvailable && (
              <>
                <View style={styles.divider} />
                <TouchableOpacity
                  style={styles.lockRow}
                  onPress={() => {
                    onLock();
                    onClose();
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Lock controls"
                  accessibilityHint="Prevents accidental touches while the phone is in a pocket or pouch"
                  disabled={isLocked}
                >
                  <View style={styles.lockRowLeft}>
                    <Ionicons
                      name="lock-closed-outline"
                      size={18}
                      color={colors.gold}
                    />
                    <Text style={styles.lockRowText}>Lock screen</Text>
                  </View>
                  {isLocked ? (
                    <Text style={styles.lockRowValue}>Locked</Text>
                  ) : (
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={colors.textTertiary}
                    />
                  )}
                </TouchableOpacity>
              </>
            )}

            <View style={styles.footerSpace} />
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "65%",
    paddingBottom: 24,
  },
  sheetLandscape: {
    width: 460,
    alignSelf: "center",
    maxHeight: "92%",
    marginBottom: 12,
    borderRadius: 20,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  header: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 4,
    position: "relative",
  },
  headerGrip: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.zinc600,
    marginBottom: 8,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  closeButton: {
    position: "absolute",
    right: 8,
    top: 8,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  rowHeaderText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  fitRow: {
    flexDirection: "row",
    gap: 10,
  },
  fitCard: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: "transparent",
  },
  fitCardActive: {
    backgroundColor: colors.goldBadge,
    borderColor: "rgba(212,162,55,0.45)",
  },
  fitLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  fitLabelActive: {
    color: colors.gold,
  },
  divider: {
    height: 1,
    backgroundColor: colors.zinc800,
    marginVertical: 16,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: colors.bgSurface,
    minHeight: 36,
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: colors.goldBadge,
    borderWidth: 1,
    borderColor: "rgba(212,162,55,0.45)",
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  chipTextActive: {
    color: colors.gold,
    fontWeight: "700",
  },
  lockRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  lockRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  lockRowText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
  lockRowValue: {
    color: colors.textTertiary,
    fontSize: 13,
    fontWeight: "600",
  },
  footerSpace: {
    height: 8,
  },
});
