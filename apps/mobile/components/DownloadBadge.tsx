/**
 * DownloadBadge — A subtle floating pill on the tab bar showing active download count.
 *
 * Tapping navigates to the Downloads management page.
 * Disappears when no downloads are active.
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useDownloadList } from '../lib/download';

export default function DownloadBadge() {
  const router = useRouter();
  const { active } = useDownloadList();
  const count = active.length;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    if (count > 0) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          friction: 6,
          tension: 100,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start();
    }
  }, [count, opacity, scale]);

  if (count === 0) return null;

  return (
    <Animated.View
      style={{
        position: 'absolute',
        bottom: 0,
        alignSelf: 'center',
        opacity,
        transform: [{ scale }],
        zIndex: 50,
      }}
    >
      <TouchableOpacity
        onPress={() => router.push('/downloads')}
        activeOpacity={0.8}
        className="flex-row items-center px-3 py-1.5 rounded-full mb-1"
        style={{ backgroundColor: '#D4A237' }}
      >
        <Ionicons name="download" size={12} color="#000" />
        <Text className="text-black text-[11px] font-bold ml-1">{count}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}
