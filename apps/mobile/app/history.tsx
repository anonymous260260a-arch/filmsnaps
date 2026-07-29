import React, { useState, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackIcon, ForwardIcon } from "../components/Icons";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeNavigation } from "@/lib/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { tmdbApi } from "../lib/api";
import { MediaCard } from "../components/MediaCard";
import { ProgressiveImage } from "../components/ProgressiveImage";
import {
  getAllProgress,
  getAggregatedHistory,
  clearAllProgress,
  clearProgress,
} from "../lib/watchHistory";
import { getImageUrl } from "@filmsnaps/shared";
import { EmptyState } from "../components/EmptyState";
import type { Movie } from "@filmsnaps/shared";
import type { WatchProgress } from "../lib/watchHistory";

import { colors } from "../theme/colors";

const NUM_COLUMNS = 3;
const GAP = 8;
const PADDING = 16;

function HistorySkeleton() {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}
    >
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 8,
          flexDirection: "row",
          justifyContent: "space-between",
        }}
      >
        <View
          style={{
            width: 80,
            height: 22,
            borderRadius: 4,
            backgroundColor: colors.skeletonBg,
          }}
        />
        <View
          style={{
            width: 48,
            height: 20,
            borderRadius: 4,
            backgroundColor: colors.skeletonBg,
          }}
        />
      </View>
      {Array.from({ length: 5 }).map((_, i) => (
        <View
          key={i}
          style={{
            flexDirection: "row",
            backgroundColor: colors.skeletonBgAlt,
            borderRadius: 12,
            marginHorizontal: 16,
            marginBottom: 8,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              width: 68,
              height: 102,
              backgroundColor: colors.skeletonBg,
            }}
          />
          <View style={{ flex: 1, padding: 10, justifyContent: "center" }}>
            <View
              style={{
                width: "70%",
                height: 14,
                borderRadius: 4,
                backgroundColor: colors.skeletonBg,
              }}
            />
            <View
              style={{
                width: "40%",
                height: 10,
                borderRadius: 4,
                backgroundColor: colors.skeletonBg,
                marginTop: 6,
              }}
            />
            <View
              style={{
                width: "100%",
                height: 4,
                borderRadius: 2,
                backgroundColor: colors.skeletonBg,
                marginTop: 8,
              }}
            />
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                marginTop: 8,
              }}
            >
              <View
                style={{
                  width: 50,
                  height: 10,
                  borderRadius: 4,
                  backgroundColor: colors.skeletonBg,
                }}
              />
              <View
                style={{
                  width: 40,
                  height: 10,
                  borderRadius: 4,
                  backgroundColor: colors.skeletonBg,
                }}
              />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

export default function HistoryScreen() {
  const nav = useSafeNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { width: SCREEN_WIDTH } = useWindowDimensions();

  const [entries, setEntries] = useState<
    Array<{
      latest: WatchProgress;
      episodeCount: number;
      fullyWatched: boolean;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [metadata, setMetadata] = useState<Record<string, Movie | null>>({});
  const [displayCount, setDisplayCount] = useState(10);
  const loadedRef = useRef(false);

  const loadHistory = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else if (!loadedRef.current) setLoading(true);
    try {
      const agg = await getAggregatedHistory();
      setEntries(agg);

      // Fetch TMDB metadata for each unique ID
      const metaMap: Record<string, Movie | null> = { ...metadata };
      const fetchPromises = agg
        .filter((e) => !metaMap[e.latest.tmdbId])
        .map(async (entry) => {
          try {
            const id = entry.latest.tmdbId;
            if (entry.latest.mediaType === "tv") {
              const data = await tmdbApi.getTVDetails(Number(id));
              metaMap[id] = data as unknown as Movie;
            } else {
              const data = await tmdbApi.getMovieDetails(Number(id));
              metaMap[id] = data as Movie;
            }
          } catch {
            metaMap[entry.latest.tmdbId] = null;
          }
        });
      await Promise.all(fetchPromises);
      setMetadata({ ...metaMap });
      loadedRef.current = true;
    } catch (e) {
      console.warn("[History] Load failed:", e);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  // Reload whenever the screen gains focus
  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory]),
  );

  const itemWidth = useMemo(
    () => (SCREEN_WIDTH - PADDING * 2 - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS,
    [SCREEN_WIDTH],
  );

  const handleItemPress = useCallback(
    (item: WatchProgress) => {
      const id = item.tmdbId;
      if (item.mediaType === "tv") {
        const season = item.season ?? 1;
        const episode = item.episode ?? 1;
        queryClient.prefetchQuery({
          queryKey: ["tv", id],
          queryFn: () => tmdbApi.getTVDetails(Number(id)),
          staleTime: 1000 * 60 * 60,
        });
        router.prefetch(`/tv/${id}`);
        nav.push(`/watch/tv/${id}/${season}/${episode}`);
      } else {
        queryClient.prefetchQuery({
          queryKey: ["movie", id],
          queryFn: () => tmdbApi.getMovieDetails(Number(id)),
          staleTime: 1000 * 60 * 60,
        });
        router.prefetch(`/movie/${id}`);
        nav.push(`/watch/movie/${id}`);
      }
    },
    [nav, router, queryClient],
  );

  const formatDate = (ts: number): string => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const progressLabel = (p: WatchProgress): string => {
    if (p.completed) return "Completed";
    const pct = Math.round(p.percent * 100);
    if (pct < 5) return "Started";
    return `${pct}%`;
  };

  if (loading) {
    return <HistorySkeleton />;
  }

  return (
    <View
      className="flex-1 bg-void"
      style={{ backgroundColor: colors.bg, paddingTop: insets.top }}
    >
      {/* Header */}
      <View className="px-5 pt-4 pb-2 flex-row items-center justify-between">
        <View className="flex-row items-center">
          <TouchableOpacity
            onPress={() => nav.goBack({ fallback: "/(tabs)" })}
            className="w-9 h-9 rounded-full bg-zinc-800/60 items-center justify-center mr-3"
            activeOpacity={0.7}
          >
            <BackIcon width={20} height={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text
            style={{
              fontFamily: "PlayfairDisplay_700Bold",
              fontSize: 22,
              color: colors.textPrimary,
            }}
          >
            History
          </Text>
        </View>
      </View>

      {entries.length === 0 ? (
        <EmptyState
          icon="time-outline"
          title="No history yet"
          message="Movies and TV shows you watch will appear here."
          actionLabel="Browse films"
          onAction={() => nav.push("/")}
        />
      ) : (
        <FlatList
          data={entries.slice(0, displayCount)}
          keyExtractor={(item) =>
            `${item.latest.mediaType}:${item.latest.tmdbId}`
          }
          contentContainerStyle={{ padding: PADDING, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          onEndReached={() => {
            if (displayCount < entries.length) {
              setDisplayCount((prev) => prev + 10);
            }
          }}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                loadHistory(true);
              }}
              tintColor={colors.gold}
              colors={[colors.gold]}
            />
          }
          ListFooterComponent={
            <>
              {displayCount < entries.length ? (
                <View className="self-center mt-4 mb-3 py-1">
                  <ActivityIndicator size="small" color={colors.gold} />
                </View>
              ) : entries.length > 0 ? (
                <View className="self-center mt-4 mb-3">
                  <Text className="text-text-tertiary text-xs">
                    All caught up — {entries.length} items
                  </Text>
                </View>
              ) : null}
              <TouchableOpacity
                onPress={() => {
                  Alert.alert(
                    "Clear History",
                    "This will remove all your watch history. This cannot be undone.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Clear All",
                        style: "destructive",
                        onPress: () =>
                          clearAllProgress().then(() => loadHistory()),
                      },
                    ],
                  );
                }}
                activeOpacity={0.7}
                className="self-center mb-8"
              >
                <View className="flex-row items-center">
                  <Ionicons
                    name="trash-outline"
                    size={14}
                    color={colors.error}
                  />
                  <Text className="text-red-400 text-xs ml-1.5">
                    Clear History
                  </Text>
                </View>
              </TouchableOpacity>
            </>
          }
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => {
            const p = item.latest;
            const meta = metadata[p.tmdbId];
            const title =
              (p.mediaType === "tv" ? meta?.name : meta?.title) ??
              `ID: ${p.tmdbId}`;
            const poster = meta?.poster_path;
            const pct = p.completed ? 1 : p.percent;
            const label = progressLabel(p);
            const isFullyWatched = item.fullyWatched;

            return (
              <TouchableOpacity
                onPress={() => handleItemPress(p)}
                activeOpacity={0.7}
                className="flex-row bg-elevated rounded-xl overflow-hidden"
                style={{ backgroundColor: colors.bgCard }}
              >
                {/* Poster */}
                <View style={{ width: 68, height: 102 }}>
                  {poster ? (
                    <ProgressiveImage
                      uri={getImageUrl(poster, "w185")}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode="cover"
                    />
                  ) : (
                    <View
                      className="flex-1 items-center justify-center"
                      style={{ backgroundColor: colors.bgTop }}
                    >
                      <Ionicons
                        name={p.mediaType === "tv" ? "tv" : "film"}
                        size={24}
                        color={colors.iconMuted}
                      />
                    </View>
                  )}
                </View>

                {/* Info */}
                <View className="flex-1 px-3 py-2.5 justify-center">
                  <Text
                    className="text-text-primary text-sm font-bold leading-tight"
                    numberOfLines={1}
                  >
                    {title}
                  </Text>

                  {/* TV episode subtitle */}
                  {p.mediaType === "tv" &&
                    p.season != null &&
                    p.episode != null && (
                      <Text className="text-text-tertiary text-xs mt-0.5">
                        S{p.season}:E{p.episode}
                        {item.episodeCount > 1 &&
                          ` +${item.episodeCount - 1} more`}
                      </Text>
                    )}

                  {isFullyWatched ? (
                    <View className="bg-green-900/40 rounded-sm px-1.5 py-0.5 self-start">
                      <Text className="text-green-400 text-[9px] font-bold">
                        COMPLETED
                      </Text>
                    </View>
                  ) : null}

                  {/* Progress bar */}
                  <View
                    className="h-1 rounded-full mt-2 overflow-hidden"
                    style={{ backgroundColor: colors.progressTrack }}
                  >
                    <View
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.round(pct * 100)}%`,
                        backgroundColor: isFullyWatched
                          ? colors.successGreen
                          : colors.gold,
                      }}
                    />
                  </View>

                  {/* Bottom row: label + date */}
                  <View className="flex-row items-center justify-between mt-1.5">
                    <View className="flex-row items-center gap-1">
                      {isFullyWatched ? (
                        <Ionicons
                          name="checkmark-circle"
                          size={12}
                          color={colors.successGreen}
                        />
                      ) : p.completed ? (
                        <Ionicons
                          name="checkmark-circle"
                          size={12}
                          color={colors.gold}
                        />
                      ) : (
                        <Ionicons name="play" size={10} color={colors.gold} />
                      )}
                      <Text
                        className={`text-xs font-semibold ${isFullyWatched ? "text-green-500" : "text-primary"}`}
                      >
                        {isFullyWatched ? "Complete" : label}
                      </Text>
                    </View>
                    <Text className="text-text-tertiary text-[10px]">
                      {formatDate(p.updatedAt)}
                    </Text>
                  </View>
                </View>

                {/* Chevron */}
                <View className="justify-center pr-3">
                  <ForwardIcon
                    width={16}
                    height={16}
                    color={colors.iconMuted}
                  />
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}
