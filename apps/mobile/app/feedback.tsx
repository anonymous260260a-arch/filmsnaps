/**
 * Feedback Portal — Full-screen WebView that loads the Feedback app.
 *
 * Shows a loading indicator while loading, a retry screen on error,
 * and an offline message when there is no connection.
 */

import React, { useState, useCallback, useRef } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useSafeNavigation } from "@/lib/navigation";
import { colors } from "../theme/colors";
import { getFeedbackPortalUrl } from "../lib/feedback";

export default function FeedbackScreen() {
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const feedbackUrl = getFeedbackPortalUrl();

  const handleRetry = useCallback(() => {
    setLoading(true);
    setError(null);
    webRef.current?.reload();
  }, []);

  return (
    <View
      className="flex-1"
      style={{ backgroundColor: colors.bg, paddingTop: insets.top }}
    >
      {/* Header */}
      <View className="px-5 pt-4 pb-2 flex-row items-center">
        <TouchableOpacity
          onPress={() => nav.goBack({ fallback: "/(tabs)" })}
          className="w-9 h-9 rounded-full bg-zinc-800/60 items-center justify-center mr-3"
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text
          style={{
            fontFamily: "PlayfairDisplay_700Bold",
            fontSize: 22,
            color: colors.textPrimary,
          }}
        >
          Feedback
        </Text>
      </View>

      {/* Content */}
      <View className="flex-1">
        {error ? (
          <View className="flex-1 items-center justify-center px-8">
            <Ionicons
              name="cloud-offline-outline"
              size={48}
              color={colors.textTertiary}
            />
            <Text
              className="text-center mt-4 mb-2"
              style={{
                color: colors.textPrimary,
                fontSize: 16,
                fontFamily: "Inter_600SemiBold",
              }}
            >
              {error === "offline"
                ? "No Internet Connection"
                : "Failed to Load"}
            </Text>
            <Text
              className="text-center mb-6 leading-5"
              style={{ color: colors.textSecondary, fontSize: 13 }}
            >
              {error === "offline"
                ? "Please check your connection and try again."
                : "Could not load the feedback portal. Please try again."}
            </Text>
            <TouchableOpacity
              onPress={handleRetry}
              className="px-6 py-3 rounded-xl"
              style={{ backgroundColor: colors.gold }}
              activeOpacity={0.7}
            >
              <Text
                className="font-semibold"
                style={{
                  color: "#070708",
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                Retry
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <WebView
            ref={webRef}
            source={{ uri: feedbackUrl }}
            style={{ flex: 1, backgroundColor: colors.bg }}
            onLoadEnd={() => setLoading(false)}
            onError={(e) => {
              console.warn(
                "[Feedback] WebView error:",
                e.nativeEvent.description,
              );
              setError("error");
            }}
            onHttpError={(e) => {
              console.warn("[Feedback] HTTP error:", e.nativeEvent.statusCode);
              setError("error");
            }}
            startInLoadingState
            renderLoading={() => (
              <View className="absolute inset-0 items-center justify-center">
                <ActivityIndicator size="large" color={colors.gold} />
              </View>
            )}
            javaScriptEnabled
            domStorageEnabled
            allowsInlineMediaPlayback
            allowsBackForwardNavigationGestures
            sharedCookiesEnabled
          />
        )}
      </View>
    </View>
  );
}
