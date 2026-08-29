/**
 * ServerPicker — Ultra-clean bottom sheet modal for selecting streaming sources on mobile.
 * Features minimalist list items with clean radio checks, subtle tags, and smooth gesture dismiss.
 */

import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Dimensions,
  Animated,
  PanResponder,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSafeNavigation } from "@/lib/navigation";
import * as Haptics from "expo-haptics";
import { colors } from "../../theme/colors";
import type { ProviderDefinition } from "@filmsnaps/shared";

interface ServerPickerSheetProps {
  visible: boolean;
  providers: ProviderDefinition[];
  currentId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  getDisplayName: (p: ProviderDefinition) => string;
}

const SWIPE_DISMISS_THRESHOLD = 0.3;
const RUBBER_BAND_RESISTANCE = 0.3;

export function ServerPickerSheet({
  visible,
  providers,
  currentId,
  onSelect,
  onClose,
  getDisplayName,
}: ServerPickerSheetProps) {
  const insets = useSafeAreaInsets();
  const nav = useSafeNavigation();
  const { height: SCREEN_HEIGHT } = Dimensions.get("window");

  // Animated values
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const isVisibleRef = useRef(visible);

  // ── PanResponder for swipe-down-to-dismiss ──
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderMove: (
        _: GestureResponderEvent,
        g: PanResponderGestureState,
      ) => {
        if (g.dy <= 0) return;
        const resisted =
          g.dy <= 100 ? g.dy : 100 + (g.dy - 100) * RUBBER_BAND_RESISTANCE;
        translateY.setValue(resisted);
      },
      onPanResponderRelease: (
        _: GestureResponderEvent,
        g: PanResponderGestureState,
      ) => {
        if (g.dy <= 0) {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 20,
            stiffness: 200,
          }).start();
          return;
        }
        const sheetHeight = SCREEN_HEIGHT * 0.55;
        if (g.dy > sheetHeight * SWIPE_DISMISS_THRESHOLD || g.vy > 0.5) {
          Animated.timing(translateY, {
            toValue: SCREEN_HEIGHT,
            duration: 200,
            useNativeDriver: true,
          }).start(() => onClose());
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 20,
            stiffness: 200,
          }).start();
        }
      },
    }),
  ).current;

  // ── Enter/exit animation ──
  useEffect(() => {
    if (visible && !isVisibleRef.current) {
      isVisibleRef.current = true;
      translateY.setValue(SCREEN_HEIGHT);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          damping: 22,
          stiffness: 220,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (!visible && isVisibleRef.current) {
      isVisibleRef.current = false;
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: SCREEN_HEIGHT,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, SCREEN_HEIGHT, translateY, backdropOpacity]);

  return (
    <Modal visible={visible} transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        {/* Animated backdrop */}
        <Animated.View
          className="absolute inset-0 bg-black/60"
          style={{ opacity: backdropOpacity }}
        >
          <TouchableOpacity
            className="flex-1"
            activeOpacity={1}
            onPress={onClose}
          />
        </Animated.View>

        {/* Animated sheet */}
        <Animated.View
          className="rounded-t-3xl border-t"
          style={{
            backgroundColor: colors.bgCard,
            borderColor: colors.borderSubtle,
            maxHeight: SCREEN_HEIGHT * 0.58,
            paddingBottom: insets.bottom + 16,
            transform: [{ translateY }],
          }}
        >
          {/* Drag handle */}
          <View
            {...panResponder.panHandlers}
            className="items-center pt-3 pb-2"
            style={{ height: 40, justifyContent: "center" }}
          >
            <View
              className="w-10 h-1 rounded-full"
              style={{ backgroundColor: colors.borderMuted }}
            />
          </View>

          {/* Header */}
          <View
            className="flex-row items-center justify-between px-5 pb-3 border-b"
            style={{ borderColor: colors.borderSubtle }}
          >
            <View>
              <Text
                className="text-base font-bold"
                style={{
                  color: colors.textPrimary,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                Streaming Sources
              </Text>
              <Text
                className="text-[11px] mt-0.5"
                style={{ color: colors.textTertiary }}
              >
                Switch if your stream is slow or buffering
              </Text>
            </View>

            <View className="flex-row items-center" style={{ gap: 8 }}>
              <TouchableOpacity
                onPress={() => nav.push("/guide?section=sources")}
                activeOpacity={0.7}
                accessibilityLabel="Help choosing a source"
                accessibilityRole="button"
                className="w-7 h-7 rounded-full items-center justify-center border"
                style={{
                  backgroundColor: colors.bgSurface,
                  borderColor: colors.borderSubtle,
                }}
              >
                <Ionicons
                  name="help-circle-outline"
                  size={15}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onClose}
                activeOpacity={0.7}
                accessibilityLabel="Close source selection"
                accessibilityRole="button"
                className="w-7 h-7 rounded-full items-center justify-center border"
                style={{
                  backgroundColor: colors.bgSurface,
                  borderColor: colors.borderSubtle,
                }}
              >
                <Ionicons name="close" size={15} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Clean minimal server list */}
          <ScrollView
            className="px-4 pt-3"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 12 }}
          >
            {providers.map((p) => {
              const isActive = p.id === currentId;
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onSelect(p.id);
                  }}
                  activeOpacity={0.7}
                  className="flex-row items-center justify-between px-4 py-3 rounded-xl mb-1.5 border"
                  style={{
                    backgroundColor: isActive
                      ? "rgba(212, 162, 55, 0.10)"
                      : colors.bgSurface,
                    borderColor: isActive
                      ? "rgba(212, 162, 55, 0.35)"
                      : colors.borderSubtle,
                  }}
                >
                  <View className="flex-row items-center flex-1 mr-3">
                    <Ionicons
                      name="server-outline"
                      size={15}
                      color={isActive ? colors.gold : colors.textTertiary}
                      style={{ marginRight: 10 }}
                    />
                    <Text
                      className="text-sm font-semibold"
                      style={{
                        color: isActive ? colors.gold : colors.textPrimary,
                        fontFamily: "Inter_500Medium",
                      }}
                    >
                      {getDisplayName(p)}
                    </Text>

                    {p.note && (
                      <View
                        className="ml-2.5 px-2 py-0.5 rounded border"
                        style={{
                          backgroundColor: colors.goldBadge,
                          borderColor: "rgba(212,162,55,0.25)",
                        }}
                      >
                        <Text
                          className="text-[9px] font-bold"
                          style={{ color: colors.gold }}
                        >
                          {p.note}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Clean radio checkmark */}
                  {isActive ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={19}
                      color={colors.gold}
                    />
                  ) : (
                    <Ionicons
                      name="ellipse-outline"
                      size={18}
                      color={colors.borderMuted}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}
