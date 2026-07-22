/**
 * Guide — How to use FilmSnaps, play downloaded videos, use VLC for MKV,
 * change audio tracks, and more.
 */

import React, { useCallback } from 'react';
import { View, Text, ScrollView, Linking, Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';

export default function GuideScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1" style={{ backgroundColor: '#070708', paddingTop: insets.top }}>
      {/* Header */}
      <View className="px-5 pt-4 pb-2 flex-row items-center">
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-9 h-9 rounded-full bg-zinc-800/60 items-center justify-center mr-3"
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={20} color="#F4F4F5" />
        </TouchableOpacity>
        <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, color: '#F4F4F5' }}>
          How to Use
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Gold accent */}
        <View className="w-16 h-0.5 mb-6" style={{ backgroundColor: '#D4A237' }} />

        {/* ── Getting Started ── */}
        <GuideSection
          icon="compass-outline"
          title="Getting Started"
        >
          <GuideStep number={1} text="Open FilmSnaps and browse or search for your favorite movies and TV shows." />
          <GuideStep number={2} text="Tap on any title to view details, available streaming servers, and related content." />
          <GuideStep number={3} text="Use the bottom tabs to switch between Home, Search, and Settings." />
        </GuideSection>

        {/* ── Watching Content ── */}
        <GuideSection
          icon="play-circle-outline"
          title="Watching Content"
        >
          <GuideStep number={1} text={'Open a movie or TV show and tap "Watch" to start streaming.'} />
          <GuideStep number={2} text="If multiple servers are available, the top one in your server order is tried first." />
          <GuideStep number={3} text="Use the player controls to play, pause, seek, or go fullscreen." />
          <GuideNote text="For TV shows, select the season and episode before starting playback." />
        </GuideSection>

        {/* ── Downloading Content ── */}
        <GuideSection
          icon="download-outline"
          title="Downloading Content"
        >
          <GuideStep number={1} text="Open a movie or TV show and tap the download button next to a supported server." />
          <GuideStep number={2} text="Choose your preferred quality (higher quality = larger file)." />
          <GuideStep number={3} text="Track download progress from the gold indicator at the bottom of the screen, or open the Downloads page from Settings." />
          <GuideStep number={4} text="Once complete, tap the download to view or share the file." />
          <GuideNote text="Download over Wi-Fi to save mobile data. You can enable download over cellular in your settings." />
        </GuideSection>

        {/* ── Playing MKV Files with VLC ── */}
        <GuideSection
          icon="videocam-outline"
          title="Playing MKV Files with VLC"
        >
          <GuideParagraph>
            Some downloaded files (especially MKV) contain high-quality video with multiple audio
            tracks and subtitle streams. The best way to play these files is with
            {' '}<GuideLink text="VLC for Mobile" />
            {' '}— a free, open-source media player.
          </GuideParagraph>
          <GuideSubStep number={1} text="Install VLC for Mobile from your app store (free, no ads)." />
          <GuideSubStep number={2} text={'Open VLC and navigate to the "Files" or "Downloads" section.'} />
          <GuideSubStep number={3} text="Find your downloaded file (tap Downloads in FilmSnaps to see the file location)." />
          <GuideSubStep number={4} text="Tap the file in VLC to play with full codec support." />
        </GuideSection>

        {/* ── Changing Audio Tracks ── */}
        <GuideSection
          icon="volume-high-outline"
          title="Changing Audio Tracks"
        >
          <GuideParagraph>
            Videos with multiple audio tracks (different languages, commentary, or 5.1 surround)
            let you switch between them during playback:
          </GuideParagraph>
          <GuideStep number={1} text="While playing a video in VLC, tap the screen to show the on-screen controls." />
          <GuideStep number={2} text="Tap the audio / speaker icon to open the audio track selector." />
          <GuideStep number={3} text="Choose your preferred audio track from the list." />
          <GuideNote text="VLC remembers your audio track preference for each file." />
        </GuideSection>

        {/* ── Tips ── */}
        <GuideSection
          icon="bulb-outline"
          title="Tips"
        >
          <Tip text="Use the gold download indicator at the bottom of the tab bar to check active downloads at a glance." />
          <Tip text="You can set a default streaming server in Settings → Default Server." />
          <Tip text="Visit the Downloads page from Settings → Downloads to manage or share completed files." />
          <Tip text="Completed downloads are stored on your device and can be watched offline anytime." />
        </GuideSection>
      </ScrollView>
    </View>
  );
}

