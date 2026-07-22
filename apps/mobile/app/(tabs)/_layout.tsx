import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Platform, View, Text, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import DownloadBadge from '../../components/DownloadBadge';

/**
 * Tab bar styled per the cinematic design system:
 * - #0E0E11 background, subtle top border
 * - Text labels below icons (accessibility-first)
 * - Gold pill indicator under the active icon
 * - iOS: BlurView visual effect behind the bar
 * - Icons: filled variant for active, outline for inactive
 * - 3 tabs: Home, Search, Settings (history/saved moved to stack screens)
 */

function TabIcon({
  focused,
  activeIcon,
  inactiveIcon,
  label,
}: {
  focused: boolean;
  activeIcon: keyof typeof Ionicons.glyphMap;
  inactiveIcon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', minWidth: 48 }}>
      <Ionicons
        name={focused ? activeIcon : inactiveIcon}
        size={22}
        color={focused ? '#D4A237' : '#52525b'}
      />
      <Text
        style={{
          fontSize: 10,
          fontFamily: 'Inter_500Medium',
          marginTop: 3,
          color: focused ? '#D4A237' : '#52525b',
        }}
      >
        {label}
      </Text>
      {/* Gold pill indicator */}
      {focused && (
        <View
          style={{
            width: 20,
            height: 2,
            borderRadius: 1,
            backgroundColor: '#D4A237',
            marginTop: 3,
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
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          tabBarStyle: {
            backgroundColor: Platform.OS === 'ios' ? 'transparent' : '#0E0E11',
            borderTopColor: '#222226',
            borderTopWidth: 0.5,
            paddingBottom: bottomInset + 4,
            paddingTop: 8,
            height: 72 + bottomInset,
          },
          tabBarActiveTintColor: '#D4A237',
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
                label="Home"
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
                label="Search"
              />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ focused }) => (
              <TabIcon
                focused={focused}
                activeIcon="settings"
                inactiveIcon="settings-outline"
                label="Settings"
              />
            ),
          }}
        />
      </Tabs>
      {/* Download badge floats above the tab bar */}
      <DownloadBadge />
    </View>
  );
}
