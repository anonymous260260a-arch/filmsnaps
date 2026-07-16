import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { tmdbApi } from '../../lib/api';
import { MediaCard } from '../../components/MediaCard';
import { ProgressiveImage } from '../../components/ProgressiveImage';
import { getAllProgress, getAggregatedHistory, clearAllProgress, clearProgress } from '../../lib/watchHistory';
import { getImageUrl } from '@filmsnaps/shared';
import type { Movie } from '@filmsnaps/shared';
import type { WatchProgress } from '../../lib/watchHistory';

const NUM_COLUMNS = 3;
const GAP = 8;
const PADDING = 16;

export default function HistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { width: SCREEN_WIDTH } = useWindowDimensions();

  const [entries, setEntries] = useState<Array<{
    latest: WatchProgress;
    episodeCount: number;
    fullyWatched: boolean;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [metadata, setMetadata] = useState<Record<string, Movie | null>>({});
  const [displayCount, setDisplayCount] = useState(10);
  const loadedRef = useRef(false);

  const loadHistory = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else if (!loadedRef.current) setLoading(true);
    try {
      const agg = await getAggregatedHistory();
      console.log('[History] Loaded', agg.length, 'aggregated entries');
      console.log('[History] Raw entries:', JSON.stringify(agg.map(e => ({
        tmdbId: e.latest.tmdbId,
        mediaType: e.latest.mediaType,
        percent: e.latest.percent,
        completed: e.latest.completed,
        episodeCount: e.episodeCount,
        updatedAt: new Date(e.latest.updatedAt).toISOString(),
      }))));
      setEntries(agg);

      // Fetch TMDB metadata for each unique ID
      const metaMap: Record<string, Movie | null> = { ...metadata };
      const fetchPromises = agg
        .filter((e) => !metaMap[e.latest.tmdbId])
        .map(async (entry) => {
          try {
            const id = entry.latest.tmdbId;
            if (entry.latest.mediaType === 'tv') {
              const data = await tmdbApi.getTVDetails(Number(id));
              metaMap[id] = data as unknown as Movie;
            } else {
              const data = await tmdbApi.getMovieDetails(Number(id));
              metaMap[id] = data as Movie;
            }
          } catch {
            metaMap[entry.latest.tmdbId] = null;
          }
        });
      await Promise.all(fetchPromises);
      setMetadata({ ...metaMap });
      loadedRef.current = true;
    } catch (e) {
      console.warn('[History] Load failed:', e);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  // Reload whenever the tab gains focus (handles mount + tab switch)
  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory]),
  );

  const itemWidth = useMemo(
    () => (SCREEN_WIDTH - PADDING * 2 - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS,
    [SCREEN_WIDTH],
  );

  const handleItemPress = useCallback(
    (item: WatchProgress) => {
      const id = item.tmdbId;
      if (item.mediaType === 'tv') {
        const season = item.season ?? 1;
        const episode = item.episode ?? 1;
        queryClient.prefetchQuery({
          queryKey: ['tv', id],
          queryFn: () => tmdbApi.getTVDetails(Number(id)),
          staleTime: 1000 * 60 * 60,
        });
        router.prefetch(`/tv/${id}`);
        router.push(`/watch/tv/${id}/${season}/${episode}`);
      } else {
        queryClient.prefetchQuery({
          queryKey: ['movie', id],
          queryFn: () => tmdbApi.getMovieDetails(Number(id)),
          staleTime: 1000 * 60 * 60,
        });
        router.prefetch(`/movie/${id}`);
        router.push(`/watch/movie/${id}`);
      }
    },
    [router, queryClient],
  );

  const formatDate = (ts: number): string => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const progressLabel = (p: WatchProgress): string => {
    if (p.completed) return 'Completed';
    const pct = Math.round(p.percent * 100);
    if (pct < 5) return 'Started';
    return `${pct}%`;
  };

  if (loading) {
    return (
      <View className="flex-1 bg-void items-center justify-center" style={{ backgroundColor: '#070708', paddingTop: insets.top }}>
        <ActivityIndicator size="large" color="#D4A237" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-void" style={{ backgroundColor: '#070708', paddingTop: insets.top }}>
      {/* Header */}
      <View className="px-5 pt-4 pb-2 flex-row items-center justify-between">
        <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, color: '#F4F4F5' }}>
          History
        </Text>
        {entries.length > 0 && (
          <TouchableOpacity
            onPress={() => {
              clearAllProgress().then(() => loadHistory());
            }}
            activeOpacity={0.7}
            className="flex-row items-center"
          >
            <Ionicons name="trash-outline" size={16} color="#ef4444" />
            <Text className="text-red-400 text-xs ml-1.5 font-semibold">Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {entries.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: '#16161A',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20,
            }}
          >
            <Ionicons name="time-outline" size={28} color="#52525B" />
          </View>
          <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: '#F4F4F5', marginBottom: 8 }}>
            No history yet
          </Text>
          <Text className="text-text-tertiary text-sm text-center leading-5">
            Movies and TV shows you watch will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={entries.slice(0, displayCount)}
          keyExtractor={(item) => `${item.latest.mediaType}:${item.latest.tmdbId}`}
          contentContainerStyle={{ padding: PADDING, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { loadHistory(true); }}
              tintColor="#D4A237"
              colors={['#D4A237']}
            />
          }
          ListFooterComponent={
            displayCount < entries.length ? (
              <TouchableOpacity
                onPress={() => setDisplayCount(prev => prev + 10)}
                activeOpacity={0.7}
                className="self-center mt-4 mb-8 bg-zinc-800 rounded-xl px-8 py-3"
              >
                <Text className="text-zinc-300 text-sm font-semibold">Load More</Text>
              </TouchableOpacity>
            ) : entries.length > 0 ? (
              <View className="self-center mt-4 mb-8">
                <Text className="text-text-tertiary text-xs">All caught up â€” {entries.length} items</Text>
              </View>
            ) : null
          }
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => {
            const p = item.latest;
            const meta = metadata[p.tmdbId];
            const title = (p.mediaType === 'tv' ? meta?.name : meta?.title) ?? `ID: ${p.tmdbId}`;
            const poster = meta?.poster_path;
            const pct = p.completed ? 1 : p.percent;
            const label = progressLabel(p);
            const isFullyWatched = item.fullyWatched;

            return (
              <TouchableOpacity
                onPress={() => handleItemPress(p)}
                activeOpacity={0.7}
                className="flex-row bg-elevated rounded-xl overflow-hidden"
                style={{ backgroundColor: '#141414' }}
              >
                {/* Poster */}
                <View style={{ width: 68, height: 102 }}>
                  {poster ? (
                    <ProgressiveImage
                      uri={getImageUrl(poster, 'w185')}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="cover"
                    />
                  ) : (
                    <View className="flex-1 items-center justify-center" style={{ backgroundColor: '#1f1f1f' }}>
                      <Ionicons name={p.mediaType === 'tv' ? 'tv' : 'film'} size={24} color="#3f3f3f" />
                    </View>
                  )}
                </View>

                {/* Info */}
                <View className="flex-1 px-3 py-2.5 justify-center">
                  <Text className="text-text-primary text-sm font-bold leading-tight" numberOfLines={1}>
                    {title}
                  </Text>

                  {/* TV episode subtitle */}
                  {p.mediaType === 'tv' && p.season != null && p.episode != null && (
                    <Text className="text-text-tertiary text-xs mt-0.5">
                      S{p.season}:E{p.episode}
                      {item.episodeCount > 1 && ` +${item.episodeCount - 1} more`}
                    </Text>
                  )}

                  {/* Provider badge intentionally omitted â€” don't reveal server names */}
                  {isFullyWatched ? (
                    <View className="bg-green-900/40 rounded-sm px-1.5 py-0.5 self-start">
                      <Text className="text-green-400 text-[9px] font-bold">COMPLETED</Text>
                    </View>
                  ) : null}

                  {/* Progress bar */}
                  <View className="h-1 rounded-full mt-2 overflow-hidden" style={{ backgroundColor: '#222226' }}>
                    <View
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.round(pct * 100)}%`,
                        backgroundColor: isFullyWatched ? '#22c55e' : '#D4A237',
                      }}
                    />
                  </View>

                  {/* Bottom row: label + date */}
                  <View className="flex-row items-center justify-between mt-1.5">
                    <View className="flex-row items-center gap-1">
                      {isFullyWatched ? (
                        <Ionicons name="checkmark-circle" size={12} color="#22c55e" />
                      ) : p.completed ? (
                        <Ionicons name="checkmark-circle" size={12} color="#D4A237" />
                      ) : (
                        <Ionicons name="play" size={10} color="#D4A237" />
                      )}
                      <Text className={`text-xs font-semibold ${isFullyWatched ? 'text-green-500' : 'text-primary'}`}>
                        {isFullyWatched ? 'Complete' : label}
                      </Text>
                    </View>
                    <Text className="text-text-tertiary text-[10px]">{formatDate(p.updatedAt)}</Text>
                  </View>
                </View>

                {/* Chevron */}
                <View className="justify-center pr-3">
                  <Ionicons name="chevron-forward" size={16} color="#3f3f3f" />
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}
