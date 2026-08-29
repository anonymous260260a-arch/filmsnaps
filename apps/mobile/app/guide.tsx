/**
 * Guide — focused help for FilmSnaps mobile.
 *
 * Purpose:
 *  1. Choosing and switching playback sources (servers).
 *  2. Downloading and playing back your downloads.
 *  3. Switching audio tracks in downloaded videos (via VLC).
 *
 * Reachable from Settings → "How to Use", and deep-linked from the player's
 * source picker (`?section=sources`). Section anchors are stable so in-app
 * links keep scrolling to the right help.
 */

import React, { useCallback, useRef, useEffect } from "react";
import { View, Text, ScrollView, Linking, Alert, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TouchableOpacity } from "react-native";
import { BackIcon } from "../components/Icons";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useSafeNavigation } from "@/lib/navigation";
import { colors } from "../theme/colors";

type SectionId = "sources" | "downloads" | "play-downloads" | "audio";

export default function GuideScreen() {
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const { section } = useLocalSearchParams<{ section?: string }>();

  // y-offset of each section, captured via onLayout so we can scroll-to-section.
  const sectionLayouts = useRef<Record<string, number>>({});

  const handleSectionLayout = useCallback((id: string, y: number) => {
    sectionLayouts.current[id] = y;
  }, []);

  // Scroll to a deep-linked section on mount.
  useEffect(() => {
    const id = section as SectionId | undefined;
    if (id && sectionLayouts.current[id] != null) {
      const y = sectionLayouts.current[id];
      setTimeout(() => {
        scrollRef.current?.scrollTo({ y, animated: true });
      }, 300);
    }
  }, [section]);

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
          <BackIcon width={20} height={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text
          style={{
            fontFamily: "PlayfairDisplay_700Bold",
            fontSize: 22,
            color: colors.textPrimary,
          }}
        >
          How to Use
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Gold accent */}
        <View
          className="w-16 h-0.5 mb-6"
          style={{ backgroundColor: colors.gold }}
        />

        {/* ── Playback sources ── */}
        <GuideSection
          icon="server-outline"
          title="Choosing & Switching Sources"
          sectionId="sources"
          onLayout={handleSectionLayout}
        >
          <GuideParagraph>
            FilmSnaps can stream from several providers. When you open a movie
            or show, the source listed at the bottom of the player ("source
            pill") is the one being used right now.
          </GuideParagraph>

          <GuideStep
            number={1}
            text={
              "While playing, tap the source pill at the bottom of the player" +
              " — or swipe up on it — to open the source list."
            }
          />
          <GuideStep
            number={2}
            text="The checkmark shows your currently active source. Tap any other source to switch."
          />
          <GuideStep
            number={3}
            text="Switching sources restarts playback from the last position you reached on that source."
          />
          <GuideStep
            number={4}
            text={
              "Can't connect to a source? While loading, the 'Source not responding'" +
              " message shows a 'Choose a source' button — tap it to pick another."
            }
          />
          <GuideNote text="You can set a preferred source in Settings → Default Source. If it isn't available, the next best source is used automatically." />
        </GuideSection>

        {/* ── Downloading ── */}
        <GuideSection
          icon="download-outline"
          title="Downloading"
          sectionId="downloads"
          onLayout={handleSectionLayout}
        >
          <GuideStep
            number={1}
            text="On a title's details page, tap the download button on a supported source."
          />
          <GuideStep
            number={2}
            text="Higher quality means a larger file. Keep Screen On while downloading."
          />
          <GuideStep
            number={3}
            text="Watch progress on the gold download indicator at the bottom of the tab bar, or open Library → Downloads."
          />
          <GuideStep
            number={4}
            text="When a download finishes, it's saved to your device's Downloads folder and appears in the Downloads list with a green check."
          />
          <GuideNote text="Download over Wi-Fi where possible. Your 'Download Speed Limit' setting in Settings controls how fast downloads run." />
        </GuideSection>

        {/* ── Playing downloads ── */}
        <GuideSection
          icon="play-outline"
          title="Playing Your Downloads"
          sectionId="play-downloads"
          onLayout={handleSectionLayout}
        >
          <GuideStep
            number={1}
            text="Open Library → Downloads and tap any completed download to play it in-app."
          />
          <GuideStep
            number={2}
            text="Files stored as MKV play in-app, but for full codec support and audio/subtitle track control, open them in VLC (see the VLC button on each download)."
          />
          <GuideStep
            number={3}
            text="Downloads stay on your device after closing the app — they play offline anytime."
          />
          <GuideNote text="You can share or delete a download from its row in the Downloads list." />
        </GuideSection>

        {/* ── Audio tracks ── */}
        <GuideSection
          icon="volume-high-outline"
          title="Changing Audio Tracks"
          sectionId="audio"
          onLayout={handleSectionLayout}
        >
          <GuideParagraph>
            Filmsnaps plays downloads in-app, but the in-app player doesn't
            expose per-track audio selection. For videos with multiple audio
            tracks (different languages, commentary, or surround), open the file
            in VLC instead, which gives full audio-track control.
          </GuideParagraph>

          <GuideStep
            number={1}
            text="On a completed download in Library → Downloads, tap the VLC button."
          />
          <GuideStep
            number={2}
            text={
              "During playback in VLC, tap the screen to show the controls, then" +
              " tap the speaker / audio icon."
            }
          />
          <GuideStep
            number={3}
            text="Select your preferred track from the list. VLC remembers your choice for that file."
          />
          <GuideNote text="If the VLC button isn't shown, the download plays in-app only — it has a single audio track or isn't an MKV." />
          <GuideLink
            text="Get VLC for Mobile"
            url={
              Platform.select({
                android:
                  "https://play.google.com/store/apps/details?id=org.videolan.vlc",
                ios: "https://apps.apple.com/app/vlc-for-mobile/id650377962",
                default: "https://www.videolan.org/vlc/",
              }) ?? undefined
            }
          />
        </GuideSection>
      </ScrollView>
    </View>
  );
}

