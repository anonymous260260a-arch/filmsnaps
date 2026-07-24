import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Alert,
  Linking,
  ScrollView,
  Image,
  SafeAreaView,
  StyleSheet,
  Platform,
  FlatList,
  LayoutAnimation,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useDownloadInfra, useDownloadList } from '../../../lib/download';

// ── API Base ──
const FALIX_API_BASE = 'https://download-falix-falixmovies-backend-hf.hf.space';

// ── Types ──
interface FalixTelegramFile {
  quality: string;
  id: string;
  name: string;
  size: string;
}

interface FalixMovieData {
  _id: string;
  tmdb_id: number;
  title: string;
  genres: string[];
  description: string;
  rating: number;
  release_year: number;
  poster: string;
  backdrop: string;
  media_type: 'movie' | 'tv';
  runtime: number;
  updated_on: string;
  languages: string[];
  rip: string;
  telegram: FalixTelegramFile[];
  external_links: any[];
  type: 'movie';
}

interface FalixTVData {
  _id: string;
  tmdb_id: number;
  title: string;
  genres: string[];
  description: string;
  rating: number;
  release_year: number;
  poster: string;
  backdrop: string;
  media_type: 'movie' | 'tv';
  total_seasons: number;
  total_episodes: number;
  status: string;
  updated_on: string;
  languages: string[];
  rip: string;
  seasons: Array<{
    season_number: number;
    episodes: Array<{
      episode_number: number;
      title: string;
      episode_backdrop: string;
      telegram: FalixTelegramFile[];
    }>;
  }>;
  type: 'tv';
}

type FalixData = FalixMovieData | FalixTVData;

// ── Quality order for sorting ──
const QUALITY_ORDER: Record<string, number> = {
  '4k': 1,
  '2160p': 1,
  '1080p': 2,
  '720p': 3,
  '480p': 4,
  '360p': 5,
};

const sortByQuality = (a: FalixTelegramFile, b: FalixTelegramFile) => {
  const aq = QUALITY_ORDER[a.quality.toLowerCase()] ?? 99;
  const bq = QUALITY_ORDER[b.quality.toLowerCase()] ?? 99;
  return aq - bq;
};

