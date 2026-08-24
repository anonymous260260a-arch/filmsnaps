import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  BackHandler,
  Platform,
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

  // ── Android two-step back guard ──
  const lastBackPressRef = useRef(0);
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
      return true; // consume the event on first press too
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onBackPress);
    return () => sub.remove();
  }, [nav]);

  // Get the actual video URL (either remote or local file)
  const directVideoUrl = fileUri || videoUrl;

  if (!id || !type) {
    return (
      <View
        className="flex-1 items-center justify-center bg-void px-6"
        style={{ backgroundColor: colors.bg }}
      >
        <StatusBar barStyle="light-content" />
        <View className="w-16 h-16 rounded-full bg-elevated items-center justify-center mb-5">
          <Ionicons
            name="alert-circle-outline"
            size={36}
            color={colors.textTertiary}
          />
        </View>
        <Text className="text-text-primary text-lg font-semibold mb-2">
          Invalid video URL
        </Text>
        <Text className="text-text-tertiary text-sm text-center mb-6 leading-5">
          This link doesn't point to a valid movie or TV show.
        </Text>
        <TouchableOpacity
          onPress={() => nav.goBack({ fallback: "/(tabs)" })}
          className="bg-primary rounded-xl py-3 px-8"
          activeOpacity={0.8}
        >
          <Text className="text-void font-bold text-base">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Route to HEVC player for direct video playback (Falix, local files)
  if (isDirectPlayback && directVideoUrl) {
    return (
      <View
        className="flex-1 bg-black"
        style={{ backgroundColor: colors.playerBg }}
      >
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
    <View
      className="flex-1 bg-black"
      style={{ backgroundColor: colors.playerBg }}
    >
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
    </View>
  );
}
