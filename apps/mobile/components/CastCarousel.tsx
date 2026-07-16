/**
 * CastCarousel — horizontal scroll of cast member circles on mobile.
 * Tapping a cast member navigates to the person detail page.
 */

import React from 'react';
import { View, Text, ScrollView, Image, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { getImageUrl } from '@filmsnaps/shared';

interface CastMember {
  id: number;
  name: string;
  character?: string;
  profile_path?: string | null;
}

interface CastCarouselProps {
  cast: CastMember[];
}

export function CastCarousel({ cast }: CastCarouselProps) {
  const router = useRouter();

  if (!cast || cast.length === 0) return null;

  return (
    <View className="py-6">
      <Text
        className="text-text-primary text-lg font-bold mb-4 px-4"
        style={{ fontFamily: 'PlayfairDisplay_700Bold' }}
      >
        Cast
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 16 }}
      >
        {cast.slice(0, 20).map((member) => (
          <TouchableOpacity
            key={member.id}
            onPress={() => router.push(`/person/${member.id}`)}
            activeOpacity={0.7}
            className="items-center"
            style={{ width: 72 }}
          >
            <View className="w-16 h-16 rounded-full bg-elevated overflow-hidden mb-2 ring-1 ring-white/[0.06]">
              {member.profile_path ? (
                <Image
                  source={{ uri: getImageUrl(member.profile_path, 'w185') }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                />
              ) : (
                <View className="w-full h-full items-center justify-center">
                  <Text className="text-text-tertiary text-lg font-bold">
                    {member.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
            <Text className="text-text-primary text-xs font-semibold text-center" numberOfLines={1}>
              {member.name}
            </Text>
            {member.character && (
              <Text className="text-text-tertiary text-[10px] text-center mt-0.5" numberOfLines={1}>
                {member.character}
              </Text>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}
