import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
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
import { ProgressiveImage } from '../../components/ProgressiveImage';
import { typography } from '../../lib/typography';
import { FilmGrain } from '../../components/FilmGrain';
import { useTVDetails } from '../../hooks/useTMDB';
import { MediaCarousel } from '../../components/MediaCarousel';
import { CastCarousel } from '../../components/CastCarousel';
import { TrailerModal } from '../../components/TrailerModal';
import { DetailSkeleton } from '../../components/Skeletons';
import { isBookmarked, saveBookmark, removeBookmark } from '../../lib/bookmarks';
import type { Movie } from '@filmsnaps/shared';
import { LinearGradient } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

export default function TVDetailScreen() {
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = useWindowDimensions();
  const { data, isLoading } = useTVDetails(id!);

  const BACKDROP_HEIGHT = SCREEN_HEIGHT * 0.45;
  const POSTER_WIDTH = 100;
  const POSTER_OVERLAP = 40;

  const show = data;

  const [bookmarked, setBookmarked] = useState(false);

  useEffect(() => {
    if (id) {
      isBookmarked(id!).then(setBookmarked);
    }
  }, [id]);

  const toggleBookmark = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (bookmarked) {
      await removeBookmark(id!);
      setBookmarked(false);
    } else {
      await saveBookmark({
        tmdbId: id!,
        mediaType: 'tv',
        title: show.name || show.title || '',
        posterPath: show.poster_path ?? null,
        year: show.first_air_date?.split('-')[0] ?? '',
        addedAt: Date.now(),
      });
      setBookmarked(true);
    }
  }, [id, bookmarked, show]);

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (!show) {
    return (
      <View className="flex-1 items-center justify-center bg-void" style={{ backgroundColor: '#070708' }}>
        <Ionicons name="tv-outline" size={48} color="#52525B" />
        <Text className="text-text-secondary mt-3">Show not found</Text>
      </View>
    );
  }

  const title = show.name || show.title || '';
  const year = show.first_air_date?.split('-')[0] ?? '';
  const genres = show.genres ?? [];
  const trailerKey = getTrailerKey(show.videos);
  const cast = show.credits?.cast?.slice(0, 10) ?? [];
  const seasonCount = show.seasons?.filter((s: any) => s.season_number > 0).length ?? 0;

  return (
    <View className="flex-1 bg-void" style={{ backgroundColor: '#070708' }}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Backdrop with film grain */}
        <View style={{ width: SCREEN_WIDTH, height: BACKDROP_HEIGHT, position: 'relative' }}>
          {show.backdrop_path ? (
            <ProgressiveImage
              uri={getImageUrl(show.backdrop_path, 'w780')}
              style={{ width: SCREEN_WIDTH, height: BACKDROP_HEIGHT, position: 'absolute' }}
              resizeMode="cover"
            />
          ) : (
            <View className="w-full h-full" style={{ backgroundColor: '#16161A', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          )}

          {/* Film grain overlay */}
          <FilmGrain opacity={0.04} />

          {/* Smooth gradient — covers bottom 60% */}
          <LinearGradient
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: BACKDROP_HEIGHT * 0.6,
            }}
            colors={['rgba(8,8,8,0)', 'rgba(8,8,8,0.12)', 'rgba(8,8,8,0.35)', 'rgba(8,8,8,0.65)', '#070708']}
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
            <Ionicons name="chevron-back" size={18} color="#F4F4F5" />
            <Text style={{ color: '#F4F4F5', fontSize: 12, marginLeft: 2, fontFamily: 'Inter_500Medium' }}>
              Back
            </Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View className="px-4" style={{ marginTop: -POSTER_OVERLAP }}>
          {/* Poster + Info row */}
          <View className="flex-row">
            {show.poster_path ? (
              <ProgressiveImage
                uri={getImageUrl(show.poster_path, 'w342')}
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
                  backgroundColor: '#16161A',
                }}
              >
                <Ionicons name="tv-outline" size={28} color="#52525B" />
              </View>
            )}

            <View className="flex-1 ml-3 justify-end pb-1">
              <Text
                style={[typography.title, { fontSize: 18, lineHeight: 22 }]}
                numberOfLines={2}
              >
                {title}
              </Text>
              {year ? (
                <Text style={[typography.caption, { marginTop: 2, color: '#A1A1AA' }]}>
                  {year}
                </Text>
              ) : null}

              {genres.length > 0 && (
                <View className="flex-row flex-wrap mt-2" style={{ gap: 4 }}>
                  {genres.slice(0, 3).map((g: { id: number; name: string }) => (
                    <View
                      key={g.id}
                      style={{
                        backgroundColor: '#16161A',
                        borderRadius: 4,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                      }}
                    >
                      <Text
                        style={{ color: '#A1A1AA', fontSize: 10, fontFamily: 'Inter_500Medium' }}
                      >
                        {g.name}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {show.vote_average != null && (
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
                      {show.vote_average.toFixed(1)}
                    </Text>
                  </View>
                  {seasonCount > 0 && (
                    <View className="flex-row items-center ml-3">
                      <Ionicons name="layers-outline" size={14} color="#52525B" />
                      <Text className="text-text-tertiary text-sm ml-1">
                        {seasonCount} {seasonCount === 1 ? 'Season' : 'Seasons'}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>

          {/* Overview — expandable */}
          {show.overview ? (
            <View className="mt-6">
              <Text style={[typography.title, { marginBottom: 8, color: '#F4F4F5' }]}>
                Overview
              </Text>
              <Text
                style={typography.body}
                numberOfLines={overviewExpanded ? undefined : 3}
              >
                {show.overview}
              </Text>
              {show.overview.length > 120 && (
                <TouchableOpacity
                  onPress={() => setOverviewExpanded(!overviewExpanded)}
                  activeOpacity={0.7}
                  style={{ marginTop: 4 }}
                >
                  <Text style={{ color: '#D4A237', fontSize: 12, fontFamily: 'Inter_500Medium' }}>
                    {overviewExpanded ? 'Show less' : 'Read more'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}

          {/* ── Row 1: Primary action + Bookmark ── */}
          <View className="flex-row mt-6" style={{ gap: 10 }}>
            <TouchableOpacity
              onPress={() => router.push(`/watch/tv/${id}/1/1?backdrop=${show.backdrop_path || ''}`)}
              activeOpacity={0.9}
              style={{
                flex: 1,
                backgroundColor: '#D4A237',
                borderRadius: 10,
                paddingVertical: 14,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                ...Platform.select({
                  ios: {
                    shadowColor: '#D4A237',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.3,
                    shadowRadius: 8,
                  },
                  android: { elevation: 6 },
                }),
              }}
            >
              <Ionicons name="play" size={18} color="#070708" style={{ marginRight: 8 }} />
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#070708' }}>
                Watch Now
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={toggleBookmark}
              activeOpacity={0.8}
              accessibilityLabel={bookmarked ? 'Remove from bookmarks' : 'Add to bookmarks'}
              style={{
                width: 48,
                backgroundColor: bookmarked ? 'rgba(232,160,32,0.15)' : 'transparent',
                borderWidth: 0.5,
                borderColor: bookmarked ? '#D4A237' : '#222226',
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons
                name={bookmarked ? 'bookmark' : 'bookmark-outline'}
                size={20}
                color={bookmarked ? '#D4A237' : '#A1A1AA'}
              />
            </TouchableOpacity>
          </View>

          {/* ── Row 2: Download options — compact pills ── */}
          <View className="flex-row mt-2" style={{ gap: 8 }}>
            <TouchableOpacity
              onPress={() => router.push(`/download/nxsha/tv/${id}/1/1`)}
              activeOpacity={0.8}
              style={{
                flex: 1,
                backgroundColor: 'rgba(212,162,55,0.08)',
                borderWidth: 0.5,
                borderColor: 'rgba(212,162,55,0.35)',
                borderRadius: 8,
                paddingVertical: 10,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="download-outline" size={15} color="#D4A237" style={{ marginRight: 5 }} />
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 11, color: '#D4A237' }}>
                Server 1
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push(`/download2/tv/${id}/1/1`)}
              activeOpacity={0.8}
              style={{
                flex: 1,
                backgroundColor: 'rgba(255,255,255,0.04)',
                borderWidth: 0.5,
                borderColor: '#222226',
                borderRadius: 8,
                paddingVertical: 10,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="cloud-download-outline" size={15} color="#A1A1AA" style={{ marginRight: 5 }} />
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 11, color: '#A1A1AA' }}>
                Alt DL
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push(`/download/falix/tv/${id}`)}
              activeOpacity={0.8}
              style={{
                flex: 1,
                backgroundColor: 'rgba(91,156,246,0.08)',
                borderWidth: 0.5,
                borderColor: 'rgba(91,156,246,0.35)',
                borderRadius: 8,
                paddingVertical: 10,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="cloud-download-outline" size={15} color="#5b9cf6" style={{ marginRight: 5 }} />
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 11, color: '#5b9cf6' }}>
                Falix
              </Text>
            </TouchableOpacity>
          </View>

          {/* Cast */}
          {cast.length > 0 && (
            <CastCarousel cast={show.credits.cast} />
          )}

          {/* Trailer */}
          {trailerKey && (
            <View className="px-4 mt-4">
              <TouchableOpacity
                onPress={() => setTrailerOpen(true)}
                activeOpacity={0.8}
                className="flex-row items-center gap-2 self-start px-4 py-2 rounded-lg bg-primary/10"
              >
                <Ionicons name="logo-youtube" size={16} color="#D4A237" />
                <Text className="text-primary text-xs font-semibold">Watch Trailer</Text>
              </TouchableOpacity>
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

      {/* Trailer Modal */}
      <TrailerModal
        videoKey={trailerKey}
        open={trailerOpen}
        onClose={() => setTrailerOpen(false)}
      />
    </View>
  );
}