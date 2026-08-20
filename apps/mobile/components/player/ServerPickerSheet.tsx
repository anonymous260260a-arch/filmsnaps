/**
 * ServerPicker — bottom sheet modal for selecting streaming providers on mobile.
 * Supports swipe-down-to-dismiss via PanResponder with rubber-band resistance.
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

const SWIPE_DISMISS_THRESHOLD = 0.3; // 30% of sheet height
const RUBBER_BAND_RESISTANCE = 0.3; // resistance factor beyond 100px

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

  // Track current visible state for animation gating
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
        if (g.dy <= 0) return; // ignore upward swipes
        // Rubber-band resistance: first 100px are 1:1, then reduced
        const resisted =
          g.dy <= 100 ? g.dy : 100 + (g.dy - 100) * RUBBER_BAND_RESISTANCE;
        translateY.setValue(resisted);
      },
      onPanResponderRelease: (
        _: GestureResponderEvent,
        g: PanResponderGestureState,
      ) => {
        if (g.dy <= 0) {
          // Not a downward swipe — snap back
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 20,
            stiffness: 200,
          }).start();
          return;
        }
        const sheetHeight = SCREEN_HEIGHT * 0.6;
        if (g.dy > sheetHeight * SWIPE_DISMISS_THRESHOLD || g.vy > 0.5) {
          // Dismiss
          Animated.timing(translateY, {
            toValue: SCREEN_HEIGHT,
            duration: 200,
            useNativeDriver: true,
          }).start(() => onClose());
        } else {
          // Snap back
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
      // Reset position and animate in
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
          className="bg-zinc-900 rounded-t-3xl"
          style={{
            maxHeight: SCREEN_HEIGHT * 0.6,
            paddingBottom: insets.bottom + 16,
            transform: [{ translateY }],
          }}
        >
          {/* Drag handle — interactive with PanResponder */}
          <View
            {...panResponder.panHandlers}
            className="items-center pt-3 pb-2"
            style={{ height: 44, justifyContent: "center" }}
          >
            <View className="w-10 h-1 rounded-full bg-zinc-600" />
          </View>

          {/* Header */}
          <View className="flex-row items-center justify-between px-6 py-3 border-b border-zinc-800">
            <Text className="text-white text-lg font-bold">
              Playback Sources
            </Text>
            <View className="flex-row items-center" style={{ gap: 12 }}>
              <TouchableOpacity
                onPress={() => nav.push("/guide?section=sources")}
                activeOpacity={0.7}
                accessibilityLabel="Help choosing a source"
                accessibilityRole="button"
              >
                <Ionicons
                  name="help-circle-outline"
                  size={20}
                  color={colors.zinc500}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onClose}
                activeOpacity={0.7}
                accessibilityLabel="Close source selection"
                accessibilityRole="button"
              >
                <Ionicons name="close" size={22} color={colors.zinc500} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Server list */}
          <ScrollView
            className="px-4 pt-2"
            showsVerticalScrollIndicator={false}
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
                  className={`flex-row items-center px-4 py-4 rounded-xl mb-1 ${
                    isActive
                      ? "bg-primary/10 border border-amber-500/20"
                      : "bg-zinc-800/40"
                  }`}
                >
                  <View
                    className={`w-10 h-10 rounded-full items-center justify-center mr-4 ${
                      isActive ? "bg-primary" : "bg-zinc-700"
                    }`}
                  >
                    {isActive ? (
                      <Ionicons
                        name="checkmark"
                        size={18}
                        color={colors.voidBlack}
                      />
                    ) : (
                      <Ionicons
                        name="server-outline"
                        size={16}
                        color={colors.zinc500}
                      />
                    )}
                  </View>

                  <View className="flex-1">
                    <View className="flex-row items-center flex-wrap gap-x-2 gap-y-1">
                      <Text
                        className={`text-base font-semibold ${
                          isActive ? "text-amber-400" : "text-zinc-200"
                        }`}
                      >
                        {getDisplayName(p)}
                      </Text>
                      {p.note && (
                        <View
                          className="px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: "rgba(212,162,55,0.15)",
                            borderWidth: 1,
                            borderColor: "rgba(212,162,55,0.30)",
                          }}
                        >
                          <Text
                            className="text-[10px] font-bold"
                            style={{ color: "#D4A237" }}
                          >
                            {p.note}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text className="text-zinc-600 text-xs mt-0.5">
                      {isActive ? "Currently active" : "Tap to switch"}
                    </Text>
                  </View>

                  {isActive && (
                    <View className="w-2 h-2 rounded-full bg-primary" />
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
