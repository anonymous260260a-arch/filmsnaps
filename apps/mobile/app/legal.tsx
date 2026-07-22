/**
 * Legal & DMCA — Disclaimer page accessible from Settings.
 *
 * Note: The first-time legal gate is handled inline in _layout.tsx
 * (LegalGate component). This screen is only shown from Settings
 * after the user has already accepted.
 */

import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

export default function LegalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1" style={{ backgroundColor: '#070708', paddingTop: insets.top }}>
      {/* Header with back button */}
      <View className="px-5 pt-4 pb-2 flex-row items-center">
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-9 h-9 rounded-full bg-zinc-800/60 items-center justify-center mr-3"
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={20} color="#F4F4F5" />
        </TouchableOpacity>
        <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, color: '#F4F4F5' }}>
          Legal & Disclaimer
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="w-16 h-0.5 mb-5" style={{ backgroundColor: '#D4A237' }} />

        <Section title="Content Notice">
          <Body>
            FilmSnaps does <Bold>not</Bold> host, store, upload, or manage any video content, files,
            or media. All content accessed through this application is hosted by third-party services
            that are not affiliated with us.
          </Body>
        </Section>

        <Section title="No Affiliation">
          <Body>
            We do not own, operate, or have any access to the servers that host the content you
            stream or download through this app. Any legal concerns regarding specific content must be
            directed to the actual content hosters and uploaders.
          </Body>
        </Section>

        <Section title="Educational & Security Purpose">
          <Body>
            This project is created for <Bold>educational purposes only</Bold>. It demonstrates
            open-source development, legal ad-blocking for user privacy, and secure media streaming.
          </Body>
        </Section>

        <Section title="User Responsibility">
          <Body>As a user, you are responsible for:</Body>
          <Bullet text="Ensuring your use complies with local laws" />
          <Bullet text="Using the app only for content you have the legal right to access" />
          <Bullet text="Not redistributing content for commercial purposes" />
        </Section>

        <Section title="No Warranty">
          <Body>
            This software is provided "as is" without warranty of any kind. The developers
            and contributors are not responsible for any damages or legal issues that may arise from
            the use of this application.
          </Body>
        </Section>
      </ScrollView>
    </View>
  );
}

// ── Sub-components ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-5">
      <Text className="text-sm font-semibold mb-2" style={{ color: '#D4A237', fontFamily: 'Inter_600SemiBold' }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Body({ children, extraMargin }: { children: React.ReactNode; extraMargin?: boolean }) {
  return (
    <Text className={`text-sm leading-6 ${extraMargin ? 'mt-3' : ''}`} style={{ color: '#D4D4D8' }}>
      {children}
    </Text>
  );
}

function Bold({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontFamily: 'Inter_600SemiBold', color: '#F4F4F5' }}>{children}</Text>;
}

function Bullet({ text }: { text: string }) {
  return (
    <View className="flex-row items-start mt-2">
      <Text className="text-[10px] mt-1.5 mr-2.5" style={{ color: '#D4A237' }}>■</Text>
      <Text className="text-sm leading-5 flex-1" style={{ color: '#D4D4D8' }}>{text}</Text>
    </View>
  );
}
