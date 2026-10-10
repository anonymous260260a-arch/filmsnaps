/**
 * SpeedLimitSheet — minimal bottom sheet for the download speed limit.
 *
 * Value contract: KB/s, 0 = unlimited. Presets cover common caps, the
 * custom row accepts any KB/s value (with steppers) and commits on Apply.
 */

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { colors } from "../theme/colors";

const MIN_KBPS = 1;
const MAX_KBPS = 512000; // 500 MB/s

const PRESETS: { value: number; label: string }[] = [
  { value: 0, label: "Off" },
  { value: 128, label: "128 KB/s" },
  { value: 256, label: "256 KB/s" },
  { value: 512, label: "512 KB/s" },
  { value: 1024, label: "1 MB/s" },
  { value: 2048, label: "2 MB/s" },
  { value: 5120, label: "5 MB/s" },
  { value: 10240, label: "10 MB/s" },
];

/** Human-readable speed for a KB/s value (0 = unlimited). */
export function formatSpeed(kbps: number): string {
  if (!kbps || kbps <= 0) return "Unlimited";
  if (kbps < 1024) return `${Math.round(kbps)} KB/s`;
  const mbps = kbps / 1024;
  const rounded = mbps >= 10 ? Math.round(mbps) : Math.round(mbps * 10) / 10;
  return `${rounded} MB/s`;
}

function parseKbps(
  text: string,
): { ok: true; value: number } | { ok: false; message: string } {
  const cleaned = text.trim().replace(",", ".");
  if (!cleaned) return { ok: false, message: "Enter a value" };
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { ok: false, message: "Numbers only" };
  if (n === 0) return { ok: true, value: 0 };
  if (n < 0) return { ok: false, message: "Enter a positive value" };
  if (n < MIN_KBPS) return { ok: false, message: "Minimum is 1 KB/s" };
  if (n > MAX_KBPS)
    return { ok: false, message: `Maximum is ${formatSpeed(MAX_KBPS)}` };
  return { ok: true, value: Math.round(n) };
}

/** Step: 100 KB/s below 1 MB/s, then 0.5 MB/s, then 1 MB/s. */
function stepFor(base: number): number {
  if (base < 1024) return 100;
  if (base < 10240) return 512;
  return 1024;
}

interface SpeedLimitSheetProps {
  visible: boolean;
  /** Current limit in KB/s (0 = unlimited). */
  value: number;
  onChange: (kbps: number) => void;
  onClose: () => void;
}

export function SpeedLimitSheet({
  visible,
  value,
  onChange,
  onClose,
}: SpeedLimitSheetProps) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Seed the field from the active value whenever the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setText(value > 0 ? String(Math.round(value)) : "");
    setError(null);
  }, [visible, value]);

  const commit = (kbps: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onChange(kbps);
    onClose();
  };

  const bump = (dir: 1 | -1) => {
    const parsed = parseKbps(text);
    const base = parsed.ok && parsed.value > 0 ? parsed.value : MIN_KBPS;
    const next = Math.min(
      MAX_KBPS,
      Math.max(MIN_KBPS, base + dir * stepFor(base)),
    );
    setText(String(next));
    setError(null);
    Haptics.selectionAsync().catch(() => {});
  };

  const apply = () => {
    const parsed = parseKbps(text);
    if (!parsed.ok) {
      setError(parsed.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
        () => {},
      );
      return;
    }
    commit(parsed.value);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
          accessibilityLabel="Close"
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View
            style={[styles.sheet, { paddingBottom: insets.bottom + 18 }]}
            accessibilityRole="alert"
          >
            <View style={styles.handle} />

            {/* Header */}
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Download speed limit</Text>
                <Text style={styles.subtitle}>
                  Applies to running downloads instantly.
                </Text>
              </View>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.closeBtn}
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={17} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Active value */}
              <View style={styles.hero}>
                <Text style={styles.heroValue}>{formatSpeed(value)}</Text>
                <Text style={styles.heroCaption}>
                  {value > 0
                    ? "All downloads are capped"
                    : "No cap — downloads run at full speed"}
                </Text>
              </View>

              {/* Presets */}
              {[0, 1].map((row) => (
                <View key={row} style={styles.gridRow}>
                  {PRESETS.slice(row * 4, row * 4 + 4).map((p) => {
                    const active = value === p.value;
                    return (
                      <TouchableOpacity
                        key={p.value}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => commit(p.value)}
                        activeOpacity={0.75}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`Speed limit ${p.label}`}
                      >
                        <Text
                          style={[
                            styles.chipLabel,
                            active && styles.chipLabelActive,
                          ]}
                        >
                          {p.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}

              {/* Custom */}
              <View style={styles.divider} />
              <Text style={styles.sectionLabel}>CUSTOM KB/S</Text>
              <View style={[styles.inputRow, error && styles.inputRowError]}>
                <TouchableOpacity
                  style={styles.stepper}
                  onPress={() => bump(-1)}
                  accessibilityLabel="Decrease"
                >
                  <Ionicons
                    name="remove"
                    size={18}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
                <TextInput
                  style={styles.input}
                  value={text}
                  onChangeText={(t) => {
                    setText(t);
                    setError(null);
                  }}
                  placeholder="e.g. 768"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  selectTextOnFocus
                  onSubmitEditing={apply}
                  accessibilityLabel="Custom speed limit in kilobytes per second"
                />
                <Text style={styles.inputUnit}>KB/s</Text>
                <TouchableOpacity
                  style={styles.stepper}
                  onPress={() => bump(1)}
                  accessibilityLabel="Increase"
                >
                  <Ionicons name="add" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {error ? (
                <Text style={styles.errorText}>{error}</Text>
              ) : (
                <Text style={styles.hintText}>
                  1 – {MAX_KBPS.toLocaleString()} KB/s · 0 = unlimited
                </Text>
              )}

              <TouchableOpacity
                style={styles.applyBtn}
                onPress={apply}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Apply custom speed limit"
              >
                <Text style={styles.applyText}>Apply</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 18,
    paddingTop: 10,
    maxHeight: "90%",
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.zinc800,
    marginBottom: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  subtitle: {
    color: colors.textTertiary,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 3,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    marginLeft: 8,
  },
  hero: {
    alignItems: "center",
    paddingVertical: 18,
  },
  heroValue: {
    color: colors.gold,
    fontSize: 28,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: -0.4,
  },
  heroCaption: {
    color: colors.textTertiary,
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 5,
  },
  gridRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  chip: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: colors.goldBadge,
    borderColor: "rgba(212,162,55,0.55)",
  },
  chipLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  chipLabelActive: {
    color: colors.gold,
  },
  divider: {
    height: 0.5,
    backgroundColor: colors.borderSubtle,
    marginTop: 10,
    marginBottom: 14,
  },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bgCard,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingVertical: 5,
    paddingHorizontal: 5,
    gap: 6,
  },
  inputRowError: {
    borderColor: "rgba(239,68,68,0.6)",
  },
  stepper: {
    width: 38,
    height: 40,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    paddingVertical: 8,
    paddingHorizontal: 4,
    minWidth: 60,
  },
  inputUnit: {
    color: colors.textTertiary,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  hintText: {
    color: colors.textTertiary,
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 7,
    marginBottom: 12,
  },
  errorText: {
    color: colors.error,
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    marginTop: 7,
    marginBottom: 12,
  },
  applyBtn: {
    backgroundColor: colors.gold,
    borderRadius: 13,
    paddingVertical: 13,
    alignItems: "center",
    marginBottom: 4,
  },
  applyText: {
    color: colors.bg,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
