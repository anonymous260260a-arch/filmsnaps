import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useFonts,
  PlayfairDisplay_700Bold,
} from '@expo-google-fonts/playfair-display';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import { UpdateOverlay } from '../components/UpdateOverlay';
import { DownloadInfraProvider, useDownloadQueue } from '../lib/download';
import { SettingsProvider, useSettings } from '../lib/settings';
import { hydrateQueryClient, startPersistLoop } from '../lib/queryCache';
import './globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    PlayfairDisplay_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  const persistedRef = useRef(false);

  useEffect(() => {
    if (persistedRef.current) return;
    persistedRef.current = true;

    // Hydrate from disk cache on cold launch
    hydrateQueryClient(queryClient).finally(() => {
      // Start periodic persistence
      startPersistLoop(queryClient);
    });
  }, []);

  if (!fontsLoaded) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: '#070708' }}>
        <ActivityIndicator size="large" color="#D4A237" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#070708' }}>
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <DownloadInfraProvider>
        <SettingsProvider>
          <AppContent />
        </SettingsProvider>
        </DownloadInfraProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
    </View>
  );
}

/**
 * AppContent — Renders inside all providers so it can use useSettings().
 *
 * The Stack navigator is ALWAYS mounted so the navigation tree never
 * tears down. On first launch, the LegalGate renders as a full-screen
 * overlay on top. Once accepted, the overlay fades away cleanly.
 */