// ── Sub-components ──

function GuideSection({
  icon,
  title,
  children,
  sectionId,
  onLayout,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  children: React.ReactNode;
  sectionId?: string;
  onLayout?: (sectionId: string, y: number) => void;
}) {
  return (
    <View
      nativeID={sectionId}
      className="mb-6"
      style={{
        backgroundColor: colors.bgSurface,
        borderWidth: 0.5,
        borderColor: colors.border,
      }}
      onLayout={
        sectionId && onLayout
          ? (e) => onLayout(sectionId, e.nativeEvent.layout.y)
          : undefined
      }
    >
      {/* Section header */}
      <View className="flex-row items-center px-4 pt-4 pb-3">
        <View
          className="w-8 h-8 rounded-lg items-center justify-center mr-2.5"
          style={{ backgroundColor: colors.goldButtonText }}
        >
          <Ionicons name={icon} size={16} color={colors.gold} />
        </View>
        <Text
          className="text-sm font-bold"
          style={{ color: colors.textPrimary }}
        >
          {title}
        </Text>
      </View>

      {/* Content */}
      <View className="px-4 pb-4">{children}</View>
    </View>
  );
}

function GuideStep({ number, text }: { number: number; text: string }) {
  return (
    <View className="flex-row items-start mb-2">
      <View
        className="w-5 h-5 rounded-full items-center justify-center mr-2.5 mt-0.5"
        style={{ backgroundColor: colors.gold }}
      >
        <Text className="text-[10px] font-bold" style={{ color: colors.bg }}>
          {number}
        </Text>
      </View>
      <Text
        className="text-sm leading-5 flex-1"
        style={{ color: colors.textSecondary }}
      >
        {text}
      </Text>
    </View>
  );
}

function GuideParagraph({ children }: { children: React.ReactNode }) {
  return (
    <Text
      className="text-sm leading-5 mb-3"
      style={{ color: colors.textSecondary }}
    >
      {children}
    </Text>
  );
}

function GuideLink({ text, url }: { text: string; url?: string }) {
  const handlePress = useCallback(() => {
    if (!url) return;
    Linking.openURL(url).catch(() => Alert.alert("Could not open link"));
  }, [url]);

  return (
    <TouchableOpacity
      onPress={handlePress}
      className="self-start mt-1"
      activeOpacity={0.7}
      accessibilityRole="link"
    >
      <Text
        className="text-sm"
        style={{ color: colors.gold, textDecorationLine: "underline" }}
      >
        {text}
      </Text>
    </TouchableOpacity>
  );
}

function GuideNote({ text }: { text: string }) {
  return (
    <View className="flex-row items-start mt-1 pl-7">
      <Ionicons
        name="information-circle-outline"
        size={14}
        color={colors.textTertiary}
        style={{ marginRight: 6, marginTop: 2 }}
      />
      <Text
        className="text-xs leading-4 flex-1"
        style={{ color: colors.textTertiary }}
      >
        {text}
      </Text>
    </View>
  );
}
