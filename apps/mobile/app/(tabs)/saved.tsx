import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useFocusEffect } from 'expo-router';
import { tmdbApi } from '../../lib/api';
import { MediaCard } from '../../components/MediaCard';
import { getAllBookmarks, clearAllBookmarks } from '../../lib/bookmarks';
import type { Bookmark } from '../../lib/bookmarks';

const NUM_COLUMNS = 3;
const GAP = 8;
const PADDING = 16;

export default function SavedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const queryClient = useQueryClient();

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);

  const loadBookmarks = useCallback(async () => {
    try {
      const items = await getAllBookmarks();
      setBookmarks(items);
    } catch {
      // Silently fail
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadBookmarks();
    }, [loadBookmarks]),
  );

  const handleItemPress = useCallback(
    (item: Bookmark) => {
      const id = item.tmdbId;
      if (item.mediaType === 'tv') {
        queryClient.prefetchQuery({
          queryKey: ['tv', id],
          queryFn: () => tmdbApi.getTVDetails(Number(id)),
          staleTime: 1000 * 60 * 60,
        });
        router.prefetch(`/tv/${id}`);
        router.push(`/tv/${id}`);
      } else {
        queryClient.prefetchQuery({
          queryKey: ['movie', id],
          queryFn: () => tmdbApi.getMovieDetails(Number(id)),
          staleTime: 1000 * 60 * 60,
        });
        router.prefetch(`/movie/${id}`);
        router.push(`/movie/${id}`);
      }
    },
    [router, queryClient],
  );

  const handleClearAll = useCallback(async () => {
    await clearAllBookmarks();
    setBookmarks([]);
  }, []);

  const itemWidth = useMemo(
    () => (SCREEN_WIDTH - PADDING * 2 - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS,
    [SCREEN_WIDTH],
  );

  if (loading) {
    return (
      <View className="flex-1 bg-void items-center justify-center" style={{ backgroundColor: '#080808', paddingTop: insets.top }}>
        <ActivityIndicator size="large" color="#e8a020" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-void" style={{ backgroundColor: '#080808', paddingTop: insets.top }}>
      {/* Header */}
      <View className="px-5 pt-4 pb-2 flex-row items-center justify-between">
        <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, color: '#f2ede6' }}>
          Saved
        </Text>
        {bookmarks.length > 0 && (
          <TouchableOpacity onPress={handleClearAll} activeOpacity={0.7} className="flex-row items-center">
            <Ionicons name="trash-outline" size={16} color="#ef4444" />
            <Text className="text-red-400 text-xs ml-1.5 font-semibold">Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {bookmarks.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#191919', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <Ionicons name="bookmark-outline" size={28} color="#534f4c" />
          </View>
          <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: '#f2ede6', marginBottom: 8 }}>
            Nothing saved yet
          </Text>
          <Text className="text-t3 text-sm text-center leading-5">
            Films you save will show up here for quick access.
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/')}
            className="bg-gold rounded-xl py-3 px-8 mt-6"
            activeOpacity={0.8}
          >
            <Text className="text-void font-bold text-sm">Discover Films</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={bookmarks}
          keyExtractor={(item) => item.tmdbId}
          numColumns={NUM_COLUMNS}
          contentContainerStyle={{ padding: PADDING, gap: GAP }}
          columnWrapperStyle={{ gap: GAP }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={{ width: itemWidth }}>
              <MediaCard
                item={{
                  id: Number(item.tmdbId),
                  title: item.mediaType === 'tv' ? undefined : item.title,
                  name: item.mediaType === 'tv' ? item.title : undefined,
                  poster_path: item.posterPath ?? undefined,
                  media_type: item.mediaType,
                } as any}
                onPress={() => handleItemPress(item)}
                variant="default"
              />
            </View>
          )}
        />
      )}
    </View>
  );
}
