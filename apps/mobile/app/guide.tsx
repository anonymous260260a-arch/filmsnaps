/**
 * Guide — focused help for FilmSnaps mobile.
 *
 * Purpose:
 *  1. Choosing and switching playback sources (servers).
 *  2. Downloading and playing back your downloads.
 *  3. Switching audio tracks in downloaded videos (via VLC).
 *
 * Reachable from Settings → "User guide", and deep-linked from the player's
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

const CONTENT_INDENT = 18 + 12; // step number column + gap

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
      style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 20,
        }}
      >
        <TouchableOpacity
          onPress={() => nav.goBack({ fallback: "/(tabs)" })}
          activeOpacity={0.7}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: colors.zincBg,
            alignItems: "center",
            justifyContent: "center",
            marginRight: 12,
          }}
        >
          <BackIcon width={20} height={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text
          style={{
            fontFamily: "PlayfairDisplay_700Bold",
            fontSize: 22,
            lineHeight: 26,
            color: colors.textPrimary,
          }}
        >
          How to use
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Playback sources ── */}
        <GuideSection
          icon="server-outline"
          title="Choosing and switching sources"
          sectionId="sources"
          onLayout={handleSectionLayout}
        >
          <GuideParagraph>
            FilmSnaps can stream from more than one provider. The pill at the
            bottom of the player shows the one in use right now.
          </GuideParagraph>

          <GuideStep
            number={1}
            text="Tap the source pill at the bottom of the player, or swipe up on it, to open the source list."
          />
          <GuideStep
            number={2}
            text="The checkmark marks the active source. Tap another source to switch."
          />
          <GuideStep
            number={3}
            text="Playback resumes from the last position you reached on that source."
          />
          <GuideStep
            number={4}
            text="If a source does not respond, the loading screen offers Choose a source."
          />
          <GuideNote text="Set a preferred source in Settings → Streaming source. When it is unavailable, the next best source is used." />
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
            text="On a title's page, tap the download button on a supported source."
          />
          <GuideStep
            number={2}
            text="Higher quality means a larger file. Keep the screen on while downloading."
          />
          <GuideStep
            number={3}
            text="Progress appears on the gold indicator at the bottom of the tab bar. The file list is under Library → Downloads."
          />
          <GuideStep
            number={4}
            text="Finished downloads are saved to your device's Downloads folder and show a green check."
          />
          <GuideNote text="Download over Wi-Fi where possible. The speed limit is in Settings → Speed limit." />
        </GuideSection>

        {/* ── Playing downloads ── */}
        <GuideSection
          icon="play-outline"
          title="Playing your downloads"
          sectionId="play-downloads"
          onLayout={handleSectionLayout}
        >
          <GuideStep
            number={1}
            text="Open Library → Downloads and tap a finished download to play it in-app."
          />
          <GuideStep
            number={2}
            text="MKV files play in-app, but VLC gives full codec and audio-track support. Use the VLC button on the download."
          />
          <GuideStep
            number={3}
            text="Downloads stay on the device after the app closes and play offline."
          />
          <GuideNote text="Share or delete a download from its row in the Downloads list." />
        </GuideSection>

        {/* ── Audio tracks ── */}
        <GuideSection
          icon="volume-high-outline"
          title="Changing audio tracks"
          sectionId="audio"
          onLayout={handleSectionLayout}
        >
          <GuideParagraph>
            The in-app player does not expose per-track audio selection. For
            files with several audio tracks, open them in VLC instead.
          </GuideParagraph>

          <GuideStep
            number={1}
            text="On a finished download in Library → Downloads, tap the VLC button."
          />
          <GuideStep
            number={2}
            text="In VLC, tap the screen to show the controls, then tap the speaker icon."
          />
          <GuideStep
            number={3}
            text="Pick a track from the list. VLC remembers the choice for that file."
          />
          <GuideNote text="No VLC button means the file plays in-app only: it has a single audio track or is not an MKV." />
          <GuideLink
            text="Get VLC for mobile"
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
      style={{
        backgroundColor: colors.bgSurface,
        borderRadius: 14,
        borderWidth: 0.5,
        borderColor: colors.borderSubtle,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 16,
        marginBottom: 16,
      }}
      onLayout={
        sectionId && onLayout
          ? (e) => onLayout(sectionId, e.nativeEvent.layout.y)
          : undefined
      }
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <Ionicons name={icon} size={18} color={colors.zinc500} />
        <Text
          style={{
            fontSize: 15,
            lineHeight: 20,
            fontFamily: "Inter_500Medium",
            color: colors.textPrimary,
            flex: 1,
          }}
        >
          {title}
        </Text>
      </View>

      {children}
    </View>
  );
}

function GuideStep({ number, text }: { number: number; text: string }) {
  return (
    <View style={{ flexDirection: "row", marginBottom: 10 }}>
      <Text
        style={{
          width: 18,
          marginRight: 12,
          marginTop: 1,
          fontSize: 12,
          lineHeight: 20,
          fontFamily: "Inter_500Medium",
          color: colors.textTertiary,
          fontVariant: ["tabular-nums"],
        }}
      >
        {number}
      </Text>
      <Text
        style={{
          flex: 1,
          fontSize: 14,
          lineHeight: 21,
          fontFamily: "Inter_400Regular",
          color: colors.textSecondary,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

function GuideParagraph({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontSize: 14,
        lineHeight: 21,
        fontFamily: "Inter_400Regular",
        color: colors.textSecondary,
        marginBottom: 14,
      }}
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
      activeOpacity={0.7}
      accessibilityRole="link"
      style={{
        alignSelf: "flex-start",
        marginTop: 12,
        marginLeft: CONTENT_INDENT,
      }}
    >
      <Text
        style={{
          fontSize: 14,
          fontFamily: "Inter_500Medium",
          color: colors.gold,
        }}
      >
        {text}
      </Text>
    </TouchableOpacity>
  );
}

function GuideNote({ text }: { text: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        marginTop: 4,
        marginLeft: CONTENT_INDENT,
      }}
    >
      <Ionicons
        name="information-circle-outline"
        size={14}
        color={colors.textTertiary}
        style={{ marginRight: 6, marginTop: 2 }}
      />
      <Text
        style={{
          flex: 1,
          fontSize: 12,
          lineHeight: 18,
          fontFamily: "Inter_400Regular",
          color: colors.textTertiary,
        }}
      >
        {text}
      </Text>
    </View>
  );
}
