import React from 'react';
import { View, Text, Image, Dimensions, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getImageUrl } from '@filmsnaps/shared';
import type { Movie } from '@filmsnaps/shared';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_HEIGHT = SCREEN_WIDTH * 0.62;

interface HeroProps {
  item: Movie;
  onWatchPress: (item: Movie) => void;
}

function BottomGradient() {
  // Simulate a smooth gradient with stepped opacity layers
  const steps = [0, 0.15, 0.35, 0.55, 0.75];
  const layerHeight = HERO_HEIGHT * 0.5 / steps.length;
  return (
    <View className="absolute bottom-0 left-0 right-0" style={{ height: HERO_HEIGHT * 0.5 }}>
      {steps.map((opacity, i) => (
        <View
          key={i}
          style={{
            height: layerHeight,
            backgroundColor: `rgba(9, 9, 11, ${opacity})`,
          }}
        />
      ))}
    </View>
  );
}

export function Hero({ item, onWatchPress }: HeroProps) {
  const backdropUrl = getImageUrl(item.backdrop_path, 'w1280');
  const title = item.title || item.name || '';
  const overview = item.overview || '';
  const rating = item.vote_average ?? 0;

  return (
    <View style={{ height: HERO_HEIGHT }}>
      {/* Backdrop image */}
      {item.backdrop_path ? (
        <Image
          source={{ uri: backdropUrl }}
          className="absolute w-full h-full"
          resizeMode="cover"
        />
      ) : (
        <View className="absolute w-full h-full bg-zinc-900" />
      )}

      {/* Top fade gradient */}
      {/* <View
        className="absolute top-0 left-0 right-0"
        style={{ height: 60, backgroundColor: 'rgba(9,9,11,0.6)' }}
      /> */}

      {/* Bottom smooth gradient */}
      <BottomGradient />

      {/* Content */}
      <View className="absolute bottom-0 left-0 right-0 px-5 pb-6">
        <Text
          className="text-white text-3xl font-bold tracking-tight leading-tight"
          numberOfLines={2}
        >
          {title}
        </Text>

        {rating > 0 && (
          <View className="flex-row items-center mt-2 mb-2">
            <View className="bg-amber-500/20 rounded-full px-2.5 py-0.5 flex-row items-center">
              <Text className="text-amber-400 text-sm">★</Text>
              <Text className="text-amber-400 text-sm font-bold ml-1">
                {rating.toFixed(1)}
              </Text>
            </View>
            <Text className="text-zinc-500 text-xs ml-3 uppercase tracking-wider">Trending</Text>
          </View>
        )}

        {overview ? (
          <Text className="text-zinc-400 text-sm leading-5 mb-4" numberOfLines={2}>
            {overview}
          </Text>
        ) : null}

        <TouchableOpacity
          onPress={() => onWatchPress(item)}
          activeOpacity={0.9}
          className="bg-amber-500 rounded-xl py-3 px-8 self-start flex-row items-center"
          style={{
            ...Platform.select({
              ios: {
                shadowColor: '#f59e0b',
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.45,
                shadowRadius: 12,
              },
              android: { elevation: 8 },
            }),
          }}
        >
          <Ionicons name="play" size={18} color="#000" />
          <Text className="text-black font-bold text-base ml-2">Watch Now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