function AppContent() {
  const { settings, loaded: settingsLoaded } = useSettings();

  // Download queue runs for the lifetime of the app (not just while
  // the Downloads page is visible) so in-flight downloads continue
  // processing when the user navigates elsewhere.
  useDownloadQueue({ maxConcurrent: 3 });

  if (!settingsLoaded) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: '#070708' }}>
        <ActivityIndicator size="large" color="#D4A237" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#070708' },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ contentStyle: { backgroundColor: '#070708' } }} />
        <Stack.Screen
          name="movie/[id]"
          options={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#070708' } }}
        />
        <Stack.Screen
          name="tv/[id]"
          options={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#070708' } }}
        />
        <Stack.Screen
          name="watch/[...id]"
          options={{
            headerShown: false,
            animation: 'slide_from_bottom',
            presentation: 'fullScreenModal',
            contentStyle: { backgroundColor: '#000' },
          }}
        />
        {/* Download management pages */}
        <Stack.Screen
          name="downloads"
          options={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#070708' } }}
        />
        <Stack.Screen
          name="history"
          options={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#070708' } }}
        />
        <Stack.Screen
          name="saved"
          options={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#070708' } }}
        />
        {/* download/[...id] - kept in codebase, only registered in dev builds */}
        {__DEV__ && (
          <Stack.Screen
            name="download/[...id]"
            options={{
              headerShown: false,
              animation: 'slide_from_bottom',
              presentation: 'fullScreenModal',
              contentStyle: { backgroundColor: '#000' },
            }}
          />
        )}
        <Stack.Screen
          name="download/nxsha/[...id]"
          options={{
            headerShown: false,
            animation: 'slide_from_bottom',
            presentation: 'fullScreenModal',
            contentStyle: { backgroundColor: '#000' },
          }}
        />
        <Stack.Screen
          name="download/falix/[...id]"
          options={{
            headerShown: false,
            animation: 'slide_from_bottom',
            presentation: 'fullScreenModal',
            contentStyle: { backgroundColor: '#000' },
          }}
        />
        <Stack.Screen
          name="download2/[...id]"
          options={{
            headerShown: false,
            animation: 'slide_from_bottom',
            presentation: 'fullScreenModal',
            contentStyle: { backgroundColor: '#000' },
          }}
        />
        <Stack.Screen
          name="person/[id]"
          options={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#070708' } }}
        />
        <Stack.Screen
          name="list/[category]"
          options={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#070708' } }}
        />
        <Stack.Screen
          name="browse"
          options={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#070708' } }}
        />
        <Stack.Screen
          name="legal"
          options={{
            headerShown: false,
            animation: 'slide_from_bottom',
            presentation: 'fullScreenModal',
            contentStyle: { backgroundColor: '#070708' },
          }}
        />
        <Stack.Screen
          name="guide"
          options={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#070708' } }}
        />
        {/* experimental/[...id] - Nuvio provider test page (dev only) */}
        {__DEV__ && (
          <Stack.Screen
            name="experimental/index"
            options={{
              headerShown: false,
              animation: 'slide_from_right',
              contentStyle: { backgroundColor: '#070708' },
            }}
          />
        )}
        <Stack.Screen
          name="privacy"
          options={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#070708' } }}
        />
      </Stack>

      <UpdateOverlay />

      {/* Legal overlay — native Modal on first launch */}
      <Modal visible={!settings.legalAccepted} animationType="none" transparent={false}>
        <LegalGate />
      </Modal>
    </>
  );
}

/**
 * LegalGate — Inline legal disclaimer shown on first app launch.
 * Rendered as a React component (not a navigated screen) so accepting
 * simply updates state, causing the parent to re-render with the Stack.
 */
function LegalGate() {
  const insets = useSafeAreaInsets();
  const { updateSetting } = useSettings();

  const handleAccept = useCallback(() => {
    updateSetting('legalAccepted', true);
  }, [updateSetting]);

  return (
    <View className="flex-1" style={{ backgroundColor: '#070708', paddingTop: insets.top }}>
      {/* Header */}
      <View className="px-5 pt-4 pb-2">
        <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, color: '#F4F4F5' }}>
          Legal & Disclaimer
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Accent line */}
        <View className="w-16 h-0.5 mb-5" style={{ backgroundColor: '#D4A237' }} />

        {/* Section 1 */}
        <GateSection title="Content Notice">
          <GateBody>
            FilmSnaps does <GateBold>not</GateBold> host, store, upload, or manage any video content,
            files, or media. All content accessed through this application is hosted by third-party
            services that are not affiliated with us.
          </GateBody>
        </GateSection>

        {/* Section 2 */}
        <GateSection title="No Affiliation">
          <GateBody>
            We do not own, operate, or have any access to the servers that host the content you
            stream or download through this app. We do not control what content is available, how it
            is stored, or who has access to it. Any legal concerns regarding specific content must be
            directed to the actual content hosters and uploaders.
          </GateBody>
        </GateSection>

        {/* Section 3 */}
        <GateSection title="Educational & Security Purpose">
          <GateBody>
            This project is created for <GateBold>educational purposes only</GateBold>. It demonstrates
            open-source software development, ad-blocking technology that is entirely legal and
            protects user privacy, modern mobile application architecture, and secure media streaming
            patterns.
          </GateBody>
          <GateBody extraMargin>
            The ad-blocking features protect users from malicious advertisements, trackers, and
            intrusive pop-ups commonly found on third-party websites.
          </GateBody>
        </GateSection>

        {/* Section 4 */}
        <GateSection title="User Responsibility">
          <GateBody>As a user of this application, you are responsible for:</GateBody>
          <GateBullet text="Ensuring your use complies with local laws in your jurisdiction" />
          <GateBullet text="Using the app only for accessing content you have the legal right to access" />
          <GateBullet text="Not redistributing downloaded content or using it for commercial purposes" />
        </GateSection>

        {/* Section 5 */}
        <GateSection title="No Warranty">
          <GateBody>
            This software is provided "as is" without warranty of any kind. The developers and
            contributors are not responsible for any damages or legal issues that may arise from the
            use of this application.
          </GateBody>
        </GateSection>
      </ScrollView>

      {/* Fixed Accept Button */}
      <View
        className="absolute bottom-0 left-0 right-0 px-5 pt-2"
        style={{ backgroundColor: '#070708', paddingBottom: insets.bottom + 16 }}
      >
        <TouchableOpacity
          onPress={handleAccept}
          activeOpacity={0.8}
          className="w-full py-3.5 rounded-xl items-center"
          style={{ backgroundColor: '#D4A237' }}
        >
          <Text className="text-sm font-bold" style={{ color: '#070708', fontFamily: 'Inter_600SemiBold' }}>
            I Understand & Continue
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ── Legal Gate sub-components ── */

function GateSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-5">
      <Text className="text-sm font-semibold mb-2" style={{ color: '#D4A237', fontFamily: 'Inter_600SemiBold' }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function GateBody({ children, extraMargin }: { children: React.ReactNode; extraMargin?: boolean }) {
  return (
    <Text className={`text-sm leading-6 ${extraMargin ? 'mt-3' : ''}`} style={{ color: '#D4D4D8' }}>
      {children}
    </Text>
  );
}

function GateBold({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontFamily: 'Inter_600SemiBold', color: '#F4F4F5' }}>{children}</Text>;
}

function GateBullet({ text }: { text: string }) {
  return (
    <View className="flex-row items-start mt-2">
      <Text className="text-[10px] mt-1.5 mr-2.5" style={{ color: '#D4A237' }}>
        ■
      </Text>
      <Text className="text-sm leading-5 flex-1" style={{ color: '#D4D4D8' }}>
        {text}
      </Text>
    </View>
  );
}
