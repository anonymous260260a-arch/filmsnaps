import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

export default function SavedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View className="flex-1 bg-zinc-950" style={{ paddingTop: insets.top }}>
      <View className="px-5 pt-4 pb-2">
        <Text className="text-white text-2xl font-bold">Saved</Text>
      </View>

      <View className="flex-1 items-center justify-center px-8">
        <View className="w-20 h-20 rounded-full bg-zinc-800 items-center justify-center mb-5">
          <Ionicons name="bookmark-outline" size={36} color="#52525b" />
        </View>
        <Text className="text-white text-lg font-bold mb-2">No saved movies yet</Text>
        <Text className="text-zinc-500 text-sm text-center leading-5 mb-6">
          Start saving movies and TV shows you want to watch later. They'll appear here.
        </Text>
        <TouchableOpacity
          onPress={() => router.push('/')}
          className="bg-amber-500 rounded-xl py-3 px-8"
          activeOpacity={0.9}
        >
          <Text className="text-black font-bold text-base">Discover Movies</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
