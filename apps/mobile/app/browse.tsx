import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { MOVIE_GENRES, TV_GENRES } from '@filmsnaps/shared';
import { tmdbApi } from '../lib/api';
import { MediaCard } from '../components/MediaCard';

type MediaType = 'movie' | 'tv';

const NUM_COLUMNS = 3;
const GAP = 8;
const PADDING = 16;

export default function BrowseScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: SCREEN_WIDTH } = useWindowDimensions();

  const [mediaType, setMediaType] = useState<MediaType>('movie');
  const [selectedGenreId, setSelectedGenreId] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const genres = mediaType === 'movie' ? MOVIE_GENRES : TV_GENRES;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [mediaType === 'movie' ? 'movies' : 'tv', 'browse', selectedGenreId, page],
    queryFn: () => {
      const params: any = { page };
      if (selectedGenreId != null) params.genreIds = [selectedGenreId];
      return mediaType === 'movie'
        ? tmdbApi.getMovies(params)
        : tmdbApi.getTVShows(params);
    },
    enabled: selectedGenreId != null,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
  });

  const results = data?.results ?? [];

  const handleGenrePress = useCallback((genreId: number) => {
    setSelectedGenreId((prev) => (prev === genreId ? null : genreId));
    setPage(1);
  }, []);

  const handleLoadMore = useCallback(() => {
    if (!isFetching && results.length > 0) {
      setPage((p) => p + 1);
    }
  }, [isFetching, results.length]);

  const handleItemPress = useCallback(
    (item: any) => {
      const dest = mediaType === 'tv' ? `/tv/${item.id}` : `/movie/${item.id}`;
      router.push(dest);
    },
    [router, mediaType],
  );

  const itemWidth = (SCREEN_WIDTH - PADDING * 2 - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;

  return (
    <View className="flex-1 bg-void" style={{ backgroundColor: '#070708', paddingTop: insets.top }}>
      {/* Header */}
      <View className="flex-row items-center px-4 pt-2 pb-3">
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} accessibilityLabel="Go back" accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(8,8,8,0.7)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, marginRight: 12 }}>
          <Ionicons name="chevron-back" size={18} color="#F4F4F5" />
          <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 12, color: '#F4F4F5', marginLeft: 2 }}>Back</Text>
        </TouchableOpacity>
        <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: '#F4F4F5' }}>
          Browse Genres
        </Text>
      </View>

      {/* Media type toggle */}
      <View className="flex-row mx-4 mb-4 bg-zinc-900 rounded-xl p-1">
        <TouchableOpacity
          onPress={() => { setMediaType('movie'); setSelectedGenreId(null); setPage(1); }}
          className={`flex-1 py-2.5 rounded-lg items-center ${mediaType === 'movie' ? 'bg-primary' : ''}`}
          activeOpacity={0.7}
        >
          <Text className={`text-sm font-bold ${mediaType === 'movie' ? 'text-void' : 'text-zinc-400'}`}>
            Movies
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { setMediaType('tv'); setSelectedGenreId(null); setPage(1); }}
          className={`flex-1 py-2.5 rounded-lg items-center ${mediaType === 'tv' ? 'bg-primary' : ''}`}
          activeOpacity={0.7}
        >
          <Text className={`text-sm font-bold ${mediaType === 'tv' ? 'text-void' : 'text-zinc-400'}`}>
            TV Shows
          </Text>
        </TouchableOpacity>
      </View>

      {/* Genre pills â€” horizontal scroll */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12 }}
      >
        {Object.entries(genres).map(([id, name]) => (
          <TouchableOpacity
            key={id}
            onPress={() => handleGenrePress(Number(id))}
            activeOpacity={0.7}
            className={`px-4 py-2 rounded-full border ${
              selectedGenreId === Number(id)
                ? 'border-primary bg-primary/10'
                : 'border-zinc-700 bg-zinc-800/50'
            }`}
          >
            <Text
              className={`text-xs font-semibold ${
                selectedGenreId === Number(id) ? 'text-primary' : 'text-zinc-300'
              }`}
            >
              {name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Results grid */}
      {selectedGenreId == null ? (
        <View className="flex-1 items-center justify-center px-8">
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#16161A', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <Ionicons name="film-outline" size={28} color="#52525B" />
          </View>
          <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: '#F4F4F5', marginBottom: 8 }}>
            Select a Genre
          </Text>
          <Text className="text-text-tertiary text-sm text-center leading-5">
            Pick a genre above to discover {mediaType === 'movie' ? 'movies' : 'TV shows'}.
          </Text>
        </View>
      ) : isLoading && page === 1 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#D4A237" />
        </View>
      ) : results.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-tertiary text-sm">No results found</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => String(item.id)}
          numColumns={NUM_COLUMNS}
          contentContainerStyle={{ padding: PADDING, paddingBottom: 100 }}
          columnWrapperStyle={{ gap: GAP }}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
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
