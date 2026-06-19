import React from 'react';
import { View, Text, Image, TouchableOpacity, Dimensions, Platform } from 'react-native';
import { getImageUrl } from '@filmsnaps/shared';
import type { Movie } from '@filmsnaps/shared';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = (SCREEN_WIDTH - 48) / 3;
const CARD_HEIGHT = CARD_WIDTH * 1.5;

interface MediaCardProps {
  item: Movie;
  onPress: (item: Movie) => void;
  variant?: 'default' | 'search';
}

export function MediaCard({ item, onPress, variant = 'default' }: MediaCardProps) {
  const posterUrl = getImageUrl(item.poster_path, 'w342');
  const width = variant === 'search' ? (SCREEN_WIDTH - 48) / 3 : CARD_WIDTH;
  const height = width * 1.5;

  return (
    <TouchableOpacity
      onPress={() => onPress(item)}
      activeOpacity={0.8}
      className="mb-3"
      style={{ width }}
    >
      <View
        className="bg-zinc-800 rounded-xl overflow-hidden"
        style={{
          width,
          height,
          ...Platform.select({
            ios: {
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 6,
            },
            android: {
              elevation: 6,
            },
          }),
        }}
      >
        {item.poster_path ? (
          <Image
            source={{ uri: posterUrl }}
            className="w-full h-full"
            resizeMode="cover"
          />
        ) : (
          <View className="flex-1 items-center justify-center bg-zinc-800 px-2">
            <Text className="text-zinc-500 text-3xl mb-1">🎬</Text>
            <Text className="text-zinc-500 text-xs text-center" numberOfLines={3}>
              {item.title || item.name}
            </Text>
          </View>
        )}

        {/* Rating badge */}
        {item.vote_average != null && item.vote_average > 0 && (
          <View className="absolute top-1.5 right-1.5 bg-black/70 rounded-full px-1.5 py-0.5 flex-row items-center">
            <Text className="text-amber-400 text-[10px]">★</Text>
            <Text className="text-white text-[10px] font-semibold ml-0.5">
              {item.vote_average.toFixed(1)}
            </Text>
          </View>
        )}
      </View>

      <Text className="text-zinc-300 text-xs mt-1.5 font-medium" numberOfLines={2}>
        {item.title || item.name}
      </Text>
    </TouchableOpacity>
  );
}
