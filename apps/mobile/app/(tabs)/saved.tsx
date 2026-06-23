import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { typography } from '../../lib/typography';

export default function SavedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View className="flex-1 bg-void" style={{ paddingTop: insets.top }}>
      <View className="px-5 pt-4 pb-2">
        <Text style={[typography.heading, { fontSize: 22 }]}>Saved</Text>
      </View>

      <View className="flex-1 items-center justify-center px-8">
        {/* Large icon in elevated circle */}
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: '#191919',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
          }}
        >
          <Ionicons name="bookmark-outline" size={28} color="#534f4c" />
        </View>

        {/* Playfair heading */}
        <Text style={[typography.heading, { marginBottom: 8 }]}>
          Nothing saved yet
        </Text>

        {/* Body text */}
        <Text
          style={[typography.body, { textAlign: 'center', marginBottom: 24 }]}
        >
          Films you save will show up here for quick access.
        </Text>

        {/* Gold CTA */}
        <TouchableOpacity
          onPress={() => router.push('/')}
          activeOpacity={0.9}
          style={{
            backgroundColor: '#e8a020',
            borderRadius: 10,
            paddingVertical: 12,
            paddingHorizontal: 28,
          }}
        >
          <Text
            style={{
              fontFamily: 'Inter_600SemiBold',
              fontSize: 14,
              color: '#080808',
              textAlign: 'center',
            }}
          >
            Discover Films
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
