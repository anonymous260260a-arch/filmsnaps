import React, { useRef, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  BackHandler,
  Platform,
  Animated,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeNavigation } from "@/lib/navigation";
import { colors } from "../../theme/colors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { VideoWebView } from "../../components/VideoWebView";
import { HevcPlayer } from "../../components/HevcPlayer";
import { isDirectVideoUrl } from "../../lib/hevc";

export default function WatchScreen() {
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    id: string[];
    backdrop?: string;
    provider?: string;
    videoUrl?: string;
    fileUri?: string;
    title?: string;
    startAt?: string;
    isAnime?: string;
    mid?: string;
    aid?: string;
    audio?: string;
  }>();

  const segments = params.id ?? [];
  const type = segments[0] as "movie" | "tv";
  const id = segments[1];
  const season = segments[2] ? Number(segments[2]) : undefined;
  const episode = segments[3] ? Number(segments[3]) : undefined;

  const provider =
    typeof params.provider === "string" ? params.provider : undefined;
  const backdropUrl = params.backdrop || undefined;
  const videoUrl = params.videoUrl || undefined;
  const fileUri = params.fileUri || undefined;
  const title = params.title || undefined;
  const startAt = params.startAt ? Number(params.startAt) : 0;
  const isAnime = params.isAnime === "1";
  const animeMalId = params.mid ? Number(params.mid) : undefined;
  console.log(
    `[FS-WH] WatchScreen mount type=${type} id=${id} isAnime=${isAnime} rawIsAnime=${params.isAnime} mid=${params.mid} aid=${params.aid}`,
  );
  const animeAnilistId = params.aid ? Number(params.aid) : undefined;
  const animeAudio = params.audio === "dub" ? "dub" : "sub";

  // Determine if this is a direct video playback (HEVC/Falix)
  const isDirectPlayback =
    provider === "falix" || isDirectVideoUrl(videoUrl || "") || !!fileUri;

  // ── Android two-step back guard with calm floating toast ──
  const lastBackPressRef = useRef(0);
  const [showBackToast, setShowBackToast] = useState(false);
  const backToastOpacity = useRef(new Animated.Value(0)).current;
  const backToastTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const onBackPress = () => {
      const now = Date.now();
      if (now - lastBackPressRef.current < 3000) {
        // Two back presses within 3s — close player
        nav.goBack({ fallback: "/(tabs)" });
        return true;
      }
      lastBackPressRef.current = now;

      // Trigger subtle back toast
      setShowBackToast(true);
      Animated.timing(backToastOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();

      if (backToastTimerRef.current) clearTimeout(backToastTimerRef.current);
      backToastTimerRef.current = setTimeout(() => {
        Animated.timing(backToastOpacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }).start(() => setShowBackToast(false));
      }, 2400);

      return true; // consume the event on first press
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onBackPress);
    return () => {
      sub.remove();
      if (backToastTimerRef.current) clearTimeout(backToastTimerRef.current);
    };
  }, [nav, backToastOpacity]);

  // Get the actual video URL (either remote or local file)
  const directVideoUrl = fileUri || videoUrl;

  if (!id || !type) {
    return (
      <View
        className="flex-1 items-center justify-center px-6"
        style={{ backgroundColor: colors.bg }}
      >
        <StatusBar barStyle="light-content" />
        <View
          className="w-16 h-16 rounded-2xl items-center justify-center mb-5 border"
          style={{
            backgroundColor: colors.bgCard,
            borderColor: colors.borderSubtle,
          }}
        >
          <Ionicons name="alert-circle-outline" size={32} color={colors.gold} />
        </View>
        <Text
          className="text-lg font-semibold mb-2 text-center"
          style={{ color: colors.textPrimary, fontFamily: "Inter_600SemiBold" }}
        >
          Invalid Video URL
        </Text>
        <Text
          className="text-sm text-center mb-6 leading-6 max-w-xs"
          style={{ color: colors.textSecondary }}
        >
          This link doesn't point to a valid movie or TV show.
        </Text>
        <TouchableOpacity
          onPress={() => nav.goBack({ fallback: "/(tabs)" })}
          className="rounded-xl py-3 px-8"
          style={{ backgroundColor: colors.gold }}
          activeOpacity={0.8}
        >
          <Text
            className="font-bold text-sm"
            style={{ color: colors.bg, fontFamily: "Inter_600SemiBold" }}
          >
            Go Back
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Route to HEVC player for direct video playback (Falix, local files)
  if (isDirectPlayback && directVideoUrl) {
    return (
      <View className="flex-1" style={{ backgroundColor: colors.playerBg }}>
        <StatusBar barStyle="light-content" hidden />
        <HevcPlayer
          videoUrl={directVideoUrl}
          tmdbId={id}
          mediaType={type}
          season={season}
          episode={episode}
          startAt={startAt}
          title={title}
          onClose={() => nav.goBack({ fallback: "/(tabs)" })}
        />
      </View>
    );
  }

  // Default: WebView player for streaming providers
  return (
    <View className="flex-1" style={{ backgroundColor: colors.playerBg }}>
      <StatusBar barStyle="light-content" hidden />
      <VideoWebView
        type={type}
        id={id}
        season={season}
        episode={episode}
        initialProvider={provider}
        backdropUrl={backdropUrl}
        isAnime={isAnime}
        animeMalId={animeMalId}
        animeAnilistId={animeAnilistId}
        animeAudio={animeAudio}
        onClose={() => nav.goBack({ fallback: "/(tabs)" })}
      />

      {/* Floating Android Back Guard Toast */}
      {showBackToast && (
        <Animated.View
          style={{
            position: "absolute",
            bottom: insets.bottom + 24,
            alignSelf: "center",
            opacity: backToastOpacity,
            zIndex: 9999,
          }}
          pointerEvents="none"
        >
          <View
            className="flex-row items-center px-4 py-2.5 rounded-full border shadow-lg"
            style={{
              backgroundColor: "rgba(14, 14, 17, 0.92)",
              borderColor: colors.borderSubtle,
            }}
          >
            <Ionicons
              name="arrow-back-circle-outline"
              size={16}
              color={colors.gold}
              style={{ marginRight: 8 }}
            />
            <Text
              className="text-xs font-medium"
              style={{ color: colors.textPrimary }}
            >
              Press back again to exit player
            </Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
}
