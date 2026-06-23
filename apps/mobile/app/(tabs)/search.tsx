import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useDebounce } from '../../hooks/useDebounce';
import { useSearch } from '../../hooks/useTMDB';
import { tmdbApi } from '../../lib/api';
import { MediaCard } from '../../components/MediaCard';
import type { Movie } from '@filmsnaps/shared';

const NUM_COLUMNS = 3;
const GAP = 8;
const PADDING = 16;

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const { data, isLoading } = useSearch(debouncedQuery);

  const results = useMemo(
    () =>
      data?.results?.filter(
        (r: Movie) => r.media_type === 'movie' || r.media_type === 'tv',
      ) ?? [],
    [data],
  );

  const itemWidth = useMemo(
    () => (SCREEN_WIDTH - PADDING * 2 - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS,
    [SCREEN_WIDTH],
  );
  const itemHeight = useMemo(() => itemWidth * 1.5 + 40, [itemWidth]);

  const handleItemPress = useCallback(
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

  return (
    <View className="flex-1 bg-void" style={{ paddingTop: insets.top }}>
      {/* Search header */}
      <View className="px-4 pt-4 pb-2">
        <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, color: '#f2ede6', marginBottom: 16 }}>
          Search
        </Text>

        {/* Search bar — pill shaped */}
        <View className="flex-row items-center bg-elevated rounded-[50] px-4 h-11 border-[0.5px] border-subtle">
          <Ionicons name="search" size={18} color="#9b9590" />
          <TextInput
            className="flex-1 text-[#f2ede6] text-base ml-2.5"
            placeholder="Movies, TV shows..."
            placeholderTextColor="#534f4c"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} activeOpacity={0.7}>
              <Ionicons name="close-circle" size={18} color="#534f4c" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Content */}
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#e8a020" />
        </View>
      ) : query.length >= 2 ? (
        results.length > 0 ? (
          <FlatList
            data={results}
            keyExtractor={(item: Movie) => String(item.id)}
            numColumns={NUM_COLUMNS}
            getItemLayout={(_, index) => ({
              length: itemHeight,
              offset: itemHeight * Math.floor(index / NUM_COLUMNS),
              index,
            })}
            contentContainerStyle={{
              padding: PADDING,
              gap: GAP,
            }}
            columnWrapperStyle={{ gap: GAP }}
            renderItem={({ item }) => (
              <View style={{ width: itemWidth }}>
                <MediaCard item={item} onPress={handleItemPress} />
              </View>
            )}
          />
        ) : (
          <View className="flex-1 items-center justify-center px-8">
            <Ionicons name="search-outline" size={48} color="#252525" />
            <Text className="text-t2 text-base mt-3">No results found</Text>
            <Text className="text-t3 text-sm mt-1 text-center">
              Try a different search term
            </Text>
          </View>
        )
      ) : (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="search" size={48} color="#252525" />
          <Text className="text-t2 text-base mt-3">Search movies & TV shows</Text>
          <Text className="text-t3 text-sm mt-1 text-center">
            Type at least 2 characters to search
          </Text>
        </View>
      )}
    </View>
  );
}
