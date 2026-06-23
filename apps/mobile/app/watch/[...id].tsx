import React from 'react';
import { View, Text, TouchableOpacity, StatusBar } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { VideoWebView } from '../../components/VideoWebView';

export default function WatchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string[] }>();

  const segments = params.id ?? [];
  const type = segments[0] as 'movie' | 'tv';
  const id = segments[1];
  const season = segments[2] ? Number(segments[2]) : undefined;
  const episode = segments[3] ? Number(segments[3]) : undefined;

  const provider =
    typeof params.provider === 'string' ? params.provider : undefined;

  if (!id || !type) {
    return (
      <View className="flex-1 items-center justify-center bg-void px-6">
        <StatusBar barStyle="light-content" />
        <View className="w-16 h-16 rounded-full bg-elevated items-center justify-center mb-5">
          <Ionicons name="alert-circle-outline" size={36} color="#534f4c" />
        </View>
        <Text className="text-t1 text-lg font-semibold mb-2">
          Invalid video URL
        </Text>
        <Text className="text-t3 text-sm text-center mb-6 leading-5">
          This link doesn't point to a valid movie or TV show.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          className="bg-gold rounded-xl py-3 px-8"
          activeOpacity={0.8}
        >
          <Text className="text-void font-bold text-base">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <StatusBar barStyle="light-content" hidden />
      <VideoWebView
        type={type}
        id={id}
        season={season}
        episode={episode}
        initialProvider={provider}
        onClose={() => router.back()}
      />
    </View>
  );
}
