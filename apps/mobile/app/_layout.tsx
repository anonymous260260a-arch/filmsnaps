import React, { useEffect, useRef, useState } from "react";
import { View, ActivityIndicator, Modal, BackHandler } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack } from "expo-router";
import { safeGoBack, resetNavigationInterlock } from "../lib/navigation";
import { initLongTaskMonitor } from "../lib/performance/long-task-monitor";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useFonts,
  PlayfairDisplay_700Bold,
} from "@expo-google-fonts/playfair-display";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from "@expo-google-fonts/inter";
import { UpdateOverlay } from "../components/UpdateOverlay";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { DownloadInfraProvider, useDownloadQueue } from "../lib/download";
import { migrateDownloads, isMigrationDone } from "../lib/download/migration";
import { SettingsProvider, useSettings } from "../lib/settings";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import {
  asyncStoragePersister,
  isPersistableQuery,
} from "../lib/queryPersister";
import { DownloadToastView } from "../components/DownloadToast";
import LegalGate from "../components/LegalGate";
import { colors } from "../theme/colors";
import "./globals.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5, // safety net — overridden per-hook for TMDB queries
      gcTime: Infinity, // never GC mid-session; disk bounded by maxAge
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

  // FIX: Font loading timeout — prevents infinite spinner if fonts fail to load
  const [fontsTimedOut, setFontsTimedOut] = useState(false);

  useEffect(() => {
    if (fontsLoaded) return;
    const timer = setTimeout(() => {
      if (!fontsLoaded) {
        console.warn(
          "[RootLayout] Fonts failed to load within 3s, falling back to system fonts",
        );
        setFontsTimedOut(true);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [fontsLoaded]);

  const [cacheRestored, setCacheRestored] = useState(false);
  const persistedRef = useRef(false);

  useEffect(() => {
    if (persistedRef.current) return;
    persistedRef.current = true;

    // Hydrate from disk cache on cold launch — only then render the app tree.
    // This prevents the mount-time fetch race: without the gate, query hooks
    // fire synchronously on mount and fetch from network BEFORE the cache
    // file is read from disk, defeating the whole purpose of persistence.
    //
    // Using the official persistQueryClient which preserves each query's
    // original dataUpdatedAt, so staleness is computed naturally against
    // per-hook staleTime. Combined with gated rendering + default
    // refetchOnMount, stale-while-revalidate across cold launches is free.
    const [, persistPromise] = persistQueryClient({
      queryClient,
      persister: asyncStoragePersister,
      maxAge: 1000 * 60 * 60 * 24, // 24h backstop
      dehydrateOptions: {
        shouldDehydrateQuery: (q) => isPersistableQuery(q.queryKey),
      },
    });
    persistPromise.finally(() => {
      setCacheRestored(true);
    });

    // Run download migration once (non-blocking)
    (async () => {
      const done = await isMigrationDone();
      if (!done) {
        console.log("[App] Running download migration...");
        const result = await migrateDownloads();
        console.log(
          `[App] Migration complete: ${result.migrated} migrated, ${result.cleaned} cleaned`,
        );
      }
    })();
  }, []);

  // Gate 1: Wait for disk cache to hydrate before mounting any query consumers.
  // This ensures cached data is available on first render so isLoading is never
  // true for persisted queries. Native splash remains visible during this step.
  if (!cacheRestored) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: colors.bg }}
      >
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  // Gate 2: Wait for fonts to load (with 3s timeout fallback)
  if (!fontsLoaded && !fontsTimedOut) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: colors.bg }}
      >
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <DownloadInfraProvider>
              <SettingsProvider>
                <AppContent />
              </SettingsProvider>
            </DownloadInfraProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
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
  useDownloadQueue();

  // ── Android hardware back button ──
  // Catches the system back gesture/button on every screen and routes
  // through safeGoBack, which handles empty back stacks gracefully.
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        safeGoBack({ fallback: "/(tabs)", dismissModalsFirst: true });
        return true; // prevent default (which would crash on empty back stack)
      },
    );
    return () => subscription.remove();
  }, []);

  // ── Long-task monitor (production only) ──
  // Detects JS thread starvation and logs it. In production this feeds
  // analytics; in dev it's a console warning.
  useEffect(() => {
    if (__DEV__) return;
    return initLongTaskMonitor((duration, name) => {
      console.warn(`[Perf] Long JS task: ${duration.toFixed(0)}ms — ${name}`);
    });
  }, []);

  // Reset the navigation interlock on every screen focus.
  // Prevents stale interlock state from a previous navigation that
  // never completed (e.g., error boundary recovery).
  useEffect(() => {
    resetNavigationInterlock();
  });

  if (!settingsLoaded) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: colors.bg }}
      >
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen
          name="(tabs)"
          options={{ contentStyle: { backgroundColor: colors.bg } }}
        />
        <Stack.Screen
          name="movie/[id]"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
        <Stack.Screen
          name="tv/[id]"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
        <Stack.Screen
          name="watch/[...id]"
          options={{
            headerShown: false,
            animation: "slide_from_bottom",
            presentation: "fullScreenModal",
            gestureEnabled: false,
            contentStyle: { backgroundColor: colors.playerBg },
          }}
        />
        {/* Download management pages */}
        <Stack.Screen
          name="downloads"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
        <Stack.Screen
          name="history"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
        <Stack.Screen
          name="saved"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
        {/* download/[...id] - kept in codebase, only registered in dev builds */}
        {__DEV__ && (
          <Stack.Screen
            name="download/[...id]"
            options={{
              headerShown: false,
              animation: "slide_from_bottom",
              presentation: "fullScreenModal",
              gestureEnabled: false,
              contentStyle: { backgroundColor: colors.playerBg },
            }}
          />
        )}
        <Stack.Screen
          name="download/nxsha/[...id]"
          options={{
            headerShown: false,
            animation: "slide_from_bottom",
            presentation: "fullScreenModal",
            gestureEnabled: false,
            contentStyle: { backgroundColor: colors.playerBg },
          }}
        />
        <Stack.Screen
          name="download/falix/[...id]"
          options={{
            headerShown: false,
            animation: "slide_from_bottom",
            presentation: "fullScreenModal",
            gestureEnabled: false,
            contentStyle: { backgroundColor: colors.playerBg },
          }}
        />
        <Stack.Screen
          name="person/[id]"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
        <Stack.Screen
          name="list/[category]"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
        <Stack.Screen
          name="legal"
          options={{
            headerShown: false,
            animation: "slide_from_bottom",
            presentation: "fullScreenModal",
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
        <Stack.Screen
          name="guide"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
        {/* experimental/[...id] - Nuvio provider test page (dev only) */}
        {__DEV__ && (
          <Stack.Screen
            name="experimental/index"
            options={{
              headerShown: false,
              animation: "slide_from_right",
              contentStyle: { backgroundColor: colors.bg },
            }}
          />
        )}
        <Stack.Screen
          name="privacy"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
        <Stack.Screen
          name="announcement/[id]"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
        <Stack.Screen
          name="announcements"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
        <Stack.Screen
          name="feedback"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
      </Stack>

      <UpdateOverlay />

      {/* Global toast overlay for download events — always-on-top via zIndex */}
      <DownloadToastView />

      {/* Legal overlay — native Modal on first launch */}
      <Modal
        visible={!settings.legalAccepted}
        animationType="fade"
        transparent={false}
      >
        <LegalGate />
      </Modal>
    </>
  );
}