// ── Sub-components ──

function GuideSection({ icon, title, children }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mb-6" style={{ backgroundColor: '#0E0E11', borderRadius: 12, borderWidth: 0.5, borderColor: '#1f1f1f' }}>
      {/* Section header */}
      <View className="flex-row items-center px-4 pt-4 pb-3">
        <View className="w-8 h-8 rounded-lg items-center justify-center mr-2.5" style={{ backgroundColor: '#D4A23720' }}>
          <Ionicons name={icon} size={16} color="#D4A237" />
        </View>
        <Text
          className="text-sm font-bold"
          style={{ color: '#F4F4F5' }}
        >
          {title}
        </Text>
      </View>

      {/* Content */}
      <View className="px-4 pb-4">
        {children}
      </View>
    </View>
  );
}

function GuideStep({ number, text }: { number: number; text: string }) {
  return (
    <View className="flex-row items-start mb-2">
      <View className="w-5 h-5 rounded-full items-center justify-center mr-2.5 mt-0.5" style={{ backgroundColor: '#D4A237' }}>
        <Text className="text-[10px] font-bold" style={{ color: '#070708' }}>{number}</Text>
      </View>
      <Text className="text-sm leading-5 flex-1" style={{ color: '#D4D4D8' }}>{text}</Text>
    </View>
  );
}

function GuideSubStep({ number, text }: { number: number; text: string }) {
  return (
    <View className="flex-row items-start mb-1.5">
      <Text className="text-[10px] font-bold mr-2 mt-0.5" style={{ color: '#D4A237' }}>{`0${number}`}</Text>
      <Text className="text-sm leading-5 flex-1" style={{ color: '#D4D4D8' }}>{text}</Text>
    </View>
  );
}

function GuideParagraph({ children }: { children: React.ReactNode }) {
  return (
    <Text className="text-sm leading-5 mb-3" style={{ color: '#D4D4D8' }}>
      {children}
    </Text>
  );
}

function GuideLink({ text, url }: { text: string; url?: string }) {
  const handlePress = useCallback(() => {
    const target = url || Platform.select({
      android: 'https://play.google.com/store/apps/details?id=org.videolan.vlc',
      ios: 'https://apps.apple.com/app/vlc-for-mobile/id650377962',
      default: 'https://www.videolan.org/vlc/',
    });
    Linking.openURL(target!).catch(() => Alert.alert('Could not open link'));
  }, [url]);

  return (
    <Text
      className="text-sm"
      style={{ color: '#D4A237', textDecorationLine: 'underline' }}
      onPress={handlePress}
    >
      {text}
    </Text>
  );
}

function GuideNote({ text }: { text: string }) {
  return (
    <View className="flex-row items-start mt-1 pl-7">
      <Ionicons name="information-circle-outline" size={14} color="#52525b" style={{ marginRight: 6, marginTop: 2 }} />
      <Text className="text-xs leading-4 flex-1" style={{ color: '#52525b' }}>{text}</Text>
    </View>
  );
}

function Tip({ text }: { text: string }) {
  return (
    <View className="flex-row items-start mb-2">
      <Text className="text-xs mr-2 mt-0.5" style={{ color: '#D4A237' }}>✦</Text>
      <Text className="text-sm leading-5 flex-1" style={{ color: '#D4D4D8' }}>{text}</Text>
    </View>
  );
}
