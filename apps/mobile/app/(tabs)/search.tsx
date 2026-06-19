import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  ActivityIndicator,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSearch } from '../../hooks/useTMDB';
import { MediaCard } from '../../components/MediaCard';
import { useRouter } from 'expo-router';
import type { Movie } from '@filmsnaps/shared';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const NUM_COLUMNS = 3;
const GAP = 8;
const PADDING = 16;

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const { data, isLoading } = useSearch(query);

  const results = useMemo(
    () =>
      data?.results?.filter(
        (r: Movie) => r.media_type === 'movie' || r.media_type === 'tv',
      ) ?? [],
    [data],
  );

  const handleItemPress = useCallback(
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

  return (
    <View className="flex-1 bg-zinc-950" style={{ paddingTop: insets.top }}>
      {/* Search header */}
      <View className="px-4 pt-4 pb-2">
        <Text className="text-white text-2xl font-bold mb-4">Search</Text>

        {/* Search bar */}
        <View className="flex-row items-center bg-zinc-800 rounded-xl px-4 h-11">
          <Ionicons name="search" size={18} color="#71717a" />
          <TextInput
            className="flex-1 text-white text-base ml-2.5"
            placeholder="Movies, TV shows..."
            placeholderTextColor="#52525b"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} activeOpacity={0.7}>
              <Ionicons name="close-circle" size={18} color="#52525b" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Content */}
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#f59e0b" />
        </View>
      ) : query.length >= 2 ? (
        results.length > 0 ? (
          <FlatList
            data={results}
            keyExtractor={(item: Movie) => String(item.id)}
            numColumns={NUM_COLUMNS}
            contentContainerStyle={{
              padding: PADDING,
              gap: GAP,
            }}
            columnWrapperStyle={{ gap: GAP }}
            renderItem={({ item }) => (
              <View
                style={{
                  width:
                    (SCREEN_WIDTH - PADDING * 2 - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS,
                }}
              >
                <MediaCard item={item} onPress={handleItemPress} />
              </View>
            )}
          />
        ) : (
          <View className="flex-1 items-center justify-center px-8">
            <Ionicons name="search-outline" size={48} color="#27272a" />
            <Text className="text-zinc-500 text-base mt-3">No results found</Text>
            <Text className="text-zinc-600 text-sm mt-1 text-center">
              Try a different search term
            </Text>
          </View>
        )
      ) : (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="search" size={48} color="#27272a" />
          <Text className="text-zinc-500 text-base mt-3">Search movies & TV shows</Text>
          <Text className="text-zinc-600 text-sm mt-1 text-center">
            Type at least 2 characters to search
          </Text>
        </View>
      )}
    </View>
  );
}
