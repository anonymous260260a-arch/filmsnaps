/**
 * TrailerModal — fullscreen YouTube trailer modal on mobile.
 * Uses proper origin/baseUrl and HTML wrapper to prevent YouTube embed configuration errors.
 */

import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Dimensions,
  Linking,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { colors } from "../theme/colors";

interface TrailerModalProps {
  videoKey: string | null | undefined;
  open: boolean;
  onClose: () => void;
}

export function TrailerModal({ videoKey, open, onClose }: TrailerModalProps) {
  const { width: SCREEN_WIDTH } = Dimensions.get("window");

  if (!videoKey) return null;

  // HTML embed wrapper with baseUrl to bypass YouTube domain restriction errors
  const htmlContent = `
<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background-color: #000; display: flex; align-items: center; justify-content: center; height: 100vh; width: 100vw; overflow: hidden; }
      iframe { width: 100%; height: 100%; border: none; }
    </style>
  </head>
  <body>
    <iframe
      src="https://www.youtube.com/embed/${videoKey}?autoplay=1&playsinline=1&enablejsapi=1&rel=0&modestbranding=1"
      frameborder="0"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen
    ></iframe>
  </body>
</html>
  `;

  const handleOpenExternal = () => {
    Linking.openURL(`https://www.youtube.com/watch?v=${videoKey}`).catch(
      () => {},
    );
  };

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/95 justify-center items-center px-4">
        {/* Top bar with Close button */}
        <View className="absolute top-14 left-6 right-6 flex-row items-center justify-between z-50">
          <Text
            className="text-text-primary text-base font-bold"
            style={{
              fontFamily: "PlayfairDisplay_700Bold",
              color: colors.gold,
            }}
          >
            Official Trailer
          </Text>

          <TouchableOpacity
            onPress={onClose}
            className="w-9 h-9 rounded-full bg-white/10 items-center justify-center border border-white/10"
            activeOpacity={0.7}
            accessibilityLabel="Close trailer"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* Video Player Container */}
        <View
          className="w-full rounded-2xl overflow-hidden border border-white/10 bg-black"
          style={{ aspectRatio: 16 / 9 }}
        >
          <WebView
            source={{
              html: htmlContent,
              baseUrl: "https://www.youtube.com",
            }}
            style={{ backgroundColor: "#000" }}
            allowsFullscreenVideo
            javaScriptEnabled
            domStorageEnabled
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            originWhitelist={["*"]}
            userAgent={
              Platform.OS === "android"
                ? "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36"
                : undefined
            }
          />
        </View>

        {/* Fallback button: Watch on YouTube app */}
        <TouchableOpacity
          onPress={handleOpenExternal}
          className="mt-6 flex-row items-center px-4 py-2 rounded-full bg-white/5 border border-white/10"
          activeOpacity={0.7}
        >
          <Ionicons
            name="logo-youtube"
            size={16}
            color="#FF0000"
            style={{ marginRight: 6 }}
          />
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 12,
              fontFamily: "Inter_500Medium",
            }}
          >
            Open in YouTube
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}
