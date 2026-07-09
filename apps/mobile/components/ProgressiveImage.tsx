import React from 'react';
import { Image, View, StyleSheet } from 'react-native';

/**
 * Simple image wrapper with dark background placeholder (no fade animation).
 * Avoids flicker during navigation transitions that animated images can cause.
 */
export function ProgressiveImage({
  uri,
  style,
  resizeMode = 'cover',
  placeholderColor = '#080808',
}: {
  uri: string;
  style?: any;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'repeat' | 'center';
  placeholderColor?: string;
}) {
  return (
    <View style={[style, { backgroundColor: placeholderColor }]}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        resizeMode={resizeMode}
      />
    </View>
  );
}
