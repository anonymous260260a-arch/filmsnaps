/**
 * PlayerControlOverlay — glassmorphism overlay with player controls for mobile.
 *
 * Features: close/back, season/episode badge, source switcher, fullscreen toggle,
 * source info pill at bottom, stage-based loading with blurred backdrop,
 * resume chip, tap-to-reveal in fullscreen, pause-detect keep-visible.
 *
 * The server pill at the bottom uses RNGH Gesture API + Reanimated for
 * polished tap/swipe-up interaction with spring-based press feedback.
 */

import React, { useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Animated as RNAnimated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../theme/colors";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

interface LoadState {
  type: "LOADING" | "SLOW" | "PLAYING" | "STALLED" | "FAILED";
  enteredAt?: number;
  reason?: string;
  isCloudflare?: boolean;
}

interface PlayerControlOverlayProps {
  isFullscreen: boolean;
  isTV: boolean;
  loadState: LoadState;
  resumeChipText?: string | null;
  overlayVisible: boolean;
  showOverlay: () => void;
  overlayOpacity: RNAnimated.Value;
  onClose: () => void;
  onToggleFullscreen: () => void;
  onServerPickerOpen: () => void;
  onEpisodePickerOpen: () => void;
  currentSeason: number;
  currentEpisode: number;
  providerDisplayName: string;
  providerId: string;
  auditMode: boolean;
}

// ── Component ──

export function PlayerControlOverlay({
  isFullscreen,
  isTV,
  loadState,
  resumeChipText,
  overlayVisible,
  showOverlay,
  overlayOpacity,
  onClose,
  onToggleFullscreen,
  onServerPickerOpen,
  onEpisodePickerOpen,
  currentSeason,
  currentEpisode,
  providerDisplayName,
  providerId,
  auditMode,
}: PlayerControlOverlayProps) {
  const insets = useSafeAreaInsets();
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } =
    Dimensions.get("window");

  const isLoadingState =
    loadState.type === "LOADING" || loadState.type === "SLOW";

  // ── Stage-based loading copy ──
  const getStageCopy = (): string => {
    if (loadState.type === "LOADING") {
      const elapsed = Date.now() - (loadState.enteredAt ?? Date.now());
      if (elapsed < 3000) return "Contacting source…";
      return "Starting stream…";
    }
    if (loadState.type === "SLOW") return "Taking longer than usual";
    if (loadState.type === "STALLED") return "Source not responding";
    return "";
  };

  // ── Resume chip animation ──
  const resumeOpacity = useRef(new RNAnimated.Value(0)).current;
  const [displayResume, setDisplayResume] = useState(false);

  useEffect(() => {
    if (resumeChipText) {
      setDisplayResume(true);
      resumeOpacity.setValue(0);
      RNAnimated.timing(resumeOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      RNAnimated.timing(resumeOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        setDisplayResume(false);
      });
    }
  }, [resumeChipText, resumeOpacity]);

  // ── RNGH Gesture: tap OR swipe-up on server pill opens picker ──
  // Uses Reanimated shared values for smooth UI-thread animations
  const pillScale = useSharedValue(1);
  const pillTranslateY = useSharedValue(0);

  const pillAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: pillScale.value },
      { translateY: pillTranslateY.value },
    ],
  }));

  // Tap gesture — fires on any tap (no delay, no heuristics)
  const tapGesture = Gesture.Tap()
    .onBegin(() => {
      pillScale.value = withSpring(0.93, { damping: 15, stiffness: 300 });
    })
    .onFinalize(() => {
      pillScale.value = withSpring(1, { damping: 15, stiffness: 300 });
    })
    .onEnd(() => {
      runOnJS(onServerPickerOpen)();
    });

  // Swipe-up gesture — activates when finger moves 20px+ upward
  // The pill tracks the finger position for a direct-manipulation feel
  const swipeUpGesture = Gesture.Pan()
    .activeOffsetY([-999, -20])
    .onBegin(() => {
      pillScale.value = withSpring(0.93, { damping: 15, stiffness: 300 });
    })
    .onUpdate((e) => {
      // Clamp so the pill doesn't fly off-screen
      pillTranslateY.value = Math.max(e.translationY, -60);
    })
    .onFinalize(() => {
      pillScale.value = withSpring(1, { damping: 15, stiffness: 300 });
      pillTranslateY.value = withSpring(0, { damping: 15, stiffness: 250 });
    })
    .onEnd(() => {
      runOnJS(onServerPickerOpen)();
    });

  // Race — both gestures start; first to activate wins, other is cancelled.
  // Swipe wins on upward drag >20px; tap wins on press without drag.
  const composedGesture = Gesture.Race(swipeUpGesture, tapGesture);

  return (
    <>
      {/* ── Resume chip (top-center) ── */}
      {displayResume && resumeChipText && (
        <RNAnimated.View
          className="absolute z-40 self-center"
          style={{
            top: insets.top + 8,
            opacity: resumeOpacity,
            pointerEvents: "none",
          }}
        >
          <View className="bg-black/70 rounded-full px-4 py-2 border border-amber-500/20">
            <Text className="text-amber-400 text-xs font-semibold">
              {resumeChipText}
            </Text>
          </View>
        </RNAnimated.View>
      )}

      {/* ── Animated overlay bar (fades in/out) ── */}
      <RNAnimated.View
        className="absolute top-0 left-0 right-0 z-30"
        style={{ opacity: overlayOpacity, paddingTop: insets.top + 4 }}
        pointerEvents={overlayVisible ? "box-none" : "none"}
      >
        <View className="flex-row items-center justify-between px-4">
          {/* Close / Shrink button (top left) */}
          <TouchableOpacity
            onPress={isFullscreen ? onToggleFullscreen : onClose}
            className="w-9 h-9 rounded-full bg-black/40 items-center justify-center"
            activeOpacity={0.7}
            style={{ pointerEvents: "auto" }}
          >
            <Ionicons
              name={isFullscreen ? "contract" : "chevron-down"}
              size={20}
              color="#fff"
            />
          </TouchableOpacity>

          {/* Center: Title or Season/Episode badge (for TV) */}
          {isTV && !isFullscreen && (
            <TouchableOpacity
              onPress={onEpisodePickerOpen}
              activeOpacity={0.7}
              style={{ pointerEvents: "auto" }}
            >
              <View className="bg-black/60 rounded-full px-3 py-1.5 border border-amber-500/30 flex-row items-center">
                <Text className="text-white text-xs font-bold">
                  S{String(currentSeason).padStart(2, "0")}:E
                  {String(currentEpisode).padStart(2, "0")}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={12}
                  color={colors.textSecondary}
                  style={{ marginLeft: 4 }}
                />
              </View>
            </TouchableOpacity>
          )}

          {/* Right group: Source switcher + Fullscreen */}
          <View
            className="flex-row items-center gap-2"
            style={{ pointerEvents: "auto" }}
          >
            <TouchableOpacity
              onPress={onServerPickerOpen}
              className="w-9 h-9 rounded-full bg-black/40 items-center justify-center"
              activeOpacity={0.7}
            >
              <Ionicons name="server" size={16} color={colors.gold} />
            </TouchableOpacity>
            {providerId !== "nxsha" && providerId !== "chillflix" && (
              <TouchableOpacity
                onPress={onToggleFullscreen}
                className="w-9 h-9 rounded-full bg-black/40 items-center justify-center"
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isFullscreen ? "contract" : "expand"}
                  size={20}
                  color="#fff"
                />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </RNAnimated.View>

      {/* ── Source pill (bottom) — GestureDetector for tap + swipe-up ── */}
      <RNAnimated.View
        className="absolute bottom-0 left-0 right-0 z-30 px-4"
        style={{ opacity: overlayOpacity, paddingBottom: insets.bottom + 12 }}
        pointerEvents={overlayVisible ? "box-none" : "none"}
      >
        <GestureDetector gesture={composedGesture}>
          <Animated.View
            className="self-center bg-black/60 backdrop-blur-md rounded-full px-4 py-2.5 flex-row items-center border border-zinc-700/40"
            style={pillAnimatedStyle}
          >
            <Ionicons name="server" size={13} color={colors.gold} />
            <Text
              className="text-white text-xs font-semibold ml-2 mr-1"
              numberOfLines={1}
            >
              {providerDisplayName}
            </Text>
            {auditMode && (
              <View className="bg-amber-500/20 rounded px-1.5 py-0.5 mr-1">
                <Text className="text-amber-400 text-[9px] font-bold tracking-wider">
                  AUDIT
                </Text>
              </View>
            )}
            <Ionicons name="chevron-up" size={14} color={colors.zinc500} />
          </Animated.View>
        </GestureDetector>
      </RNAnimated.View>

      {/* ── Loading overlay (only in LOADING or SLOW states) ── */}
      {isLoadingState && (
        <View className="absolute inset-0 z-20 items-center justify-center bg-black/80">
          <View className="items-center">
            <ActivityIndicator size="large" color={colors.gold} />
            <Text className="text-zinc-500 text-sm mt-4">{getStageCopy()}</Text>

            {/* SLOW state: show alt-source action row */}
            {loadState.type === "SLOW" && (
              <View className="mt-6 items-center">
                <TouchableOpacity
                  onPress={onServerPickerOpen}
                  activeOpacity={0.8}
                  className="bg-zinc-800 rounded-xl py-3 px-6 flex-row items-center"
                >
                  <Ionicons name="server" size={16} color={colors.zinc300} />
                  <Text className="text-zinc-300 font-bold text-sm ml-2">
                    Choose a source
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      )}

      {/* ── STALLED chip (floating over video) ── */}
      {loadState.type === "STALLED" && (
        <View className="absolute top-16 left-0 right-0 z-20 items-center pointer-events-none">
          <View className="bg-black/70 rounded-full px-4 py-2 flex-row items-center border border-red-500/20">
            <ActivityIndicator size="small" color={colors.error} />
            <Text className="text-red-400 text-xs font-semibold ml-2">
              Source not responding
            </Text>
          </View>
        </View>
      )}

      {/* ── Tap-to-reveal layer (only in fullscreen when overlay is hidden) ── */}
      {isFullscreen &&
        !overlayVisible &&
        !isLoadingState &&
        loadState.type !== "FAILED" && (
          <TouchableOpacity
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 25,
            }}
            activeOpacity={1}
            onPress={showOverlay}
          />
        )}
    </>
  );
}
