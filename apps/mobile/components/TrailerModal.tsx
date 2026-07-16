/**
 * TrailerModal — fullscreen YouTube trailer modal on mobile.
 */

import React, { useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, Dimensions, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';

interface TrailerModalProps {
  videoKey: string | null | undefined;
  open: boolean;
  onClose: () => void;
}

export function TrailerModal({ videoKey, open, onClose }: TrailerModalProps) {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

  if (!videoKey) return null;

  const embedUrl = `https://www.youtube-nocookie.com/embed/${videoKey}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/95 justify-center items-center">
        {/* Close button */}
        <TouchableOpacity
          onPress={onClose}
          className="absolute top-14 right-6 z-50 w-10 h-10 rounded-full bg-white/10 items-center justify-center"
          activeOpacity={0.7}
          accessibilityLabel="Close trailer"
          accessibilityRole="button"
        >
          <Ionicons name="close" size={22} color="#fff" />
        </TouchableOpacity>

        {/* Title */}
        <Text
          className="text-text-primary text-lg font-bold mb-6"
          style={{ fontFamily: 'PlayfairDisplay_700Bold' }}
        >
          Trailer
        </Text>

        {/* Video */}
        <View className="w-full" style={{ aspectRatio: 16 / 9 }}>
          <WebView
            source={{ uri: embedUrl }}
            style={{ backgroundColor: '#000' }}
            allowsFullscreenVideo
            javaScriptEnabled
            domStorageEnabled
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            setSupportMultipleWindows={false}
          />
        </View>
      </View>
    </Modal>
  );
}
