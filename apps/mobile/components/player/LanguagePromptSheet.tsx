/**
 * LanguagePromptSheet — one-time first-run prompt shown when the user opens
 * the direct player for the first time. Asks which audio language they
 * prefer so source ranking starts matching their taste from day one.
 *
 * "Auto" is the escape hatch (app decides: Multi > Hindi > English) and is
 * what every subsequent visit uses unless changed in player settings.
 */

import React from "react";
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
import type { PreferredLanguage } from "../../lib/streamSelector";

const OPTIONS: { value: PreferredLanguage; label: string; hint: string }[] = [
  {
    value: "auto",
    label: "Auto",
    hint: "App decides — Multi audio, then Hindi, then English",
  },
  {
    value: "multi",
    label: "Multi audio",
    hint: "Titles with multiple audio tracks preferred",
  },
  { value: "hindi", label: "Hindi", hint: "Prefer sources with Hindi audio" },
  {
    value: "english",
    label: "English",
    hint: "Prefer sources with English audio",
  },
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
  title = "What audio language do you prefer?",
  subtitle = "We'll rank sources to match. You can change this anytime in the player settings.",
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
          <View style={styles.iconWrap}>
            <Ionicons name="language-outline" size={30} color={colors.gold} />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          <ScrollView
            style={styles.optionList}
            contentContainerStyle={styles.optionListContent}
          >
            {OPTIONS.map((option) => {
              const isSelected = currentValue === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.option, isSelected && styles.optionSelected]}
                  onPress={() => onSelect(option.value)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Preferred audio language: ${option.label}${isSelected ? ", currently selected" : ""}`}
                >
                  <View style={styles.optionTextWrap}>
                    <Text
                      style={[
                        styles.optionLabel,
                        isSelected && styles.optionLabelSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                    <Text style={styles.optionHint}>{option.hint}</Text>
                  </View>
                  {isSelected ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={colors.gold}
                    />
                  ) : (
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={colors.textTertiary}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
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
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 380,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(212,162,55,0.12)",
    borderWidth: 1,
    borderColor: "rgba(212,162,55,0.3)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    alignSelf: "flex-start",
  },
  title: {
    color: colors.textPrimary,
    fontSize: 19,
    fontWeight: "700",
    lineHeight: 26,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    marginBottom: 16,
  },
  optionList: {
    flexGrow: 0,
  },
  optionListContent: {
    gap: 4,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 56,
  },
  optionSelected: {
    backgroundColor: colors.goldBadge,
    borderColor: "rgba(212,162,55,0.5)",
  },
  optionLabelSelected: {
    color: colors.gold,
  },
  optionTextWrap: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
  optionHint: {
    color: colors.textTertiary,
    fontSize: 12,
    lineHeight: 16,
  },
});
