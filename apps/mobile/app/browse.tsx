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
    <View className="flex-1 bg-void" style={{ backgroundColor: '#080808', paddingTop: insets.top }}>
      {/* Header */}
      <View className="flex-row items-center px-4 pt-2 pb-3">
        <TouchableOpacity onPress={() => router.back()} className="w-9 h-9 rounded-full bg-black/40 items-center justify-center mr-3" activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color="#f2ede6" />
        </TouchableOpacity>
        <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: '#f2ede6' }}>
          Browse Genres
        </Text>
      </View>

      {/* Media type toggle */}
      <View className="flex-row mx-4 mb-4 bg-zinc-900 rounded-xl p-1">
        <TouchableOpacity
          onPress={() => { setMediaType('movie'); setSelectedGenreId(null); setPage(1); }}
          className={`flex-1 py-2.5 rounded-lg items-center ${mediaType === 'movie' ? 'bg-gold' : ''}`}
          activeOpacity={0.7}
        >
          <Text className={`text-sm font-bold ${mediaType === 'movie' ? 'text-void' : 'text-zinc-400'}`}>
            Movies
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { setMediaType('tv'); setSelectedGenreId(null); setPage(1); }}
          className={`flex-1 py-2.5 rounded-lg items-center ${mediaType === 'tv' ? 'bg-gold' : ''}`}
          activeOpacity={0.7}
        >
          <Text className={`text-sm font-bold ${mediaType === 'tv' ? 'text-void' : 'text-zinc-400'}`}>
            TV Shows
          </Text>
        </TouchableOpacity>
      </View>

      {/* Genre pills — horizontal scroll */}
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
                ? 'border-gold bg-gold/10'
                : 'border-zinc-700 bg-zinc-800/50'
            }`}
          >
            <Text
              className={`text-xs font-semibold ${
                selectedGenreId === Number(id) ? 'text-gold' : 'text-zinc-300'
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
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#191919', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <Ionicons name="film-outline" size={28} color="#534f4c" />
          </View>
          <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: '#f2ede6', marginBottom: 8 }}>
            Select a Genre
          </Text>
          <Text className="text-t3 text-sm text-center leading-5">
            Pick a genre above to discover {mediaType === 'movie' ? 'movies' : 'TV shows'}.
          </Text>
        </View>
      ) : isLoading && page === 1 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#e8a020" />
        </View>
      ) : results.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-t3 text-sm">No results found</Text>
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
