import React, { useCallback } from 'react';
import { View, ScrollView, RefreshControl, Text, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Hero } from '../../components/Hero';
import { MediaCarousel } from '../../components/MediaCarousel';
import { useTrendingMovies, useTrendingTV, usePopularMovies } from '../../hooks/useTMDB';
import type { Movie } from '@filmsnaps/shared';

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    data: trendingMovies,
    refetch: refetchMovies,
    isLoading: loadingMovies,
  } = useTrendingMovies();
  const { data: trendingTV, refetch: refetchTV, isLoading: loadingTV } = useTrendingTV();
  const {
    data: popularMovies,
    refetch: refetchPopular,
    isLoading: loadingPopular,
  } = usePopularMovies();
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchMovies(), refetchTV(), refetchPopular()]);
    setRefreshing(false);
  }, [refetchMovies, refetchTV, refetchPopular]);

  const handleMoviePress = useCallback(
    (item: Movie) => {
      const mediaType = item.media_type || 'movie';
      if (mediaType === 'tv') {
        router.push(`/tv/${item.id}`);
      } else {
        router.push(`/movie/${item.id}`);
      }
    },
    [router],
  );

  const handleWatchPress = useCallback(
    (item: Movie) => {
      router.push(`/watch/movie/${item.id}`);
    },
    [router],
  );

  const heroItem = trendingMovies?.results?.[0];

  const isLoading = loadingMovies && loadingTV && loadingPopular;

  return (
    <View className="flex-1 bg-zinc-950" style={{ paddingTop: insets.top }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#f59e0b"
            colors={['#f59e0b']}
          />
        }
        className="flex-1"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="px-5 py-4 flex-row items-center justify-between">
          <View className="flex-row items-center">
            <View className="w-9 h-9 rounded-full bg-amber-500 items-center justify-center mr-3">
              <Ionicons name="film" size={18} color="#000" />
            </View>
            <View>
              <Text className="text-white text-xl font-bold tracking-tight">FilmSnaps</Text>
              <Text className="text-zinc-500 text-xs">Discover & Watch</Text>
            </View>
          </View>
        </View>

        {/* Loading state */}
        {isLoading ? (
          <View className="flex-1 items-center justify-center py-20">
            <ActivityIndicator size="large" color="#f59e0b" />
          </View>
        ) : (
          <>
            {/* Hero */}
            {heroItem && (
              <Hero item={heroItem} onWatchPress={handleWatchPress} />
            )}

            {/* Trending Movies */}
            <MediaCarousel
              title="Trending Movies"
              data={trendingMovies?.results ?? []}
              onItemPress={handleMoviePress}
            />

            {/* Trending TV */}
            <MediaCarousel
              title="Trending TV"
              data={trendingTV?.results ?? []}
              onItemPress={handleMoviePress}
            />

            {/* Popular Movies */}
            <MediaCarousel
              title="Popular Movies"
              data={popularMovies?.results ?? []}
              onItemPress={handleMoviePress}
            />
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}
