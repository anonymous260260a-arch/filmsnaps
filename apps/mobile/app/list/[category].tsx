import React, { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeNavigation } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackIcon } from "../../components/Icons";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tmdbApi } from "../../lib/api";
import { MediaCard } from "../../components/MediaCard";
import { colors } from "../../theme/colors";

const CATEGORY_CONFIG: Record<
  string,
  { title: string; fetchFn: (page: number) => Promise<any> }
> = {
  "trending-movies": {
    title: "Trending Movies",
    fetchFn: (page) => tmdbApi.getTrendingMovies(page),
  },
  "trending-tv": {
    title: "Trending TV",
    fetchFn: (page) => tmdbApi.getTrendingTV(page),
  },
  "popular-movies": {
    title: "Popular Movies",
    fetchFn: (page) => tmdbApi.getPopularMovies(page),
  },
};

const ITEMS_PER_PAGE = 20;
const NUM_COLUMNS = 3;
const GAP = 8;
const PADDING = 16;

export default function CategoryListScreen() {
  const { category } = useLocalSearchParams<{ category: string }>();
  const nav = useSafeNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { width: SCREEN_WIDTH } = useWindowDimensions();

  const config = category ? CATEGORY_CONFIG[category] : undefined;
  const [page, setPage] = useState(1);
  const [allResults, setAllResults] = useState<any[]>([]);
  const seenIdsRef = useRef<Set<number>>(new Set());

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["category", category, page],
    queryFn: () => config!.fetchFn(page),
    enabled: !!config,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
  });

  // Accumulate results across pages — deduplicated by ID
  React.useEffect(() => {
    if (data?.results) {
      if (page === 1) {
        seenIdsRef.current = new Set(data.results.map((r: any) => r.id));
        setAllResults(data.results);
      } else {
        const fresh = data.results.filter((r: any) => {
          if (seenIdsRef.current.has(r.id)) return false;
          seenIdsRef.current.add(r.id);
          return true;
        });
        if (fresh.length > 0) {
          setAllResults((prev) => [...prev, ...fresh]);
        }
      }
    }
  }, [data, page]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    setAllResults([]);
    seenIdsRef.current = new Set();
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleLoadMore = useCallback(() => {
    if (!isFetching && data && page < (data.total_pages ?? 1)) {
      setPage((p) => p + 1);
    }
  }, [isFetching, data, page]);

  const handleItemPress = useCallback(
    (item: any) => {
      const mediaType =
        item.media_type || (category?.includes("movies") ? "movie" : "tv");
      const dest = mediaType === "tv" ? `/tv/${item.id}` : `/movie/${item.id}`;
      queryClient.prefetchQuery({
        queryKey: [mediaType, item.id],
        queryFn: () =>
          mediaType === "tv"
            ? tmdbApi.getTVDetails(item.id)
            : tmdbApi.getMovieDetails(item.id),
        staleTime: 1000 * 60 * 60,
      });
      router.prefetch(dest);
      nav.push(dest);
    },
    [nav, router, queryClient, category],
  );

  if (!config) {
    return (
      <View
        className="flex-1 items-center justify-center bg-void"
        style={{ backgroundColor: colors.bg, paddingTop: insets.top }}
      >
        <Text className="text-text-secondary text-lg">Category not found</Text>
        <TouchableOpacity
          onPress={() => nav.goBack({ fallback: "/(tabs)" })}
          className="bg-primary rounded-xl py-3 px-8 mt-4"
          activeOpacity={0.8}
        >
          <Text className="text-void font-bold">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const itemWidth =
    (SCREEN_WIDTH - PADDING * 2 - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;

  return (
    <View
      className="flex-1 bg-void"
      style={{ backgroundColor: colors.bg, paddingTop: insets.top }}
    >
      {/* Header */}
      <View className="flex-row items-center px-4 pt-2 pb-3">
        <TouchableOpacity
          onPress={() => nav.goBack({ fallback: "/(tabs)" })}
          activeOpacity={0.7}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: "rgba(8,8,8,0.7)",
            borderRadius: 20,
            paddingHorizontal: 12,
            paddingVertical: 6,
          }}
        >
          <BackIcon width={18} height={18} color={colors.textPrimary} />
          <Text
            style={{
              fontFamily: "Inter_500Medium",
              fontSize: 12,
              color: colors.textPrimary,
              marginLeft: 2,
            }}
          >
            Back
          </Text>
        </TouchableOpacity>
        <Text
          style={{
            fontFamily: "PlayfairDisplay_700Bold",
            fontSize: 20,
            color: colors.textPrimary,
          }}
        >
          {config.title}
        </Text>
      </View>

      {isLoading && page === 1 ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            padding: PADDING,
            gap: GAP,
          }}
        >
          {Array.from({ length: 9 }).map((_, i) => (
            <View key={i} style={{ width: itemWidth }}>
              <View
                style={{
                  width: itemWidth,
                  height: itemWidth * 1.5,
                  borderRadius: 12,
                  backgroundColor: colors.skeletonBg,
                }}
              />
              <View
                style={{
                  width: "80%",
                  height: 10,
                  borderRadius: 4,
                  backgroundColor: colors.skeletonBg,
                  marginTop: 6,
                }}
              />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={allResults}
          keyExtractor={(item) => String(item.id)}
          numColumns={NUM_COLUMNS}
          contentContainerStyle={{ padding: PADDING, paddingBottom: 100 }}
          columnWrapperStyle={{ gap: GAP }}
          showsVerticalScrollIndicator={false}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.gold}
            />
          }
          ListFooterComponent={
            allResults.length > 0 && isFetching ? (
              <View className="self-center mt-6 mb-8 py-1">
                <ActivityIndicator size="small" color={colors.gold} />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={{ width: itemWidth }}>
              <MediaCard
                item={item}
                onPress={handleItemPress}
                variant="default"
              />
            </View>
          )}
        />
      )}
    </View>
  );
}
