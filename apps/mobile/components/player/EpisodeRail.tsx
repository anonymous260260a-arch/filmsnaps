/**
 * EpisodeRail — Season & Episode picker bottom sheet modal for TV shows on mobile.
 * Features clean media list cards with strictly bounded 16:9 thumbnails,
 * generous spacing, clear typography hierarchy, and smooth swipe-down gesture dismiss.
 */

import React, { useEffect, useRef, useState } from "react";
import { colors } from "../../theme/colors";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  Animated,
  PanResponder,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { getImageUrl } from "@filmsnaps/shared";
import { ProgressiveImage } from "../ProgressiveImage";
import { useSeasonEpisodes, useTVSeasonsOnly } from "../../hooks/useTMDB";
import { getProgress } from "../../lib/watchHistory";
import type { WatchProgress } from "../../lib/watchHistory";

interface EpisodeRailProps {
  visible: boolean;
  tvId: string | null;
  currentSeason: number;
  currentEpisode: number;
  onSelect: (season: number, episode: number) => void;
  onClose: () => void;
}

const SWIPE_DISMISS_THRESHOLD = 0.3;
const RUBBER_BAND_RESISTANCE = 0.3;

const THUMB_WIDTH = 104;
const THUMB_HEIGHT = 58;

export function EpisodeRail({
  visible,
  tvId,
  currentSeason,
  currentEpisode,
  onSelect,
  onClose,
}: EpisodeRailProps) {
  const insets = useSafeAreaInsets();
  const { height: SCREEN_HEIGHT } = Dimensions.get("window");
  const [pickerSeason, setPickerSeason] = useState(currentSeason);
  const nextUpFound = useRef(false);

  // Animated values for sheet presentation & gesture dismiss
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const isVisibleRef = useRef(visible);

  // Reset nextUp tracker when season changes
  useEffect(() => {
    nextUpFound.current = false;
  }, [pickerSeason]);

  // Scroll anchors
  const seasonScrollRef = useRef<ScrollView>(null);
  const episodeScrollRef = useRef<ScrollView>(null);
  const seasonPillX = useRef<Record<number, number>>({});
  const epRowY = useRef<Record<number, number>>({});

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
        const sheetHeight = SCREEN_HEIGHT * 0.65;
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

  // ── Enter / Exit animation ──
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

  // Scroll active season into view
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      const sx = seasonPillX.current[currentSeason];
      if (sx != null && seasonScrollRef.current) {
        seasonScrollRef.current.scrollTo({
          x: Math.max(0, sx - 24),
          animated: false,
        });
      }
    }, 60);
    return () => clearTimeout(t);
  }, [visible, currentSeason]);

  const {
    data: seasonData,
    isLoading,
    isError,
  } = useSeasonEpisodes(tvId!, pickerSeason);
  const { data: tvData } = useTVSeasonsOnly(tvId!);

  const episodes = (seasonData?.episodes as any[]) ?? [];
  const seasons =
    (tvData?.seasons as any[])
      ?.filter((s: any) => s.season_number > 0 && s.episode_count > 0)
      ?.map((s: any) => s.season_number) ?? [];

  // Scroll episode list to currently-playing episode
  useEffect(() => {
    if (!visible || pickerSeason !== currentSeason) return;
    const t = setTimeout(() => {
      const ey = epRowY.current[currentEpisode];
      if (ey != null && episodeScrollRef.current) {
        episodeScrollRef.current.scrollTo({
          y: Math.max(0, ey - 80),
          animated: false,
        });
      }
    }, 90);
    return () => clearTimeout(t);
  }, [visible, pickerSeason, currentSeason, currentEpisode, episodes.length]);

  // Reset picker season when modal opens
  useEffect(() => {
    if (visible) {
      setPickerSeason(currentSeason);
    }
  }, [visible, currentSeason]);

  // Load watch progress for indicators
  const [episodeProgress, setEpisodeProgress] = useState<
    Record<string, WatchProgress>
  >({});
  useEffect(() => {
    if (!tvId || !visible) return;
    getProgress(tvId, "tv", pickerSeason, 0)
      .then(() => {
        (async () => {
          const map: Record<string, WatchProgress> = {};
          const eps = episodes;
          const results = await Promise.all(
            eps.map((ep: any) => {
              const epNum = ep.episode_number;
              if (!epNum) return Promise.resolve(null);
              return getProgress(tvId, "tv", pickerSeason, epNum).then((p) => ({
                epNum,
                p,
              }));
            }),
          );
          for (const r of results) {
            if (r && r.p) {
              map[`${pickerSeason}:${r.epNum}`] = r.p;
            }
          }
          setEpisodeProgress(map);
        })();
      })
      .catch(() => {});
  }, [tvId, pickerSeason, visible, episodes]);

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
            height: SCREEN_HEIGHT * 0.65,
            paddingBottom: insets.bottom + 12,
            transform: [{ translateY }],
          }}
        >
          {/* Drag handle */}
          <View
            {...panResponder.panHandlers}
            className="items-center pt-3 pb-2"
            style={{ height: 38, justifyContent: "center" }}
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
            <Text
              className="text-base font-bold"
              style={{
                color: colors.textPrimary,
                fontFamily: "Inter_600SemiBold",
              }}
            >
              Episodes
            </Text>

            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.7}
              accessibilityLabel="Close episode picker"
              accessibilityRole="button"
              className="w-7 h-7 rounded-full items-center justify-center border"
              style={{
                backgroundColor: colors.bgSurface,
                borderColor: colors.borderSubtle,
              }}
            >
              <Ionicons name="close" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Season Selector Pills */}
          {seasons.length > 0 && (
            <View
              className="py-2.5 border-b"
              style={{ borderColor: colors.borderSubtle }}
            >
              <ScrollView
                ref={seasonScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
              >
                {seasons.map((s: number) => {
                  const isSelected = s === pickerSeason;
                  return (
                    <TouchableOpacity
                      key={s}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setPickerSeason(s);
                      }}
                      onLayout={(e) => {
                        seasonPillX.current[s] = e.nativeEvent.layout.x;
                      }}
                      activeOpacity={0.7}
                      className="px-4 py-1.5 rounded-full border"
                      style={{
                        backgroundColor: isSelected
                          ? colors.gold
                          : colors.bgSurface,
                        borderColor: isSelected
                          ? colors.gold
                          : colors.borderSubtle,
                      }}
                    >
                      <Text
                        className="text-xs font-semibold"
                        style={{
                          color: isSelected ? colors.bg : colors.textSecondary,
                          fontFamily: "Inter_600SemiBold",
                        }}
                      >
                        Season {s}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Episode List */}
          {isLoading ? (
            <View className="flex-1 items-center justify-center py-10">
              <ActivityIndicator size="small" color={colors.gold} />
              <Text
                className="text-xs mt-3"
                style={{ color: colors.textSecondary }}
              >
                Loading episodes…
              </Text>
            </View>
          ) : isError ? (
            <View className="flex-1 items-center justify-center py-10 px-6">
              <Ionicons
                name="alert-circle-outline"
                size={24}
                color={colors.error}
              />
              <Text
                className="text-xs mt-2 text-center"
                style={{ color: colors.textSecondary }}
              >
                Failed to load episodes for this season
              </Text>
            </View>
          ) : episodes.length === 0 ? (
            <View className="flex-1 items-center justify-center py-10">
              <Ionicons
                name="tv-outline"
                size={24}
                color={colors.textTertiary}
              />
              <Text
                className="text-xs mt-2"
                style={{ color: colors.textTertiary }}
              >
                No episodes found
              </Text>
            </View>
          ) : (
            <ScrollView
              ref={episodeScrollRef}
              className="flex-1 px-4 pt-3"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              {episodes.map((ep: any, index: number) => {
                const epNum = ep.episode_number ?? index + 1;
                const isActive =
                  pickerSeason === currentSeason && epNum === currentEpisode;
                const progKey = `${pickerSeason}:${epNum}`;
                const epProg = episodeProgress[progKey];
                const hasProgress =
                  epProg && !epProg.completed && epProg.percent > 0.05;
                const isCompleted = epProg?.completed;
                const isNextUp =
                  !isActive &&
                  !isCompleted &&
                  !hasProgress &&
                  !nextUpFound.current;
                if (isNextUp) nextUpFound.current = true;

                return (
                  <TouchableOpacity
                    key={ep.id ?? index}
                    onLayout={(e) => {
                      if (epNum != null)
                        epRowY.current[epNum] = e.nativeEvent.layout.y;
                    }}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      onSelect(pickerSeason, epNum);
                    }}
                    activeOpacity={0.7}
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      backgroundColor: isActive
                        ? "rgba(212, 162, 55, 0.09)"
                        : colors.bgSurface,
                      borderColor: isActive
                        ? "rgba(212, 162, 55, 0.45)"
                        : colors.borderSubtle,
                      borderWidth: 1,
                      borderRadius: 14,
                      padding: 10,
                      marginBottom: 10,
                    }}
                  >
                    {/* Fixed 16:9 Thumbnail Box */}
                    <View
                      style={{
                        width: THUMB_WIDTH,
                        height: THUMB_HEIGHT,
                        borderRadius: 8,
                        overflow: "hidden",
                        backgroundColor: colors.bgSubtle,
                        marginRight: 12,
                        position: "relative",
                      }}
                    >
                      {ep.still_path ? (
                        <ProgressiveImage
                          uri={getImageUrl(ep.still_path, "w300")}
                          style={{
                            width: THUMB_WIDTH,
                            height: THUMB_HEIGHT,
                            borderRadius: 8,
                          }}
                          resizeMode="cover"
                        />
                      ) : (
                        <View
                          style={{
                            width: THUMB_WIDTH,
                            height: THUMB_HEIGHT,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Ionicons
                            name="image-outline"
                            size={20}
                            color={colors.textTertiary}
                          />
                        </View>
                      )}

                      {/* Active playing indicator badge */}
                      {isActive && (
                        <View
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: "rgba(0,0,0,0.45)",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <View
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 12,
                              backgroundColor: colors.gold,
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Ionicons name="play" size={10} color={colors.bg} />
                          </View>
                        </View>
                      )}

                      {/* Progress Bar */}
                      {hasProgress && !isActive && (
                        <View
                          style={{
                            position: "absolute",
                            bottom: 0,
                            left: 0,
                            right: 0,
                            height: 3,
                            backgroundColor: "rgba(0,0,0,0.7)",
                          }}
                        >
                          <View
                            style={{
                              height: "100%",
                              backgroundColor: colors.gold,
                              width: `${Math.round(epProg.percent * 100)}%`,
                            }}
                          />
                        </View>
                      )}

                      {/* Completed Checkmark */}
                      {isCompleted && !isActive && (
                        <View
                          style={{
                            position: "absolute",
                            top: 4,
                            right: 4,
                            width: 16,
                            height: 16,
                            borderRadius: 8,
                            backgroundColor: colors.successGreen,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Ionicons name="checkmark" size={10} color="#fff" />
                        </View>
                      )}
                    </View>

                    {/* Episode details column */}
                    <View
                      style={{
                        flex: 1,
                        justifyContent: "space-between",
                        minHeight: THUMB_HEIGHT,
                      }}
                    >
                      {/* Top Header: Badge + Episode Number */}
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: 3,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            fontFamily: "Inter_600SemiBold",
                            color: isActive ? colors.gold : colors.goldDim,
                            letterSpacing: 0.5,
                          }}
                        >
                          EPISODE {epNum}
                        </Text>

                        {isActive ? (
                          <View
                            style={{
                              backgroundColor: "rgba(212, 162, 55, 0.2)",
                              paddingHorizontal: 6,
                              paddingVertical: 1,
                              borderRadius: 4,
                            }}
                          >
                            <Text
                              style={{
                                color: colors.gold,
                                fontSize: 9,
                                fontWeight: "700",
                              }}
                            >
                              PLAYING
                            </Text>
                          </View>
                        ) : isNextUp ? (
                          <View
                            style={{
                              backgroundColor: colors.goldBadge,
                              paddingHorizontal: 6,
                              paddingVertical: 1,
                              borderRadius: 4,
                            }}
                          >
                            <Text
                              style={{
                                color: colors.gold,
                                fontSize: 9,
                                fontWeight: "700",
                              }}
                            >
                              NEXT UP
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      {/* Episode Title */}
                      <Text
                        style={{
                          fontSize: 13,
                          fontFamily: "Inter_600SemiBold",
                          color: colors.textPrimary,
                          lineHeight: 17,
                          marginBottom: 3,
                        }}
                        numberOfLines={1}
                      >
                        {ep.name || `Episode ${epNum}`}
                      </Text>

                      {/* Meta info: Runtime and/or release date */}
                      <View
                        style={{ flexDirection: "row", alignItems: "center" }}
                      >
                        {ep.runtime ? (
                          <Text
                            style={{
                              fontSize: 10,
                              color: colors.textTertiary,
                              fontFamily: "Inter_500Medium",
                            }}
                          >
                            {ep.runtime} min
                          </Text>
                        ) : null}
                        {ep.runtime && ep.air_date ? (
                          <Text
                            style={{
                              fontSize: 10,
                              color: colors.textTertiary,
                              marginHorizontal: 6,
                            }}
                          >
                            •
                          </Text>
                        ) : null}
                        {ep.air_date ? (
                          <Text
                            style={{
                              fontSize: 10,
                              color: colors.textTertiary,
                              fontFamily: "Inter_400Regular",
                            }}
                          >
                            {ep.air_date}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}
