/**
 * LanguagePromptSheet — one-time first-run prompt shown when the user opens
 * the direct player for the first time. Asks which audio language they
 * prefer so source ranking starts matching their taste from day one.
 *
 * "Auto" is the escape hatch (app decides: Multi > Hindi > English) and is
 * what every subsequent visit uses unless changed in player settings.
 */

import React from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../theme/colors";
import type { PreferredLanguage } from "../../lib/streamSelector";

const OPTIONS: { value: PreferredLanguage; label: string; hint: string }[] = [
  {
    value: "auto",
    label: "Auto",
    hint: "Multi audio, then Hindi, then English",
  },
  {
    value: "multi",
    label: "Multi audio",
    hint: "Titles with several audio tracks",
  },
  { value: "hindi", label: "Hindi", hint: "Sources with Hindi audio" },
  { value: "english", label: "English", hint: "Sources with English audio" },
];

interface LanguagePromptSheetProps {
  onSelect: (value: PreferredLanguage) => void;
  /** Controlled visibility — omit for the legacy always-on first-run modal. */
  visible?: boolean;
  /** Called on backdrop tap / Android back when `visible` is controlled. */
  onClose?: () => void;
  /** Highlights the currently-active language (settings mode). */
  currentValue?: PreferredLanguage;
  title?: string;
  subtitle?: string;
}

export function LanguagePromptSheet({
  onSelect,
  visible = true,
  onClose,
  currentValue,
  title = "Audio language",
  subtitle = "New sources are ranked to match this. You can change it anytime in player settings.",
}: LanguagePromptSheetProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose ?? (() => {})}
    >
      <View style={styles.overlay}>
        <View
          style={styles.card}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          <View style={styles.optionList}>
            {OPTIONS.map((option, index) => {
              const isSelected = currentValue === option.value;
              return (
                <View key={option.value}>
                  {index > 0 && <View style={styles.divider} />}
                  <TouchableOpacity
                    style={styles.option}
                    onPress={() => onSelect(option.value)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Preferred audio language: ${option.label}${isSelected ? ", currently selected" : ""}`}
                  >
                    <View style={styles.optionTextWrap}>
                      <Text style={styles.optionLabel}>{option.label}</Text>
                      <Text style={styles.optionHint}>{option.hint}</Text>
                    </View>
                    {isSelected ? (
                      <Ionicons
                        name="checkmark"
                        size={18}
                        color={colors.gold}
                      />
                    ) : null}
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: 16,
    padding: 20,
    width: "100%",
    maxWidth: 380,
    borderWidth: 0.5,
    borderColor: colors.borderSubtle,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "500",
    lineHeight: 24,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    marginBottom: 12,
  },
  optionList: {
    marginHorizontal: -4,
  },
  divider: {
    height: 0.5,
    backgroundColor: colors.borderSubtle,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    paddingVertical: 12,
    minHeight: 52,
  },
  optionTextWrap: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "500",
  },
  optionHint: {
    color: colors.textTertiary,
    fontSize: 12,
    lineHeight: 16,
  },
});
