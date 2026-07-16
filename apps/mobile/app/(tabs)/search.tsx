import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { MOVIE_GENRES, TV_GENRES } from '@filmsnaps/shared';
import { useDebounce } from '../../hooks/useDebounce';
import { useSearch, useFilteredMovies, useFilteredTVShows } from '../../hooks/useTMDB';
import { tmdbApi } from '../../lib/api';
import { MediaCard } from '../../components/MediaCard';
import type { Movie } from '@filmsnaps/shared';

const NUM_COLUMNS = 3;
const GAP = 8;
const PADDING = 16;

type MediaTypeFilter = 'all' | 'movie' | 'tv';
type SortOption = 'popularity.desc' | 'vote_average.desc' | 'primary_release_date.desc';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'popularity.desc', label: 'Popular' },
  { value: 'vote_average.desc', label: 'Top Rated' },
  { value: 'primary_release_date.desc', label: 'Latest' },
];

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);

  // Filters
  const [mediaTypeFilter, setMediaTypeFilter] = useState<MediaTypeFilter>('all');
  const [selectedGenreIds, setSelectedGenreIds] = useState<number[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>('popularity.desc');
  const [showSortPicker, setShowSortPicker] = useState(false);
  const [page, setPage] = useState(1);

  // Text search
  const searchResult = useSearch(debouncedQuery);

  // Filtered discover (used when no text query)
  const hasFilters = selectedGenreIds.length > 0 || mediaTypeFilter !== 'all' || query.length < 2;
  const showMovies = mediaTypeFilter === 'all' || mediaTypeFilter === 'movie';
  const showTV = mediaTypeFilter === 'all' || mediaTypeFilter === 'tv';

  const movieFilterResult = useFilteredMovies({
    genreIds: selectedGenreIds.length ? selectedGenreIds : undefined,
    sortBy,
    page,
  });

  const tvFilterResult = useFilteredTVShows({
    genreIds: selectedGenreIds.length ? selectedGenreIds : undefined,
    sortBy,
    page,
  });

  // Derive results
  const textResults = useMemo(
    () => {
      if (!searchResult.data?.results) return [];
      let r = searchResult.data.results.filter(
        (item: any) => item.media_type === 'movie' || item.media_type === 'tv',
      );
      // Client-side filter by media type
      if (mediaTypeFilter !== 'all') {
        r = r.filter((item: any) => item.media_type === mediaTypeFilter);
      }
      // Client-side filter by genre
      if (selectedGenreIds.length > 0) {
        r = r.filter((item: any) =>
          item.genre_ids?.some((gid: number) => selectedGenreIds.includes(gid)),
        );
      }
      return r;
    },
    [searchResult.data, mediaTypeFilter, selectedGenreIds],
  );

  const filteredResults = useMemo(() => {
    if (debouncedQuery.length >= 2) return textResults;
    // No text query â€” use discover API results
    const movieResults = movieFilterResult.data?.results ?? [];
    const tvResults = tvFilterResult.data?.results ?? [];
    if (mediaTypeFilter === 'movie') return movieResults;
    if (mediaTypeFilter === 'tv') return tvResults;
    // Interleave movie + tv
    const max = Math.max(movieResults.length, tvResults.length);
    const merged: any[] = [];
    for (let i = 0; i < max; i++) {
      if (i < movieResults.length) merged.push(movieResults[i]);
      if (i < tvResults.length) merged.push(tvResults[i]);
    }
    return merged;
  }, [debouncedQuery, textResults, movieFilterResult.data, tvFilterResult.data, mediaTypeFilter]);

  const isLoading =
    debouncedQuery.length >= 2
      ? searchResult.isLoading
      : movieFilterResult.isLoading || tvFilterResult.isLoading;

  const toggleGenre = useCallback((genreId: number) => {
    setSelectedGenreIds((prev) =>
      prev.includes(genreId) ? prev.filter((g) => g !== genreId) : [...prev, genreId],
    );
    setPage(1);
  }, []);

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

  const itemWidth = useMemo(
    () => (SCREEN_WIDTH - PADDING * 2 - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS,
    [SCREEN_WIDTH],
  );
  const itemHeight = useMemo(() => itemWidth * 1.5 + 40, [itemWidth]);

  const hasActiveFilters = selectedGenreIds.length > 0 || mediaTypeFilter !== 'all';

  return (
    <View className="flex-1 bg-void" style={{ paddingTop: insets.top, backgroundColor: '#070708' }}>
      {/* Search header */}
      <View className="px-4 pt-4 pb-2">
        <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, color: '#F4F4F5', marginBottom: 16 }}>
          Search
        </Text>

        {/* Search bar â€” pill shaped */}
        <View className="flex-row items-center bg-elevated rounded-[50] px-4 h-11 border-[0.5px] border-subtle">
          <Ionicons name="search" size={18} color="#A1A1AA" />
          <TextInput
            className="flex-1 text-[#F4F4F5] text-base ml-2.5"
            placeholder="Movies, TV shows..."
            placeholderTextColor="#52525B"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} activeOpacity={0.7}>
              <Ionicons name="close-circle" size={18} color="#52525B" />
            </TouchableOpacity>
          )}
        </View>

        {/* Media type toggle */}
        <View className="flex-row mt-3 bg-zinc-900 rounded-lg p-0.5">
          {(['all', 'movie', 'tv'] as const).map((type) => (
            <TouchableOpacity
              key={type}
              onPress={() => { setMediaTypeFilter(type); setPage(1); }}
              className={`flex-1 py-2 rounded-md items-center ${mediaTypeFilter === type ? 'bg-primary' : ''}`}
              activeOpacity={0.7}
            >
              <Text className={`text-xs font-bold ${mediaTypeFilter === type ? 'text-void' : 'text-zinc-400'}`}>
                {type === 'all' ? 'All' : type === 'movie' ? 'Movies' : 'TV'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Genre pills + sort row */}
        <View className="flex-row items-center mt-3">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="flex-1"
            contentContainerStyle={{ gap: 6 }}
          >
            {Object.entries(MOVIE_GENRES).slice(0, 10).map(([id, name]) => (
              <TouchableOpacity
                key={id}
                onPress={() => toggleGenre(Number(id))}
                activeOpacity={0.7}
                className={`px-3 py-1.5 rounded-full border ${
                  selectedGenreIds.includes(Number(id))
                    ? 'border-primary bg-primary/10'
                    : 'border-zinc-700 bg-zinc-800/50'
                }`}
              >
                <Text className={`text-[10px] font-semibold ${
                  selectedGenreIds.includes(Number(id)) ? 'text-primary' : 'text-zinc-300'
                }`}>
                  {name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {/* Sort button */}
          <TouchableOpacity
            onPress={() => setShowSortPicker(!showSortPicker)}
            className="ml-2 w-9 h-9 rounded-full bg-zinc-800 items-center justify-center"
            activeOpacity={0.7}
          >
            <Ionicons name="funnel-outline" size={16} color="#A1A1AA" />
          </TouchableOpacity>
        </View>

        {/* Sort picker dropdown */}
        {showSortPicker && (
          <View className="mt-2 bg-zinc-900 rounded-xl p-1 border border-zinc-700">
            {SORT_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                onPress={() => { setSortBy(opt.value); setShowSortPicker(false); setPage(1); }}
                className={`px-4 py-2.5 rounded-lg ${sortBy === opt.value ? 'bg-primary/20' : ''}`}
                activeOpacity={0.7}
              >
                <Text className={`text-sm ${sortBy === opt.value ? 'text-primary font-bold' : 'text-zinc-300'}`}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Clear filters */}
        {hasActiveFilters && (
          <TouchableOpacity
            onPress={() => { setSelectedGenreIds([]); setMediaTypeFilter('all'); setSortBy('popularity.desc'); setPage(1); }}
            className="self-start mt-2"
            activeOpacity={0.7}
          >
            <Text className="text-primary text-xs font-semibold">Clear filters</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Content */}
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#D4A237" />
        </View>
      ) : (query.length >= 2 || hasActiveFilters) && filteredResults.length > 0 ? (
        <FlatList
          data={filteredResults}
          keyExtractor={(item: Movie) => String(item.id)}
          numColumns={NUM_COLUMNS}
          keyboardShouldPersistTaps="always"
          getItemLayout={(_, index) => ({
            length: itemHeight,
            offset: itemHeight * Math.floor(index / NUM_COLUMNS),
            index,
          })}
          contentContainerStyle={{ padding: PADDING, gap: GAP }}
          columnWrapperStyle={{ gap: GAP }}
          renderItem={({ item }) => (
            <View style={{ width: itemWidth }}>
              <MediaCard item={item} onPress={handleItemPress} />
            </View>
          )}
        />
      ) : query.length >= 2 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="search-outline" size={48} color="#222226" />
          <Text className="text-text-secondary text-base mt-3">No results found</Text>
          <Text className="text-text-tertiary text-sm mt-1 text-center">
            Try a different search term or adjust filters
          </Text>
        </View>
      ) : (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="search" size={48} color="#222226" />
          <Text className="text-text-secondary text-base mt-3">Search movies & TV shows</Text>
          <Text className="text-text-tertiary text-sm mt-1 text-center">
            Type at least 2 characters, or use filters above to discover
          </Text>
        </View>
      )}
    </View>
  );
}
