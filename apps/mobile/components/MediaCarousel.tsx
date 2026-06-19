import React from 'react';
import { View, Text, FlatList, Dimensions, TouchableOpacity } from 'react-native';
import type { Movie } from '@filmsnaps/shared';
import { MediaCard } from './MediaCard';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ITEM_WIDTH = (SCREEN_WIDTH - 48) / 3;

interface MediaCarouselProps {
  title: string;
  data: Movie[];
  onItemPress: (item: Movie) => void;
  onSeeAll?: () => void;
}

export function MediaCarousel({ title, data, onItemPress, onSeeAll }: MediaCarouselProps) {
  if (!data?.length) return null;

  return (
    <View className="mb-6">
      {/* Section header */}
      <View className="flex-row items-center justify-between px-4 mb-3">
        <Text className="text-white text-lg font-bold tracking-tight">{title}</Text>
        {onSeeAll && (
          <TouchableOpacity onPress={onSeeAll} activeOpacity={0.7}>
            <Text className="text-amber-500 text-sm font-semibold">See All</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={data}
        keyExtractor={(item) => String(item.id)}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
        renderItem={({ item }) => (
          <View style={{ width: ITEM_WIDTH }}>
            <MediaCard item={item} onPress={onItemPress} />
          </View>
        )}
      />
    </View>
  );
}
