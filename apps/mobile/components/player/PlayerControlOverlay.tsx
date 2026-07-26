/**
 * PlayerControlOverlay — glassmorphism overlay with player controls for mobile.
 *
 * Features: close/back, season/episode badge, source switcher, fullscreen toggle,
 * source info pill at bottom, stage-based loading with blurred backdrop,
 * resume chip, tap-to-reveal in fullscreen, pause-detect keep-visible.
 */

import React, { useRef, useCallback, useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
  overlayOpacity: Animated.Value;
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
  const resumeOpacity = useRef(new Animated.Value(0)).current;
  const [displayResume, setDisplayResume] = useState(false);

  useEffect(() => {
    if (resumeChipText) {
      setDisplayResume(true);
      resumeOpacity.setValue(0);
      Animated.timing(resumeOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(resumeOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        setDisplayResume(false);
      });
    }
  }, [resumeChipText, resumeOpacity]);

  return (
    <>
      {/* ── Resume chip (top-center) ── */}
      {displayResume && resumeChipText && (
        <Animated.View
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
        </Animated.View>
      )}

      {/* ── Animated overlay bar (fades in/out) ── */}
      <Animated.View
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
                  color="#a1a1aa"
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
              <Ionicons name="server" size={16} color="#D4A237" />
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
      </Animated.View>

      {/* ── Source pill (bottom) — also fades with overlay ── */}
      <Animated.View
        className="absolute bottom-0 left-0 right-0 z-30 px-4"
        style={{ opacity: overlayOpacity, paddingBottom: insets.bottom + 12 }}
        pointerEvents={overlayVisible ? "box-none" : "none"}
      >
        <TouchableOpacity
          onPress={onServerPickerOpen}
          activeOpacity={0.8}
          className="self-center bg-black/60 backdrop-blur-md rounded-full px-4 py-2.5 flex-row items-center border border-zinc-700/40"
          style={{ pointerEvents: "auto" }}
        >
          <Ionicons name="server" size={13} color="#D4A237" />
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
          <Ionicons name="chevron-up" size={14} color="#71717a" />
        </TouchableOpacity>
      </Animated.View>

      {/* ── Loading overlay (only in LOADING or SLOW states) ── */}
      {isLoadingState && (
        <View className="absolute inset-0 z-20 items-center justify-center bg-black/80">
          <View className="items-center">
            <ActivityIndicator size="large" color="#D4A237" />
            <Text className="text-zinc-500 text-sm mt-4">{getStageCopy()}</Text>

            {/* SLOW state: show alt-source action row */}
            {loadState.type === "SLOW" && (
              <View className="mt-6 items-center">
                <TouchableOpacity
                  onPress={onServerPickerOpen}
                  activeOpacity={0.8}
                  className="bg-zinc-800 rounded-xl py-3 px-6 flex-row items-center"
                >
                  <Ionicons name="server" size={16} color="#d4d4d8" />
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
            <ActivityIndicator size="small" color="#ef4444" />
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
