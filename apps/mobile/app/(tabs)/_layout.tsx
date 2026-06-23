import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Platform, View, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';

/**
 * Tab bar styled per the cinematic design system:
 * - #0f0f0f background, subtle top border
 * - Gold dot indicator below the active icon (no label)
 * - iOS: BlurView visual effect behind the bar
 * - Icons: filled variant for active, outline for inactive
 */

function TabIcon({
  focused,
  activeIcon,
  inactiveIcon,
}: {
  focused: boolean;
  activeIcon: keyof typeof Ionicons.glyphMap;
  inactiveIcon: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons
        name={focused ? activeIcon : inactiveIcon}
        size={24}
        color={focused ? '#e8a020' : '#52525b'}
      />
      {/* Gold dot indicator */}
      {focused && (
        <View
          style={{
            width: 4,
            height: 4,
            borderRadius: 2,
            backgroundColor: '#e8a020',
            marginTop: 2,
          }}
        />
      )}
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomInset = Platform.OS === 'android' ? Math.max(insets.bottom, 8) : 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : '#0f0f0f',
          borderTopColor: '#252525',
          borderTopWidth: 0.5,
          paddingBottom: bottomInset + 4,
          paddingTop: 10,
          height: 80 + bottomInset,
        },
        tabBarActiveTintColor: '#e8a020',
        tabBarInactiveTintColor: '#52525b',
        tabBarBackground: () =>
          Platform.OS === 'ios' ? (
            <BlurView tint="dark" intensity={90} style={StyleSheet.absoluteFill} />
          ) : undefined,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              focused={focused}
              activeIcon="home"
              inactiveIcon="home-outline"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              focused={focused}
              activeIcon="search"
              inactiveIcon="search-outline"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Saved',
          tabBarIcon: ({ focused }) => (
            <TabIcon
              focused={focused}
              activeIcon="bookmark"
              inactiveIcon="bookmark-outline"
            />
          ),
        }}
      />
    </Tabs>
  );
}
