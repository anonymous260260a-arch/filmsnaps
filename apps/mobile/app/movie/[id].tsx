import React from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getImageUrl, getTrailerKey } from '@filmsnaps/shared';
import { typography } from '../../lib/typography';
import { FilmGrain } from '../../components/FilmGrain';
import { useMovieDetails } from '../../hooks/useTMDB';
import { MediaCarousel } from '../../components/MediaCarousel';
import type { Movie } from '@filmsnaps/shared';
import { LinearGradient } from 'react-native-svg';

export default function MovieDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = useWindowDimensions();
  const { data, isLoading } = useMovieDetails(id!);

  const BACKDROP_HEIGHT = SCREEN_HEIGHT * 0.45;
  const POSTER_WIDTH = 100;
  const POSTER_OVERLAP = 40;

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-void">
        <ActivityIndicator size="large" color="#e8a020" />
      </View>
    );
  }

  const movie = data;
  if (!movie) {
    return (
      <View className="flex-1 items-center justify-center bg-void">
        <Ionicons name="film-outline" size={48} color="#534f4c" />
        <Text className="text-t2 mt-3">Movie not found</Text>
      </View>
    );
  }

  const title = movie.title || movie.name || '';
  const year = movie.release_date?.split('-')[0] ?? '';
  const genres = movie.genres ?? [];
  const trailerKey = getTrailerKey(movie.videos);
  const cast = movie.credits?.cast?.slice(0, 10) ?? [];

  return (
    <View className="flex-1 bg-void">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Backdrop with film grain */}
        <View style={{ width: SCREEN_WIDTH, height: BACKDROP_HEIGHT }}>
          {movie.backdrop_path ? (
            <Image
              source={{ uri: getImageUrl(movie.backdrop_path, 'w780') }}
              style={{ width: SCREEN_WIDTH, height: BACKDROP_HEIGHT }}
              resizeMode="cover"
            />
          ) : (
            <View className="w-full h-full" style={{ backgroundColor: '#191919' }} />
          )}

          {/* Film grain overlay */}
          <FilmGrain opacity={0.04} />

          {/* Smooth gradient — covers bottom 60% for poster overlap */}
          <LinearGradient
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: BACKDROP_HEIGHT * 0.6,
            }}
            colors={['rgba(8,8,8,0)', 'rgba(8,8,8,0.12)', 'rgba(8,8,8,0.35)', 'rgba(8,8,8,0.65)', '#080808']}
            locations={[0, 0.2, 0.5, 0.8, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
          />
        </View>

        {/* Pill-shaped back button */}
        <View
          style={{
            position: 'absolute',
            top: insets.top + 12,
            left: 16,
            zIndex: 10,
          }}
        >
          <TouchableOpacity
            onPress={() => router.back()}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: 'rgba(8,8,8,0.7)',
              borderRadius: 20,
              paddingHorizontal: 12,
              paddingVertical: 6,
            }}
          >
            <Ionicons name="chevron-back" size={18} color="#f2ede6" />
            <Text style={{ color: '#f2ede6', fontSize: 12, marginLeft: 2, fontFamily: 'Inter_500Medium' }}>
              Back
            </Text>
          </TouchableOpacity>
        </View>

        {/* Content — starts below backdrop */}
        <View className="px-4" style={{ marginTop: -POSTER_OVERLAP }}>
          {/* Poster + Info row */}
          <View className="flex-row">
            {/* Poster — overlapping the backdrop by 40px */}
            {movie.poster_path ? (
              <Image
                source={{ uri: getImageUrl(movie.poster_path, 'w342') }}
                style={{
                  width: POSTER_WIDTH,
                  height: POSTER_WIDTH * 1.5,
                  borderRadius: 8,
                  ...Platform.select({
                    ios: {
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 8 },
                      shadowOpacity: 0.5,
                      shadowRadius: 12,
                    },
                    android: { elevation: 10 },
                  }),
                }}
                resizeMode="cover"
              />
            ) : (
              <View
                className="rounded-xl items-center justify-center"
                style={{
                  width: POSTER_WIDTH,
                  height: POSTER_WIDTH * 1.5,
                  backgroundColor: '#191919',
                }}
              >
                <Ionicons name="film-outline" size={28} color="#534f4c" />
              </View>
            )}

            {/* Info to the right of poster */}
            <View className="flex-1 ml-3 justify-end pb-1">
              <Text
                style={[typography.title, { fontSize: 18, lineHeight: 22 }]}
                numberOfLines={2}
              >
                {title}
              </Text>
              {year ? (
                <Text style={[typography.caption, { marginTop: 2, color: '#9b9590' }]}>
                  {year}
                </Text>
              ) : null}

              {/* Genre badges — elevated bg */}
              {genres.length > 0 && (
                <View className="flex-row flex-wrap mt-2" style={{ gap: 4 }}>
                  {genres.slice(0, 3).map((g: { id: number; name: string }) => (
                    <View
                      key={g.id}
                      style={{
                        backgroundColor: '#191919',
                        borderRadius: 4,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                      }}
                    >
                      <Text
                        style={{ color: '#9b9590', fontSize: 10, fontFamily: 'Inter_500Medium' }}
                      >
                        {g.name}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Jade rating pill — use jade for information, not gold */}
              {movie.vote_average != null && (
                <View className="flex-row items-center mt-2">
                  <View
                    style={{
                      backgroundColor: 'rgba(76,175,130,0.15)',
                      borderRadius: 4,
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      flexDirection: 'row',
                      alignItems: 'center',
                      borderWidth: 0.5,
                      borderColor: 'rgba(76,175,130,0.3)',
                    }}
                  >
                    <Text style={{ color: '#4caf82', fontSize: 11, fontWeight: '700', marginRight: 4 }}>
                      ★
                    </Text>
                    <Text style={{ color: '#4caf82', fontSize: 11, fontWeight: '700' }}>
                      {movie.vote_average.toFixed(1)}
                    </Text>
                  </View>
                  {movie.runtime && (
                    <View className="flex-row items-center ml-3">
                      <Ionicons name="time-outline" size={14} color="#534f4c" />
                      <Text className="text-t3 text-sm ml-1">{movie.runtime} min</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>

          {/* Overview */}
          {movie.overview ? (
            <View className="mt-6">
              <Text style={[typography.title, { marginBottom: 8, color: '#f2ede6' }]}>
                Overview
              </Text>
              <Text style={typography.body}>{movie.overview}</Text>
            </View>
          ) : null}

          {/* Action buttons */}
          <View className="flex-row mt-6" style={{ gap: 10 }}>
            {/* Watch Now — primary gold CTA */}
            <TouchableOpacity
              onPress={() => router.push(`/watch/movie/${id}`)}
              activeOpacity={0.9}
              style={{
                flex: 1,
                backgroundColor: '#e8a020',
                borderRadius: 10,
                paddingVertical: 14,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                ...Platform.select({
                  ios: {
                    shadowColor: '#e8a020',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.3,
                    shadowRadius: 8,
                  },
                  android: { elevation: 6 },
                }),
              }}
            >
              <Ionicons name="play" size={18} color="#080808" style={{ marginRight: 8 }} />
              <Text
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  fontSize: 14,
                  color: '#080808',
                }}
              >
                Watch Now
              </Text>
            </TouchableOpacity>

            {/* Download 2 — secondary with subtle border */}
            <TouchableOpacity
              onPress={() => router.push(`/download2/movie/${id}`)}
              activeOpacity={0.8}
              style={{
                backgroundColor: 'transparent',
                borderWidth: 0.5,
                borderColor: '#252525',
                borderRadius: 10,
                paddingVertical: 14,
                paddingHorizontal: 18,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="cloud-download-outline" size={18} color="#5b9cf6" style={{ marginRight: 6 }} />
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#5b9cf6' }}>
                Download
              </Text>
            </TouchableOpacity>
          </View>

          {/* Cast */}
          {cast.length > 0 && (
            <View className="mt-8">
              <Text style={[typography.heading, { marginBottom: 16 }]}>Cast</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {cast.map((person: any) => (
                  <View key={person.id} className="items-center mr-3.5" style={{ width: 56 }}>
                    {person.profile_path ? (
                      <Image
                        source={{ uri: getImageUrl(person.profile_path, 'w185') }}
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: 28,
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
                        resizeMode="cover"
                      />
                    ) : (
                      <View
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: 28,
                          backgroundColor: '#191919',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Ionicons name="person-outline" size={22} color="#534f4c" />
                      </View>
                    )}
                    <Text
                      style={{
                        color: '#f2ede6',
                        fontSize: 11,
                        fontFamily: 'Inter_500Medium',
                        textAlign: 'center',
                        marginTop: 6,
                      }}
                      numberOfLines={1}
                    >
                      {person.name}
                    </Text>
                    {person.character && (
                      <Text
                        style={{
                          color: '#9b9590',
                          fontSize: 10,
                          fontFamily: 'Inter_400Regular',
                          textAlign: 'center',
                          marginTop: 2,
                        }}
                        numberOfLines={1}
                      >
                        {person.character}
                      </Text>
                    )}
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Similar movies */}
          {movie.similar?.results?.length > 0 && (
            <View className="mt-6">
              <MediaCarousel
                title="Similar Movies"
                data={movie.similar.results}
                onItemPress={(item) => router.push(`/movie/${item.id}`)}
              />
            </View>
          )}

          <View style={{ height: 60 }} />
        </View>
      </ScrollView>
    </View>
  );
}