export default function FalixDownloadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const rawParams = useLocalSearchParams<{ id: string[] }>();

  const params = useMemo(() => {
    const segs = rawParams.id ?? [];
    return {
      type: segs[0] as 'movie' | 'tv',
      id: segs[1],
      season: segs[2] ? Number(segs[2]) : undefined,
      episode: segs[3] ? Number(segs[3]) : undefined,
    };
  }, [(rawParams.id ?? []).join(',')]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FalixData | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [expandedEpisodes, setExpandedEpisodes] = useState<Record<number, boolean>>({});
  const { enqueue } = useDownloadInfra();
  const { all: downloads } = useDownloadList();

  // ── Fetch data from Falix API ──
  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      if (!params.id) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${FALIX_API_BASE}/api/id/${params.id}`);
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setData(json);
        // Default season for TV
        if (json.type === 'tv' && json.seasons?.length > 0) {
          setSelectedSeason(json.seasons[0].season_number);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [params.id, params.type]);

  // ── Build download URL ──
  const buildDownloadUrl = (fileId: string, fileName: string): string => {
    const encodedName = encodeURIComponent(fileName);
    return `${FALIX_API_BASE}/dl/${fileId}/${encodedName}`;
  };

  // ── Download file via store ──
  const downloadFile = useCallback((fileId: string, fileName: string, quality: string) => {
    const url = buildDownloadUrl(fileId, fileName);
    const filename = `${data?.title || 'video'}-${quality}.${fileName.split('.').pop() || 'mkv'}`;

    enqueue({
      url,
      fileName: filename,
      server: 'falix',
      mediaType: params.type,
      tmdbId: params.id,
      quality,
      title: data?.title,
      season: params.season,
      episode: params.episode,
    });
  }, [params.id, params.type, params.season, params.episode, data, enqueue]);

  // ── Open in external browser ──
  const openInBrowser = (fileId: string, fileName: string) => {
    const url = buildDownloadUrl(fileId, fileName);
    Linking.openURL(url).catch(() => Alert.alert('Could not open URL'));
  };

  // ── Render episode list ──
  const renderEpisode = useCallback(({ item }: { item: any }) => {
    const episodeNum = item.episode_number;
    const isExpanded = expandedEpisodes[episodeNum] ?? false;
    const telegramFiles = item.telegram || [];
    const sortedFiles = [...telegramFiles].sort(sortByQuality);

    return (
      <View key={episodeNum} className="bg-zinc-900/50 rounded-xl border border-zinc-700/50 mb-2 overflow-hidden">
        {/* Episode header */}
        <TouchableOpacity
          onPress={() => {
            LayoutAnimation.easeInEaseOut();
            setExpandedEpisodes(prev => ({ ...prev, [episodeNum]: !isExpanded }));
          }}
          activeOpacity={0.9}
          className="flex-row items-center justify-between p-4"
        >
          <View className="flex-row items-center" style={{ gap: 12 }}>
            {item.episode_backdrop && (
              <Image
                source={{ uri: item.episode_backdrop }}
                style={{ width: 64, height: 36, borderRadius: 6 }}
                resizeMode="cover"
              />
            )}
            <View>
              <Text className="text-white font-semibold text-sm">E{String(episodeNum).padStart(2, '0')}</Text>
              <Text className="text-zinc-400 text-xs mt-0.5" numberOfLines={1}>{item.title}</Text>
            </View>
          </View>
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color="#71717a" />
          </View>
        </TouchableOpacity>

        {/* Expanded download options */}
        {isExpanded && sortedFiles.length > 0 && (
          <View className="px-4 pb-4 border-t border-zinc-700/30">
            {sortedFiles.map((file, i) => {
              const filename = `${data?.title || 'video'}-${file.quality}.${file.name.split('.').pop() || 'mkv'}`;
              const storeTask = downloads.find((t) => t.title === data?.title && t.quality === file.quality && t.server === 'falix');
              const isDownloading = storeTask?.status === 'downloading' || storeTask?.status === 'pending';
              const progress = storeTask?.totalBytes ? storeTask.receivedBytes / storeTask.totalBytes : 0;

              return (
                <TouchableOpacity
                  key={i}
                  onPress={() => !isDownloading && downloadFile(file.id, file.name, file.quality)}
                  disabled={isDownloading}
                  activeOpacity={0.7}
                  className="flex-row items-center justify-between py-2 px-3 rounded-lg mb-1.5 bg-zinc-800/50"
                >
                  <View className="flex-row items-center" style={{ gap: 10 }}>
                    <View className="bg-primary/20 px-2 py-1 rounded-full">
                      <Text className="text-primary text-[10px] font-bold">{file.quality.toUpperCase()}</Text>
                    </View>
                    <View>
                      <Text className="text-zinc-300 text-xs font-medium" numberOfLines={1}>{file.name}</Text>
                      <Text className="text-zinc-500 text-[10px] mt-0.5">{file.size}</Text>
                    </View>
                  </View>
                  <View className="flex-row items-center" style={{ gap: 6 }}>
                    {isDownloading && progress > 0 && (
                      <View style={{ width: 60, height: 4 }}>
                        <View
                          style={{
                            width: `${progress * 100}%`,
                            height: '100%',
                            backgroundColor: '#D4A237',
                            borderRadius: 2,
                          }}
                        />
                      </View>
                    )}
                    {isDownloading ? (
                      <ActivityIndicator size="small" color="#D4A237" />
                    ) : (
                      <View className="flex-row" style={{ gap: 6 }}>
                        <TouchableOpacity
                          onPress={() => openInBrowser(file.id, file.name)}
                          className="w-8 h-8 rounded-full bg-zinc-700 items-center justify-center"
                          activeOpacity={0.7}
                        >
                          <Ionicons name="open-outline" size={14} color="#a1a1aa" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => downloadFile(file.id, file.name, file.quality)}
                          className="w-8 h-8 rounded-full bg-primary items-center justify-center"
                          activeOpacity={0.7}
                        >
                          <Ionicons name="download" size={14} color="#000" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>
    );
  }, [expandedEpisodes, downloadFile, downloads, data]);

  // ── Render season tabs ──
  const renderSeasonTabs = useCallback(() => {
    if (!data || data.type !== 'tv') return null;
    const seasons = data.seasons || [];

    return (
      <View className="mb-4">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          {seasons.map((s) => (
            <TouchableOpacity
              key={s.season_number}
              onPress={() => {
                setSelectedSeason(s.season_number);
                // Auto-expand first episode of new season
                if (s.episodes?.length > 0) {
                  LayoutAnimation.easeInEaseOut();
                  setExpandedEpisodes(prev => ({ ...prev, [s.episodes[0].episode_number]: true }));
                }
              }}
              activeOpacity={0.7}
              className={`px-4 py-2 rounded-full ${
                selectedSeason === s.season_number
                  ? 'bg-primary border border-amber-500/30'
                  : 'bg-zinc-800 border border-zinc-700/50'
              }`}
            >
              <Text className={`font-bold ${
                selectedSeason === s.season_number ? 'text-black' : 'text-zinc-300'
              }`}>
                Season {s.season_number}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }, [data, selectedSeason]);

  // ── Get current season episodes ──
  const currentEpisodes = useMemo(() => {
    if (!data || data.type !== 'tv') return [];
    const season = data.seasons?.find(s => s.season_number === selectedSeason);
    return season?.episodes || [];
  }, [data, selectedSeason]);

  // ── Loading / Error / Empty ──
  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-black">
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color="#D4A237" />
        <Text className="text-zinc-400 text-sm mt-4">Loading download info...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-black px-6">
        <StatusBar barStyle="light-content" />
        <View className="w-16 h-16 rounded-full bg-red-500/10 items-center justify-center mb-5">
          <Ionicons name="alert-circle-outline" size={36} color="#ef4444" />
        </View>
        <Text className="text-zinc-300 text-lg font-semibold mb-2">Failed to Load</Text>
        <Text className="text-zinc-500 text-sm text-center mb-6 leading-5">{error}</Text>
        <TouchableOpacity onPress={() => router.back()} className="bg-primary rounded-xl py-3 px-8" activeOpacity={0.8}>
          <Text className="text-void font-bold text-base">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!data) {
    return (
      <View className="flex-1 items-center justify-center bg-black">
        <StatusBar barStyle="light-content" />
        <Text className="text-zinc-500">No data available</Text>
      </View>
    );
  }

  const isTV = data.type === 'tv';

  return (
    <SafeAreaView className="flex-1 bg-black" style={{ backgroundColor: '#000' }}>
      <StatusBar barStyle="light-content" />

      {/* Backdrop */}
      {data.backdrop && (
        <Image
          source={{ uri: data.backdrop }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          blurRadius={Platform.OS === 'android' ? 10 : 20}
        />
      )}

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        {/* Header */}
        <View className="px-4 pt-6 pb-4">
          <TouchableOpacity onPress={() => router.back()} className="w-9 h-9 rounded-full bg-black/40 items-center justify-center mb-3" activeOpacity={0.7} accessibilityLabel="Close" accessibilityRole="button">
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
          <View className="flex-row items-start" style={{ gap: 14 }}>
            <Image
              source={{ uri: data.poster }}
              style={{ width: 110, height: 165, borderRadius: 12, borderWidth: 1, borderColor: '#27272a' }}
              resizeMode="cover"
            />
            <View className="flex-1 pt-2">
              <Text className="text-white font-bold text-xl" style={{ fontFamily: 'PlayfairDisplay_700Bold' }} numberOfLines={2}>{data.title}</Text>
              <View className="flex-row items-center mt-2" style={{ gap: 10 }}>
                <View className="flex-row items-center bg-zinc-800/50 px-2 py-1 rounded-full">
                  <Ionicons name="star" size={12} color="#D4A237" />
                  <Text className="text-amber-400 text-xs font-bold ml-1">{data.rating?.toFixed(1) || '—'}</Text>
                </View>
                <Text className="text-zinc-500 text-xs">{data.release_year}</Text>
                <Text className="text-zinc-600 text-xs">•</Text>
                <Text className="text-zinc-500 text-xs">{data.rip}</Text>
                {'runtime' in data && data.runtime && (
                  <>
                    <Text className="text-zinc-600 text-xs">•</Text>
                    <Text className="text-zinc-500 text-xs">{data.runtime}m</Text>
                  </>
                )}
              </View>
              <View className="flex-row flex-wrap mt-3" style={{ gap: 6 }}>
                {data.genres?.slice(0, 4).map((g, i) => (
                  <View key={i} className="bg-zinc-800/50 border border-zinc-700/50 px-2.5 py-1 rounded-full">
                    <Text className="text-zinc-300 text-[10px] font-semibold">{g}</Text>
                  </View>
                ))}
              </View>
              {!isTV && data.telegram && (
                <View className="flex-row mt-3" style={{ gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => downloadFile(data.telegram[0]?.id || '', data.telegram[0]?.name || '', 'best')}
                    disabled={!data.telegram?.length}
                    className="bg-primary rounded-xl py-2 px-5 flex-row items-center"
                    activeOpacity={0.8}
                  >
                    <Ionicons name="download" size={16} color="#000" />
                    <Text className="text-void font-bold text-sm ml-2">Best Quality</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Description */}
        {data.description && (
          <View className="px-4 mb-4">
            <Text className="text-white font-bold text-sm mb-2" style={{ fontFamily: 'PlayfairDisplay_700Bold' }}>About</Text>
            <Text className="text-zinc-400 text-sm leading-relaxed">{data.description}</Text>
          </View>
        )}

        {/* TV: Season tabs + Episodes */}
        {isTV && (
          <View className="px-4 mb-4">
            {renderSeasonTabs()}
            <Text className="text-white font-bold text-sm mb-3" style={{ fontFamily: 'PlayfairDisplay_700Bold' }}>
              Season {selectedSeason} Episodes
            </Text>
            <FlatList
              data={currentEpisodes}
              renderItem={renderEpisode}
              keyExtractor={(item) => String(item.episode_number)}
              ListEmptyComponent={
                <View className="items-center py-8">
                  <Ionicons name="tv-outline" size={24} color="#52525b" />
                  <Text className="text-zinc-500 text-xs mt-2">No episodes found</Text>
                </View>
              }
            />
          </View>
        )}

        {/* Movie: Direct downloads */}
        {!isTV && data.telegram && data.telegram.length > 0 && (
          <View className="px-4 mb-6">
            <Text className="text-white font-bold text-sm mb-3" style={{ fontFamily: 'PlayfairDisplay_700Bold' }}>Download Options</Text>
            {([...data.telegram].sort(sortByQuality)).map((file, i) => {
              const storeTask = downloads.find((t) => t.title === data?.title && t.quality === file.quality && t.server === 'falix');
              const isDownloading = storeTask?.status === 'downloading' || storeTask?.status === 'pending';
              const progress = storeTask?.totalBytes ? storeTask.receivedBytes / storeTask.totalBytes : 0;

              return (
                <TouchableOpacity
                  key={i}
                  onPress={() => !isDownloading && downloadFile(file.id, file.name, file.quality)}
                  disabled={isDownloading}
                  activeOpacity={0.7}
                  className="flex-row items-center justify-between py-3 px-4 rounded-xl mb-2 bg-zinc-900/50 border border-zinc-700/50"
                >
                  <View className="flex-row items-center" style={{ gap: 12 }}>
                    <View className="bg-primary/20 px-3 py-1.5 rounded-full">
                      <Text className="text-primary text-xs font-bold">{file.quality.toUpperCase()}</Text>
                    </View>
                    <View>
                      <Text className="text-zinc-300 text-sm font-medium" numberOfLines={1}>{file.name}</Text>
                      <Text className="text-zinc-500 text-xs mt-0.5">{file.size}</Text>
                    </View>
                  </View>
                  <View className="flex-row items-center" style={{ gap: 8 }}>
                    {isDownloading && progress > 0 && (
                      <View style={{ width: 60, height: 4 }}>
                        <View
                          style={{
                            width: `${progress * 100}%`,
                            height: '100%',
                            backgroundColor: '#D4A237',
                            borderRadius: 2,
                          }}
                        />
                      </View>
                    )}
                    {isDownloading ? (
                      <ActivityIndicator size="small" color="#D4A237" />
                    ) : (
                      <View className="flex-row" style={{ gap: 6 }}>
                        <TouchableOpacity
                          onPress={() => openInBrowser(file.id, file.name)}
                          className="w-9 h-9 rounded-full bg-zinc-700 items-center justify-center"
                          activeOpacity={0.7}
                        >
                          <Ionicons name="open-outline" size={16} color="#a1a1aa" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => downloadFile(file.id, file.name, file.quality)}
                          className="w-9 h-9 rounded-full bg-primary items-center justify-center"
                          activeOpacity={0.7}
                        >
                          <Ionicons name="download" size={16} color="#000" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Bottom floating action for TV */}
      {isTV && (
        <View className="absolute bottom-0 left-0 right-0 z-30 px-4 pb-4" style={{ paddingBottom: insets.bottom + 16 }}>
          <View className="bg-zinc-900/90 rounded-xl border border-zinc-700/50 p-3">
            <Text className="text-zinc-400 text-xs font-bold mb-2 text-center">
              Tap a season above, then tap an episode to expand download options
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}