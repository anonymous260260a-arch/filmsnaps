import React from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getImageUrl, getTrailerKey } from '@filmsnaps/shared';
import { useTVDetails } from '../../hooks/useTMDB';
import { MediaCarousel } from '../../components/MediaCarousel';
import type { Movie } from '@filmsnaps/shared';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BACKDROP_HEIGHT = SCREEN_WIDTH * 0.56;

export default function TVDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, isLoading } = useTVDetails(id!);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-950">
        <ActivityIndicator size="large" color="#f59e0b" />
      </View>
    );
  }

  const show = data;
  if (!show) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-950">
        <Ionicons name="tv-outline" size={48} color="#52525b" />
        <Text className="text-zinc-400 mt-3">Show not found</Text>
      </View>
    );
  }

  const title = show.name || '';
  const year = show.first_air_date?.split('-')[0] ?? '';
  const genres = show.genres ?? [];
  const trailerKey = getTrailerKey(show.videos);
  const cast = show.credits?.cast?.slice(0, 10) ?? [];
  const seasonCount = show.seasons?.filter((s: any) => s.season_number > 0).length ?? 0;

  return (
    <View className="flex-1 bg-zinc-950">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Backdrop */}
        <View style={{ width: SCREEN_WIDTH, height: BACKDROP_HEIGHT }}>
          {show.backdrop_path ? (
            <Image
              source={{ uri: getImageUrl(show.backdrop_path, 'w1280') }}
              style={{ width: SCREEN_WIDTH, height: BACKDROP_HEIGHT }}
              resizeMode="cover"
            />
          ) : (
            <View className="w-full h-full bg-zinc-900" />
          )}
          <View
            className="absolute bottom-0 left-0 right-0"
            style={{ height: 80, backgroundColor: 'rgba(9,9,11,0.85)' }}
          />
        </View>

        {/* Back button */}
        <View className="absolute top-0 left-0 right-0" style={{ paddingTop: insets.top }}>
          <TouchableOpacity
            onPress={() => router.back()}
            className="ml-3 w-10 h-10 rounded-full bg-black/50 items-center justify-center"
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View className="px-4 -mt-20">
          {/* Poster + Info row */}
          <View className="flex-row">
            {show.poster_path ? (
              <Image
                source={{ uri: getImageUrl(show.poster_path, 'w342') }}
                className="w-28 h-40 rounded-xl"
                resizeMode="cover"
                style={{
                  ...Platform.select({
                    ios: {
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 8 },
                      shadowOpacity: 0.4,
                      shadowRadius: 12,
                    },
                    android: { elevation: 10 },
                  }),
                }}
              />
            ) : (
              <View className="w-28 h-40 rounded-xl bg-zinc-800 items-center justify-center">
                <Ionicons name="tv-outline" size={32} color="#52525b" />
              </View>
            )}

            <View className="flex-1 ml-3 justify-end pb-1">
              <Text className="text-white text-xl font-bold leading-6">{title}</Text>
              {year ? (
                <Text className="text-zinc-400 text-sm mt-0.5">{year}</Text>
              ) : null}

              {/* Genre badges */}
              {genres.length > 0 && (
                <View className="flex-row flex-wrap mt-2" style={{ gap: 4 }}>
                  {genres.slice(0, 3).map((g: { id: number; name: string }) => (
                    <View key={g.id} className="bg-zinc-800 rounded-full px-2 py-0.5">
                      <Text className="text-zinc-400 text-[10px]">{g.name}</Text>
                    </View>
                  ))}
                </View>
              )}

              {show.vote_average != null && (
                <View className="flex-row items-center mt-2">
                  <View className="bg-amber-500/20 rounded-full px-2 py-0.5 flex-row items-center">
                    <Text className="text-amber-400 text-sm">★</Text>
                    <Text className="text-amber-400 text-sm font-bold ml-1">
                      {show.vote_average.toFixed(1)}
                    </Text>
                  </View>
                  {seasonCount > 0 && (
                    <View className="flex-row items-center ml-3">
                      <Ionicons name="layers-outline" size={14} color="#71717a" />
                      <Text className="text-zinc-500 text-sm ml-1">
                        {seasonCount} {seasonCount === 1 ? 'Season' : 'Seasons'}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>

          {/* Overview */}
          {show.overview ? (
            <View className="mt-5">
              <Text className="text-white text-base font-bold mb-2">Overview</Text>
              <Text className="text-zinc-400 text-sm leading-6">{show.overview}</Text>
            </View>
          ) : null}

          {/* Action buttons */}
          <View className="flex-row mt-6" style={{ gap: 10 }}>
            <TouchableOpacity
              onPress={() => router.push(`/watch/tv/${id}/1/1`)}
              className="flex-1 bg-amber-500 rounded-xl py-3.5 flex-row items-center justify-center"
              activeOpacity={0.9}
              style={{
                ...Platform.select({
                  ios: {
                    shadowColor: '#f59e0b',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.3,
                    shadowRadius: 8,
                  },
                  android: { elevation: 6 },
                }),
              }}
            >
              <Ionicons name="play" size={18} color="#000" />
              <Text className="text-black font-bold text-base ml-2">Watch Now</Text>
            </TouchableOpacity>

            {/* Download 1 (VidVault) — visible in dev only */}
            {__DEV__ && (
              <TouchableOpacity
                onPress={() => router.push(`/download/tv/${id}/1/1`)}
                className="bg-zinc-800 rounded-xl py-3.5 px-4 flex-row items-center justify-center"
                activeOpacity={0.8}
              >
                <Ionicons name="download-outline" size={18} color="#f59e0b" />
                <Text className="text-amber-400 font-bold text-sm ml-1.5">Download</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={() => router.push(`/download2/tv/${id}/1/1`)}
              className="bg-zinc-800 rounded-xl py-3.5 px-4 flex-row items-center justify-center"
              activeOpacity={0.8}
            >
              <Ionicons name="cloud-download-outline" size={18} color="#60a5fa" />
              <Text className="text-blue-400 font-bold text-sm ml-1.5">Download 2</Text>
            </TouchableOpacity>
          </View>

          {/* Cast */}
          {cast.length > 0 && (
            <View className="mt-8">
              <Text className="text-white text-lg font-bold mb-4">Cast</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {cast.map((person: any) => (
                  <View key={person.id} className="items-center mr-5 w-20">
                    {person.profile_path ? (
                      <Image
                        source={{ uri: getImageUrl(person.profile_path, 'w185') }}
                        className="w-16 h-16 rounded-full"
                        resizeMode="cover"
                        style={{
                          ...Platform.select({
                            ios: {
                              shadowColor: '#000',
                              shadowOffset: { width: 0, height: 2 },
                              shadowOpacity: 0.3,
                              shadowRadius: 4,
                            },
                            android: { elevation: 4 },
                          }),
                        }}
                      />
                    ) : (
                      <View className="w-16 h-16 rounded-full bg-zinc-800 items-center justify-center">
                        <Ionicons name="person-outline" size={20} color="#52525b" />
                      </View>
                    )}
                    <Text className="text-zinc-400 text-xs mt-1.5 text-center font-medium" numberOfLines={2}>
                      {person.name}
                    </Text>
                    {person.character && (
                      <Text className="text-zinc-600 text-[10px] text-center mt-0.5" numberOfLines={1}>
                        {person.character}
                      </Text>
                    )}
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Similar shows */}
          {show.similar?.results?.length > 0 && (
            <View className="mt-6">
              <MediaCarousel
                title="Similar Shows"
                data={show.similar.results}
                onItemPress={(item) => router.push(`/tv/${item.id}`)}
              />
            </View>
          )}

          <View style={{ height: 60 }} />
        </View>
      </ScrollView>
    </View>
  );
}
