import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Platform, View, Text, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import DownloadBanner from "../../components/DownloadBanner";
import { colors } from "../../theme/colors";

/**
 * Tab bar styled per the cinematic design system:
 * - #0E0E11 background, subtle top border
 * - Text labels below icons (accessibility-first)
 * - Gold pill indicator under the active icon
 * - iOS: BlurView visual effect behind the bar
 * - Icons: filled variant for active, outline for inactive
 * - 4 tabs: Home, Search, Library, Settings
 *
 * NOTE: swipe-to-navigate (SwipeTabNavigator) is disabled for now — the new
 * finger-following implementation lives in
 * components/SwipeTabNavigator.tsx and can be re-enabled later. The scene
 * transition animation is disabled too (tabs switch instantly on tap).
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
    <View
      style={{ alignItems: "center", justifyContent: "center", minWidth: 48 }}
    >
      <Ionicons
        name={focused ? activeIcon : inactiveIcon}
        size={22}
        color={focused ? colors.gold : colors.textTertiary}
      />
      <Text
        style={{
          fontSize: 10,
          fontFamily: "Inter_500Medium",
          marginTop: 3,
          color: focused ? colors.gold : colors.textTertiary,
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
            backgroundColor: colors.gold,
            marginTop: 3,
          }}
        />
      )}
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomInset =
    Platform.OS === "android" ? Math.max(insets.bottom, 8) : 0;

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          tabBarStyle: {
            backgroundColor:
              Platform.OS === "ios" ? "transparent" : colors.bgSurface,
            borderTopColor: colors.progressTrack,
            borderTopWidth: 0.5,
            paddingBottom: bottomInset + 4,
            paddingTop: 8,
            height: 72 + bottomInset,
          },
          tabBarActiveTintColor: colors.gold,
          tabBarInactiveTintColor: colors.textTertiary,
          tabBarBackground: () =>
            Platform.OS === "ios" ? (
              <BlurView
                tint="dark"
                intensity={90}
                style={StyleSheet.absoluteFill}
              />
            ) : undefined,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
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
            title: "Search",
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
          name="library"
          options={{
            title: "Library",
            tabBarIcon: ({ focused }) => (
              <TabIcon
                focused={focused}
                activeIcon="library"
                inactiveIcon="library-outline"
                label="Library"
              />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: "Settings",
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
      {/* Download banner floats above the tab bar */}
      <DownloadBanner />
    </View>
  );
}
