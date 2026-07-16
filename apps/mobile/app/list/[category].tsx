import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tmdbApi } from '../../lib/api';
import { MediaCard } from '../../components/MediaCard';

const CATEGORY_CONFIG: Record<string, { title: string; fetchFn: (page: number) => Promise<any> }> = {
  'trending-movies': {
    title: 'Trending Movies',
    fetchFn: (page) => tmdbApi.getTrendingMovies(),
  },
  'trending-tv': {
    title: 'Trending TV',
    fetchFn: (page) => tmdbApi.getTrendingTV(),
  },
  'popular-movies': {
    title: 'Popular Movies',
    fetchFn: (page) => tmdbApi.getPopularMovies(page),
  },
};

const ITEMS_PER_PAGE = 20;
const NUM_COLUMNS = 3;
const GAP = 8;
const PADDING = 16;

export default function CategoryListScreen() {
  const { category } = useLocalSearchParams<{ category: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { width: SCREEN_WIDTH } = useWindowDimensions();

  const config = category ? CATEGORY_CONFIG[category] : undefined;
  const [page, setPage] = useState(1);
  const [allResults, setAllResults] = useState<any[]>([]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['category', category, page],
    queryFn: () => config!.fetchFn(page),
    enabled: !!config,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
  });

  // Accumulate results across pages
  React.useEffect(() => {
    if (data?.results) {
      if (page === 1) {
        setAllResults(data.results);
      } else {
        setAllResults((prev) => [...prev, ...data.results]);
      }
    }
  }, [data, page]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    setAllResults([]);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleLoadMore = useCallback(() => {
    if (!isFetching && data?.results?.length === (page === 1 ? 20 : 20)) {
      setPage((p) => p + 1);
    }
  }, [isFetching, data, page]);

  const handleItemPress = useCallback(
    (item: any) => {
      const mediaType = item.media_type || (category?.includes('movies') ? 'movie' : 'tv');
      const dest = mediaType === 'tv' ? `/tv/${item.id}` : `/movie/${item.id}`;
      queryClient.prefetchQuery({
        queryKey: [mediaType, item.id],
        queryFn: () => (mediaType === 'tv' ? tmdbApi.getTVDetails(item.id) : tmdbApi.getMovieDetails(item.id)),
        staleTime: 1000 * 60 * 60,
      });
      router.prefetch(dest);
      router.push(dest);
    },
    [router, queryClient, category],
  );

  if (!config) {
    return (
      <View className="flex-1 items-center justify-center bg-void" style={{ backgroundColor: '#070708', paddingTop: insets.top }}>
        <Text className="text-text-secondary text-lg">Category not found</Text>
        <TouchableOpacity onPress={() => router.back()} className="bg-primary rounded-xl py-3 px-8 mt-4" activeOpacity={0.8}>
          <Text className="text-void font-bold">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const itemWidth = (SCREEN_WIDTH - PADDING * 2 - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;

  return (
    <View className="flex-1 bg-void" style={{ backgroundColor: '#070708', paddingTop: insets.top }}>
      {/* Header */}
      <View className="flex-row items-center px-4 pt-2 pb-3">
        <TouchableOpacity onPress={() => router.back()} className="w-9 h-9 rounded-full bg-black/40 items-center justify-center mr-3" activeOpacity={0.7} accessibilityLabel="Go back" accessibilityRole="button">
          <Ionicons name="chevron-back" size={22} color="#F4F4F5" />
        </TouchableOpacity>
        <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: '#F4F4F5' }}>
          {config.title}
        </Text>
      </View>

      {isLoading && page === 1 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#D4A237" />
        </View>
      ) : (
        <FlatList
          data={allResults}
          keyExtractor={(item) => String(item.id)}
          numColumns={NUM_COLUMNS}
          contentContainerStyle={{ padding: PADDING, paddingBottom: 100 }}
          columnWrapperStyle={{ gap: GAP }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D4A237" />}
          ListFooterComponent={
            allResults.length > 0 ? (
              <TouchableOpacity
                onPress={handleLoadMore}
                disabled={isFetching}
                activeOpacity={0.7}
                className="self-center mt-6 mb-8 bg-zinc-800 rounded-xl px-8 py-3"
              >
                <Text className="text-zinc-300 text-sm font-semibold">
                  {isFetching ? 'Loading...' : 'Load More'}
                </Text>
              </TouchableOpacity>
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
