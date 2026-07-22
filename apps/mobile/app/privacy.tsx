/**
 * Privacy Policy — Full privacy disclosure for FilmSnaps.
 *
 * Explains what data is / isn't collected, how it's stored,
 * and the app's commitment to user privacy.
 */

import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

export default function PrivacyScreen() {
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
          Privacy Policy
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="w-16 h-0.5 mb-5" style={{ backgroundColor: '#D4A237' }} />

        <PBody>
          Last updated: July 2026
        </PBody>

        <PSection title="Data Collection">
          <PBody>
            FilmSnaps does <PBold>not</PBold> collect, store, or transmit any personal data to
            external servers. The app is designed with a privacy-first approach — everything stays
            on your device.
          </PBody>
        </PSection>

        <PSection title="What We Store Locally">
          <PBody>The following data is stored exclusively on your device:</PBody>
          <PBullet text="Watch history — movies and TV shows you have watched" />
          <PBullet text="Saved/bookmarked content — your personal watchlist" />
          <PBullet text="Downloaded files — content you have saved for offline viewing" />
          <PBullet text="App settings — your preferences (server selection, subtitle options, etc.)" />
          <PBullet text="Search queries — recent searches" />
        </PSection>

        <PSection title="How Data Is Stored">
          <PBody>
            All local data is stored using your device's internal storage and standard
            operating-system APIs (AsyncStorage and the file system). No data is encrypted
            beyond what the operating system provides by default. We recommend enabling
            device-level encryption in your phone's security settings.
          </PBody>
        </PSection>

        <PSection title="Third-Party Content Servers">
          <PBody>
            When you stream or download content, your requests are sent directly to third-party
            content servers that are not affiliated with FilmSnaps. These servers may log your
            IP address and request details as part of their normal operation. FilmSnaps has no
            control over and assumes no responsibility for the data practices of these third parties.
          </PBody>
        </PSection>

        <PSection title="No Tracking or Analytics">
          <PBody>
            FilmSnaps does not include any analytics SDKs, tracking pixels, or third-party
            monitoring tools. We do not collect usage statistics, crash reports, or any
            telemetry data. There are no advertisements in the app.
          </PBody>
        </PSection>

        <PSection title="Data Sharing">
          <PBody>
            Since we collect no personal data, we share no personal data. We do not sell,
            trade, or transfer any information to third parties.
          </PBody>
        </PSection>

        <PSection title="Children's Privacy">
          <PBody>
            FilmSnaps is not directed at children under 13. We do not knowingly collect any
            information from children. If you believe a child has provided personal data
            through the app, contact us immediately.
          </PBody>
        </PSection>

        <PSection title="Changes to This Policy">
          <PBody>
            We may update this privacy policy from time to time. Changes will be reflected
            with an updated "Last updated" date at the top of this page.
          </PBody>
        </PSection>

        <PSection title="Contact">
          <PBody>
            If you have questions about this privacy policy, please reach out via email at
            privacy@filmsnaps.app.
          </PBody>
        </PSection>
      </ScrollView>
    </View>
  );
}

// ── Sub-components ──

function PSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-5">
      <Text className="text-sm font-semibold mb-2" style={{ color: '#D4A237', fontFamily: 'Inter_600SemiBold' }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function PBody({ children }: { children: React.ReactNode }) {
  return (
    <Text className="text-sm leading-6" style={{ color: '#D4D4D8' }}>
      {children}
    </Text>
  );
}

function PBold({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontFamily: 'Inter_600SemiBold', color: '#F4F4F5' }}>{children}</Text>;
}

function PBullet({ text }: { text: string }) {
  return (
    <View className="flex-row items-start mt-2">
      <Text className="text-[10px] mt-1.5 mr-2.5" style={{ color: '#D4A237' }}>■</Text>
      <Text className="text-sm leading-5 flex-1" style={{ color: '#D4D4D8' }}>{text}</Text>
    </View>
  );
}
