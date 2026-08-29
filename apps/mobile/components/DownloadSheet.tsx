/**
 * DownloadSheet — Instant, sleek bottom sheet modal for choosing download servers on mobile.
 * Features ultra-fast smooth transitions, swipe-to-dismiss gesture, and minimalist rows.
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
  Easing,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { colors } from "../theme/colors";

interface ServerOption {
  key: string;
  label: string;
  desc: string;
  badge: string;
}

const SERVERS: ServerOption[] = [
  {
    key: "falix",
    label: "Falix Direct",
    desc: "Direct MP4 & HEVC files · Fastest download",
    badge: "Fastest",
  },
  {
    key: "nxsha",
    label: "Nxsha Mirror",
    desc: "Multi-CDN mirror sources · Backup link",
    badge: "Backup",
  },
];

interface DownloadSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  tmdbId: string;
  mediaType: "movie" | "tv";
  season?: number;
  episode?: number;
  onSelectServer: (server: string) => void;
}

const SHEET_TRAVEL = 320;
const SWIPE_DISMISS_THRESHOLD = 0.25;
const RUBBER_BAND_RESISTANCE = 0.3;

export function DownloadSheet({
  visible,
  onClose,
  title,
  season,
  episode,
  onSelectServer,
}: DownloadSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: SCREEN_HEIGHT } = Dimensions.get("window");

  const translateY = useRef(new Animated.Value(SHEET_TRAVEL)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const isVisibleRef = useRef(visible);

  // ── Swipe-down-to-dismiss ──
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
          g.dy <= 80 ? g.dy : 80 + (g.dy - 80) * RUBBER_BAND_RESISTANCE;
        translateY.setValue(resisted);
      },
      onPanResponderRelease: (
        _: GestureResponderEvent,
        g: PanResponderGestureState,
      ) => {
        if (g.dy <= 0) {
          Animated.timing(translateY, {
            toValue: 0,
            duration: 120,
            useNativeDriver: true,
          }).start();
          return;
        }
        if (g.dy > SHEET_TRAVEL * SWIPE_DISMISS_THRESHOLD || g.vy > 0.4) {
          Animated.timing(translateY, {
            toValue: SHEET_TRAVEL,
            duration: 120,
            useNativeDriver: true,
          }).start(() => onClose());
        } else {
          Animated.timing(translateY, {
            toValue: 0,
            duration: 120,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  // ── Instant Enter / Exit transitions ──
  useEffect(() => {
    if (visible && !isVisibleRef.current) {
      isVisibleRef.current = true;
      translateY.setValue(SHEET_TRAVEL);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 150,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (!visible && isVisibleRef.current) {
      isVisibleRef.current = false;
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: SHEET_TRAVEL,
          duration: 120,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 120,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, translateY, backdropOpacity]);

  const handleSelect = (serverKey: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onClose();
    onSelectServer(serverKey);
  };

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
            maxHeight: SCREEN_HEIGHT * 0.5,
            paddingBottom: insets.bottom + 16,
            transform: [{ translateY }],
          }}
        >
          {/* Drag handle */}
          <View
            {...panResponder.panHandlers}
            className="items-center pt-3 pb-2"
            style={{ height: 36, justifyContent: "center" }}
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
            <View className="flex-1 mr-3">
              <Text
                className="text-base font-bold"
                style={{
                  color: colors.textPrimary,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                Download Server
              </Text>
              <Text
                className="text-[11px] mt-0.5"
                style={{ color: colors.textTertiary }}
                numberOfLines={1}
              >
                {title}
                {season != null && episode != null
                  ? ` · S${season} E${episode}`
                  : ""}
              </Text>
            </View>

            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.7}
              accessibilityLabel="Close download options"
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

          {/* Server list */}
          <ScrollView
            className="px-4 pt-3"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 8 }}
          >
            {SERVERS.map((server) => (
              <TouchableOpacity
                key={server.key}
                onPress={() => handleSelect(server.key)}
                activeOpacity={0.7}
                className="flex-row items-center justify-between px-4 py-3.5 rounded-xl mb-2 border"
                style={{
                  backgroundColor: colors.bgElevated,
                  borderColor: colors.borderSubtle,
                }}
              >
                <View className="flex-row items-center flex-1 mr-3">
                  {/* Download cloud icon */}
                  <View
                    className="w-8 h-8 rounded-full items-center justify-center mr-3"
                    style={{
                      backgroundColor:
                        server.key === "falix"
                          ? colors.goldBadge
                          : "rgba(255, 255, 255, 0.05)",
                    }}
                  >
                    <Ionicons
                      name="cloud-download-outline"
                      size={16}
                      color={
                        server.key === "falix"
                          ? colors.gold
                          : colors.textSecondary
                      }
                    />
                  </View>

                  {/* Title & subtitle */}
                  <View className="flex-1">
                    <Text
                      className="text-sm font-semibold"
                      style={{
                        color: colors.textPrimary,
                        fontFamily: "Inter_500Medium",
                      }}
                    >
                      {server.label}
                    </Text>
                    <Text
                      className="text-[11px] mt-0.5"
                      style={{ color: colors.textTertiary }}
                    >
                      {server.desc}
                    </Text>
                  </View>
                </View>

                {/* Badge */}
                <View
                  className="px-2 py-0.5 rounded"
                  style={{
                    backgroundColor:
                      server.key === "falix"
                        ? colors.goldBadge
                        : "rgba(255, 255, 255, 0.06)",
                  }}
                >
                  <Text
                    className="text-[9px] font-bold"
                    style={{
                      color:
                        server.key === "falix"
                          ? colors.gold
                          : colors.textTertiary,
                    }}
                  >
                    {server.badge}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}
