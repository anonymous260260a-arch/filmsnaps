import React, { useRef, useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, useWindowDimensions, Animated } from 'react-native';
import { getImageUrl } from '@filmsnaps/shared';
import type { Movie } from '@filmsnaps/shared';

const GAP = 10;
const PADDING = 16;

interface MediaCardProps {
  item: Movie;
  onPress: (item: Movie) => void;
  variant?: 'default' | 'search';
}

/**
 * Movie/show poster card with 2:3 aspect ratio.
 *
 * - Gold rating badge (top-right, semi-transparent dark bg)
 * - Press animation: spring scale 1.0 → 0.96
 * - Title in t2 (#9b9590), 11px, single line truncated
 */
export function MediaCard({ item, onPress, variant = 'default' }: MediaCardProps) {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const cardWidth =
    variant === 'search'
      ? (SCREEN_WIDTH - 16 * 2 - 8 * 2) / 3
      : (SCREEN_WIDTH - 48) / 3;
  const cardHeight = cardWidth * 1.5; // 2:3 ratio

  const posterUrl = getImageUrl(item.poster_path, 'w342');

  const onPressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.96,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [scaleAnim]);

  const onPressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [scaleAnim]);

  return (
    <TouchableOpacity
      onPress={() => onPress(item)}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      activeOpacity={1}
      style={{ marginBottom: 14 }}
    >
      <Animated.View
        style={{
          width: cardWidth,
          transform: [{ scale: scaleAnim }],
        }}
      >
        <View
          className="bg-elevated rounded-xl overflow-hidden"
          style={{ width: cardWidth, height: cardHeight }}
        >
          {item.poster_path ? (
            <Image
              source={{ uri: posterUrl }}
              className="w-full h-full"
              resizeMode="cover"
            />
          ) : (
            <View className="flex-1 items-center justify-center bg-elevated px-2">
              <Text className="text-t3 text-3xl mb-1">🎬</Text>
              <Text className="text-t3 text-xs text-center" numberOfLines={3}>
                {item.title || item.name}
              </Text>
            </View>
          )}

          {/* Rating badge — dark semi-transparent bg, gold star + text */}
          {item.vote_average != null && item.vote_average > 0 && (
            <View
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                backgroundColor: 'rgba(8,8,8,0.75)',
                borderRadius: 4,
                paddingHorizontal: 5,
                paddingVertical: 2,
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#e8a020', fontSize: 10, fontWeight: '700', marginRight: 2 }}>
                ★
              </Text>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '600' }}>
                {item.vote_average.toFixed(1)}
              </Text>
            </View>
          )}
        </View>

        {/* Title — t2, 11px, 1 line truncated */}
        <Text
          style={{
            color: '#9b9590',
            fontSize: 11,
            fontFamily: 'Inter_500Medium',
            marginTop: 6,
          }}
          numberOfLines={1}
        >
          {item.title || item.name}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}
