import React, { useCallback, useRef } from 'react';
import { View, ScrollView, RefreshControl, Text, ActivityIndicator, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Hero } from '../../components/Hero';
import { MediaCarousel } from '../../components/MediaCarousel';
import { useTrendingMovies, useTrendingTV, usePopularMovies } from '../../hooks/useTMDB';
import { tmdbApi } from '../../lib/api';
import type { Movie } from '@filmsnaps/shared';

const SKELETON_ITEMS = 3;

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const refreshing = useRef(false);

  const {
    data: trendingMovies,
    refetch: refetchMovies,
    isLoading: loadingMovies,
    isFetching: fetchingMovies,
  } = useTrendingMovies();
  const {
    data: trendingTV,
    refetch: refetchTV,
    isLoading: loadingTV,
    isFetching: fetchingTV,
  } = useTrendingTV();
  const {
    data: popularMovies,
    refetch: refetchPopular,
    isLoading: loadingPopular,
    isFetching: fetchingPopular,
  } = usePopularMovies();

  const heroItem = trendingMovies?.results?.[0];

  // ── Skeleton card dimensions (matches MediaCarousel) ──
  const itemWidth = (SCREEN_WIDTH - 48) / 3;
  const itemHeight = itemWidth * 1.5;

  // ── Pull-to-refresh ──
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  const onRefresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    setIsRefreshing(true);
    // Fire all refetches independently — sections pop in as they arrive
    refetchMovies();
    refetchTV();
    refetchPopular();
    // Wait a bit then hide the indicator (content updates progressively)
    setTimeout(() => {
      setIsRefreshing(false);
      refreshing.current = false;
    }, 1500);
  }, [refetchMovies, refetchTV, refetchPopular]);

  // ── Navigation ──

  const handleMoviePress = useCallback(
    (item: Movie) => {
      const mediaType = item.media_type || 'movie';
      const id = item.id;

      if (mediaType === 'tv') {
        queryClient.prefetchQuery({
          queryKey: ['tv', id],
          queryFn: () => tmdbApi.getTVDetails(id),
          staleTime: 1000 * 60 * 60,
        });
        router.prefetch(`/tv/${id}`);
        router.push(`/tv/${id}`);
      } else {
        queryClient.prefetchQuery({
          queryKey: ['movie', id],
          queryFn: () => tmdbApi.getMovieDetails(id),
          staleTime: 1000 * 60 * 60,
        });
        router.prefetch(`/movie/${id}`);
        router.push(`/movie/${id}`);
      }
    },
    [router, queryClient],
  );

  const handleWatchPress = useCallback(
    (item: Movie) => {
      router.push(`/watch/movie/${item.id}`);
    },
    [router],
  );

  if (loadingMovies && loadingTV && loadingPopular) {
    return (
      <View className="flex-1 bg-void" style={{ paddingTop: insets.top }}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#e8a020" />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-void" style={{ paddingTop: insets.top }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#e8a020"
            colors={['#e8a020']}
          />
        }
        className="flex-1"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="px-5 py-4 flex-row items-center justify-between">
          <View className="flex-row items-center">
            <View className="w-9 h-9 rounded-full bg-gold items-center justify-center mr-3">
              <Ionicons name="film" size={18} color="#000" />
            </View>
            <View>
              <Text className="text-t1 text-xl font-bold tracking-tight">FilmSnaps</Text>
              <Text className="text-t2 text-xs">Discover & Watch</Text>
            </View>
          </View>
        </View>

        {/* Hero section — appears as soon as trendingMovies arrives */}
        {heroItem ? (
          <Hero item={heroItem} onWatchPress={handleWatchPress} />
        ) : !loadingMovies ? (
          <View className="w-full bg-elevated" style={{ height: SCREEN_WIDTH * 0.62 }} />
        ) : null}

        {/* Trending Movies — skeleton until data loads */}
        {trendingMovies ? (
          <MediaCarousel
            title="Trending Movies"
            data={trendingMovies.results ?? []}
            onItemPress={handleMoviePress}
          />
        ) : (
          <View className="mb-6 px-4">
            <View className="w-36 h-5 bg-subtle rounded mb-3" />
            <View className="flex-row" style={{ gap: 10 }}>
              {Array.from({ length: SKELETON_ITEMS }).map((_, i) => (
                <View
                  key={i}
                  className="bg-subtle rounded-xl"
                  style={{ width: itemWidth, height: itemHeight }}
                />
              ))}
            </View>
          </View>
        )}

        {/* Trending TV */}
        {trendingTV ? (
          <MediaCarousel
            title="Trending TV"
            data={trendingTV.results ?? []}
            onItemPress={handleMoviePress}
          />
        ) : (
          <View className="mb-6 px-4">
            <View className="w-36 h-5 bg-subtle rounded mb-3" />
            <View className="flex-row" style={{ gap: 10 }}>
              {Array.from({ length: SKELETON_ITEMS }).map((_, i) => (
                <View
                  key={i}
                  className="bg-subtle rounded-xl"
                  style={{ width: itemWidth, height: itemHeight }}
                />
              ))}
            </View>
          </View>
        )}

        {/* Popular Movies */}
        {popularMovies ? (
          <MediaCarousel
            title="Popular Movies"
            data={popularMovies.results ?? []}
            onItemPress={handleMoviePress}
          />
        ) : (
          <View className="mb-6 px-4">
            <View className="w-36 h-5 bg-subtle rounded mb-3" />
            <View className="flex-row" style={{ gap: 10 }}>
              {Array.from({ length: SKELETON_ITEMS }).map((_, i) => (
                <View
                  key={i}
                  className="bg-subtle rounded-xl"
                  style={{ width: itemWidth, height: itemHeight }}
                />
              ))}
            </View>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}
