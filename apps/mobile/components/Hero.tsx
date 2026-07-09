import React from 'react';
import { View, Text, TouchableOpacity, useWindowDimensions, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getImageUrl } from '@filmsnaps/shared';
import { ProgressiveImage } from './ProgressiveImage';
import { typography } from '../lib/typography';
import { FilmGrain } from './FilmGrain';
import type { Movie } from '@filmsnaps/shared';
import { LinearGradient } from 'react-native-svg';

interface HeroProps {
  item: Movie;
  onWatchPress: (item: Movie) => void;
}

/**
 * Full-bleed cinematic hero panel.
 *
 * - 58% screen height
 * - Film grain SVG overlay at 4% opacity (signature visual fingerprint)
 * - Letterbox bars (4px void-black borders left/right)
 * - Warm gradient overlay: transparent top 30% → void bottom
 * - Playfair Display title, gold rating badge, metadata row
 * - Gold "Watch Now" CTA
 */
export function Hero({ item, onWatchPress }: HeroProps) {
  const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = useWindowDimensions();
  const HERO_HEIGHT = SCREEN_HEIGHT * 0.50;

  const backdropUrl = getImageUrl(item.backdrop_path, 'w780');
  const title = item.title || item.name || '';
  const overview = item.overview || '';
  const rating = item.vote_average ?? 0;
  const year = item.release_date?.split('-')[0] ?? item.first_air_date?.split('-')[0] ?? '';
  const genres = item.genre_ids?.slice(0, 2) ?? [];

  return (
    <View style={{ height: HERO_HEIGHT, position: 'relative', overflow: 'hidden' }}>
      {/* Backdrop image — full bleed */}
      {item.backdrop_path ? (
        <ProgressiveImage
          uri={backdropUrl}
          style={{ width: SCREEN_WIDTH, height: HERO_HEIGHT, position: 'absolute' }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{
            width: SCREEN_WIDTH,
            height: HERO_HEIGHT,
            position: 'absolute',
            backgroundColor: '#191919',
          }}
        />
      )}

      {/* Film grain texture overlay */}
      <FilmGrain opacity={0.04} />

      {/* Letterbox bars — 4px void-black on left/right */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: 4,
          backgroundColor: '#080808',
          zIndex: 1,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: 4,
          backgroundColor: '#080808',
          zIndex: 1,
        }}
      />

      {/* Smooth gradient overlay — transparent at 30% top → void at bottom */}
      <LinearGradient
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: HERO_HEIGHT * 0.7,
        }}
        colors={['rgba(8,8,8,0)', 'rgba(8,8,8,0.08)', 'rgba(8,8,8,0.35)', 'rgba(8,8,8,0.65)', '#080808']}
        locations={[0, 0.2, 0.5, 0.8, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      {/* Content block — anchored to bottom */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 4,
          right: 4,
          paddingHorizontal: 20,
          paddingBottom: 28,
          paddingTop: 40,
          zIndex: 2,
        }}
      >
        {/* Rating badge — gold with subtle bg */}
        {rating > 0 && (
          <View
            style={{
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: 'rgba(232,160,32,0.15)',
              borderWidth: 0.5,
              borderColor: 'rgba(232,160,32,0.3)',
              borderRadius: 4,
              paddingHorizontal: 8,
              paddingVertical: 3,
              marginBottom: 10,
            }}
          >
            <Text style={{ color: '#e8a020', fontSize: 11, fontWeight: '700', marginRight: 4 }}>
              ★
            </Text>
            <Text style={{ color: '#e8a020', fontSize: 11, fontWeight: '700' }}>
              {rating.toFixed(1)}
            </Text>
          </View>
        )}

        {/* Title — Playfair Display */}
        <Text
          style={[typography.display, { marginBottom: 6 }]}
          numberOfLines={2}
        >
          {title}
        </Text>

        {/* Metadata row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
          {year ? (
            <Text style={[typography.caption, { color: '#9b9590' }]}>{year}</Text>
          ) : null}
          {year && <View style={{ width: 2, height: 2, borderRadius: 1, backgroundColor: '#534f4c', marginHorizontal: 8 }} />}
          <Text style={[typography.caption, { color: '#9b9590' }]} numberOfLines={1}>
            {rating.toFixed(1)}
          </Text>
          <View style={{ width: 2, height: 2, borderRadius: 1, backgroundColor: '#534f4c', marginHorizontal: 8 }} />
          <Text style={[typography.caption, { color: '#9b9590' }]} numberOfLines={1}>
            Movie
          </Text>
        </View>

        {/* Overview — 2 lines */}
        {overview ? (
          <Text
            style={[typography.body, { color: '#9b9590', marginBottom: 20 }]}
            numberOfLines={2}
          >
            {overview}
          </Text>
        ) : null}

        {/* Watch Now — gold CTA */}
        <TouchableOpacity
          onPress={() => onWatchPress(item)}
          activeOpacity={0.9}
          style={{
            backgroundColor: '#e8a020',
            borderRadius: 10,
            paddingVertical: 14,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            ...Platform.select({
              ios: {
                shadowColor: '#e8a020',
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.35,
                shadowRadius: 12,
              },
              android: { elevation: 8 },
            }),
          }}
        >
          <Ionicons name="play" size={16} color="#080808" style={{ marginRight: 8 }} />
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
      </View>
    </View>
  );
}
