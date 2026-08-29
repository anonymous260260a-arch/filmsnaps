/**
 * PlayerControlOverlay — glassmorphism overlay with player controls for mobile.
 *
 * Features: close/back, season/episode badge, source switcher, fullscreen toggle,
 * source info pill at bottom, stage-based loading with blurred backdrop,
 * resume chip, tap-to-reveal in fullscreen, pause-detect keep-visible,
 * notch-aware safe margins, and 1-tap "Try Next Source" action.
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
  type: "LOADING" | "SLOW" | "PLAYING" | "FAILED";
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
  onTryNextSource?: () => void;
  currentSeason: number;
  currentEpisode: number;
  providerDisplayName: string;
  providerId: string;
  auditMode: boolean;
  onMegaplay?: boolean;
  audio?: "sub" | "dub";
  onAudioChange?: (next: "sub" | "dub") => void;
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
  onTryNextSource,
  currentSeason,
  currentEpisode,
  providerDisplayName,
  providerId,
  auditMode,
  onMegaplay,
  audio = "sub",
  onAudioChange,
}: PlayerControlOverlayProps) {
  const insets = useSafeAreaInsets();
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } =
    Dimensions.get("window");

  const isLoadingState =
    loadState.type === "LOADING" || loadState.type === "SLOW";

  // Safe horizontal padding for notches / camera cutouts in landscape
  const sidePaddingLeft = isFullscreen ? Math.max(insets.left, 16) : 16;
  const sidePaddingRight = isFullscreen ? Math.max(insets.right, 16) : 16;

  // ── Stage-based loading copy ──
  const getStageCopy = (): string => {
    if (loadState.type === "LOADING") {
      const elapsed = Date.now() - (loadState.enteredAt ?? Date.now());
      if (elapsed < 3000) return "Contacting source…";
      return "Starting stream…";
    }
    if (loadState.type === "SLOW") return "Taking longer than usual";
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
  const pillScale = useSharedValue(1);
  const pillTranslateY = useSharedValue(0);

  const pillAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: pillScale.value },
      { translateY: pillTranslateY.value },
    ],
  }));

  // Tap gesture
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

  // Swipe-up gesture
  const swipeUpGesture = Gesture.Pan()
    .activeOffsetY([-999, -20])
    .onBegin(() => {
      pillScale.value = withSpring(0.93, { damping: 15, stiffness: 300 });
    })
    .onUpdate((e) => {
      pillTranslateY.value = Math.max(e.translationY, -60);
    })
    .onFinalize(() => {
      pillScale.value = withSpring(1, { damping: 15, stiffness: 300 });
      pillTranslateY.value = withSpring(0, { damping: 15, stiffness: 250 });
    })
    .onEnd(() => {
      runOnJS(onServerPickerOpen)();
    });

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
          <View
            className="flex-row items-center rounded-full px-4 py-2 border shadow-md"
            style={{
              backgroundColor: "rgba(14, 14, 17, 0.88)",
              borderColor: "rgba(212, 162, 55, 0.35)",
            }}
          >
            <Ionicons
              name="play-forward-outline"
              size={13}
              color={colors.gold}
              style={{ marginRight: 6 }}
            />
            <Text
              className="text-xs font-semibold"
              style={{ color: colors.gold, fontFamily: "Inter_600SemiBold" }}
            >
              {resumeChipText}
            </Text>
          </View>
        </RNAnimated.View>
      )}

      {/* ── Animated overlay bar (fades in/out) ── */}
      <RNAnimated.View
        className="absolute top-0 left-0 right-0 z-30"
        style={{
          opacity: overlayOpacity,
          paddingTop: (isFullscreen ? 12 : insets.top) + 4,
          paddingLeft: sidePaddingLeft,
          paddingRight: sidePaddingRight,
        }}
        pointerEvents={overlayVisible ? "box-none" : "none"}
      >
        <View className="flex-row items-center justify-between">
          {/* Close / Shrink button (top left) */}
          <TouchableOpacity
            onPress={isFullscreen ? onToggleFullscreen : onClose}
            className="w-10 h-10 rounded-full items-center justify-center border"
            style={{
              backgroundColor: "rgba(14, 14, 17, 0.75)",
              borderColor: colors.borderSubtle,
              pointerEvents: "auto",
            }}
            activeOpacity={0.7}
          >
            <Ionicons
              name={isFullscreen ? "contract" : "chevron-down"}
              size={20}
              color={colors.textPrimary}
            />
          </TouchableOpacity>

          {/* Center: Season/Episode badge (for TV) */}
          {isTV && !isFullscreen && (
            <TouchableOpacity
              onPress={onEpisodePickerOpen}
              activeOpacity={0.7}
              style={{ pointerEvents: "auto" }}
            >
              <View
                className="flex-row items-center rounded-full px-3.5 py-1.5 border"
                style={{
                  backgroundColor: "rgba(14, 14, 17, 0.75)",
                  borderColor: "rgba(212, 162, 55, 0.3)",
                }}
              >
                <Text
                  className="text-xs font-bold"
                  style={{
                    color: colors.gold,
                    fontFamily: "Inter_600SemiBold",
                  }}
                >
                  S{String(currentSeason).padStart(2, "0")}:E
                  {String(currentEpisode).padStart(2, "0")}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={12}
                  color={colors.gold}
                  style={{ marginLeft: 5 }}
                />
              </View>
            </TouchableOpacity>
          )}

          {/* Right group: Sub/Dub + Source switcher + Fullscreen */}
          <View
            className="flex-row items-center gap-2.5"
            style={{ pointerEvents: "auto" }}
          >
            {onMegaplay && onAudioChange && (
              <View
                className="flex-row rounded-full overflow-hidden border"
                style={{
                  backgroundColor: "rgba(14, 14, 17, 0.75)",
                  borderColor: colors.borderSubtle,
                }}
              >
                {(["sub", "dub"] as const).map((a) => {
                  const active = audio === a;
                  return (
                    <TouchableOpacity
                      key={a}
                      onPress={() => onAudioChange(a)}
                      className="px-3.5 h-9 items-center justify-center"
                      style={{
                        backgroundColor: active ? colors.gold : "transparent",
                      }}
                      activeOpacity={0.7}
                    >
                      <Text
                        className="text-xs font-bold uppercase"
                        style={{
                          color: active ? colors.bg : colors.zinc300,
                          fontFamily: "Inter_600SemiBold",
                        }}
                      >
                        {a}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {!onMegaplay && (
              <>
                <TouchableOpacity
                  onPress={onServerPickerOpen}
                  className="w-10 h-10 rounded-full items-center justify-center border"
                  style={{
                    backgroundColor: "rgba(14, 14, 17, 0.75)",
                    borderColor: colors.borderSubtle,
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="server-outline"
                    size={17}
                    color={colors.gold}
                  />
                </TouchableOpacity>
                {providerId !== "nxsha" && providerId !== "chillflix" && (
                  <TouchableOpacity
                    onPress={onToggleFullscreen}
                    className="w-10 h-10 rounded-full items-center justify-center border"
                    style={{
                      backgroundColor: "rgba(14, 14, 17, 0.75)",
                      borderColor: colors.borderSubtle,
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={isFullscreen ? "contract" : "expand"}
                      size={18}
                      color={colors.textPrimary}
                    />
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </View>
      </RNAnimated.View>

      {/* ── Source pill (bottom) — GestureDetector for tap + swipe-up ── */}
      <RNAnimated.View
        className="absolute bottom-0 left-0 right-0 z-30"
        style={{
          opacity: overlayOpacity,
          paddingBottom: (isFullscreen ? 16 : insets.bottom) + 12,
          paddingLeft: sidePaddingLeft,
          paddingRight: sidePaddingRight,
        }}
        pointerEvents={overlayVisible ? "box-none" : "none"}
      >
        <GestureDetector gesture={composedGesture}>
          <Animated.View
            className="self-center flex-row items-center rounded-full px-4 py-2.5 border shadow-lg"
            style={[
              {
                backgroundColor: "rgba(14, 14, 17, 0.85)",
                borderColor: colors.borderSubtle,
              },
              pillAnimatedStyle,
            ]}
          >
            <Ionicons name="server" size={13} color={colors.gold} />
            <Text
              className="text-xs font-semibold ml-2 mr-1.5"
              style={{
                color: colors.textPrimary,
                fontFamily: "Inter_600SemiBold",
              }}
              numberOfLines={1}
            >
              {providerDisplayName}
            </Text>
            {auditMode && (
              <View
                className="rounded px-1.5 py-0.5 mr-1"
                style={{ backgroundColor: colors.goldBadge }}
              >
                <Text
                  className="text-[9px] font-bold tracking-wider"
                  style={{ color: colors.gold }}
                >
                  AUDIT
                </Text>
              </View>
            )}
            <Ionicons name="chevron-up" size={14} color={colors.zinc400} />
          </Animated.View>
        </GestureDetector>
      </RNAnimated.View>

      {/* ── Loading overlay (only in LOADING or SLOW states) ── */}
      {isLoadingState && (
        <View
          className="absolute inset-0 z-20 items-center justify-center"
          style={{ backgroundColor: "rgba(7, 7, 8, 0.85)" }}
        >
          <View className="items-center px-6">
            <ActivityIndicator size="large" color={colors.gold} />
            <Text
              className="text-sm mt-4 text-center"
              style={{
                color: colors.textSecondary,
                fontFamily: "Inter_500Medium",
              }}
            >
              {getStageCopy()}
            </Text>

            {/* SLOW state: show 1-Tap "Try Next Source" + Server Picker options */}
            {loadState.type === "SLOW" && (
              <View className="mt-6 flex-row gap-3 flex-wrap justify-center">
                {onTryNextSource && (
                  <TouchableOpacity
                    onPress={onTryNextSource}
                    activeOpacity={0.8}
                    className="rounded-xl py-3 px-5 flex-row items-center shadow-md"
                    style={{ backgroundColor: colors.gold }}
                  >
                    <Ionicons name="play-forward" size={15} color={colors.bg} />
                    <Text
                      className="font-bold text-xs ml-2"
                      style={{
                        color: colors.bg,
                        fontFamily: "Inter_600SemiBold",
                      }}
                    >
                      Try Next Source
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={onServerPickerOpen}
                  activeOpacity={0.8}
                  className="rounded-xl py-3 px-5 flex-row items-center border"
                  style={{
                    backgroundColor: colors.bgCard,
                    borderColor: colors.borderSubtle,
                  }}
                >
                  <Ionicons
                    name="server-outline"
                    size={15}
                    color={colors.textSecondary}
                  />
                  <Text
                    className="font-bold text-xs ml-2"
                    style={{
                      color: colors.textSecondary,
                      fontFamily: "Inter_600SemiBold",
                    }}
                  >
                    All Sources
                  </Text>
                </TouchableOpacity>
              </View>
            )}
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
