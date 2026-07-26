import React, { useEffect, useRef, useState } from "react";
import { View, ActivityIndicator, Modal } from "react-native";
import { Stack } from "expo-router";
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
import { SettingsProvider, useSettings } from "../lib/settings";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import {
  asyncStoragePersister,
  isPersistableQuery,
} from "../lib/queryPersister";
import { DownloadToastView } from "../components/DownloadToast";
import LegalGate from "../components/LegalGate";
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

    // NOTE: Background downloads are handled automatically by DownloadManager's
    // Foreground Service (react-native-background-actions) — no manual registration needed.
  }, []);

  // Gate 1: Wait for disk cache to hydrate before mounting any query consumers.
  // This ensures cached data is available on first render so isLoading is never
  // true for persisted queries. Native splash remains visible during this step.
  if (!cacheRestored) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: "#070708" }}
      >
        <ActivityIndicator size="large" color="#D4A237" />
      </View>
    );
  }

  // Gate 2: Wait for fonts to load (with 3s timeout fallback)
  if (!fontsLoaded && !fontsTimedOut) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: "#070708" }}
      >
        <ActivityIndicator size="large" color="#D4A237" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#070708" }}>
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
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: "#070708" }}
      >
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
          contentStyle: { backgroundColor: "#070708" },
        }}
      >
        <Stack.Screen
          name="(tabs)"
          options={{ contentStyle: { backgroundColor: "#070708" } }}
        />
        <Stack.Screen
          name="movie/[id]"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: "#070708" },
          }}
        />
        <Stack.Screen
          name="tv/[id]"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: "#070708" },
          }}
        />
        <Stack.Screen
          name="watch/[...id]"
          options={{
            headerShown: false,
            animation: "slide_from_bottom",
            presentation: "fullScreenModal",
            gestureEnabled: false,
            contentStyle: { backgroundColor: "#000" },
          }}
        />
        {/* Download management pages */}
        <Stack.Screen
          name="downloads"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: "#070708" },
          }}
        />
        <Stack.Screen
          name="history"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: "#070708" },
          }}
        />
        <Stack.Screen
          name="saved"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: "#070708" },
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
              contentStyle: { backgroundColor: "#000" },
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
            contentStyle: { backgroundColor: "#000" },
          }}
        />
        <Stack.Screen
          name="download/falix/[...id]"
          options={{
            headerShown: false,
            animation: "slide_from_bottom",
            presentation: "fullScreenModal",
            gestureEnabled: false,
            contentStyle: { backgroundColor: "#000" },
          }}
        />
        <Stack.Screen
          name="download2/[...id]"
          options={{
            headerShown: false,
            animation: "slide_from_bottom",
            presentation: "fullScreenModal",
            gestureEnabled: false,
            contentStyle: { backgroundColor: "#000" },
          }}
        />
        <Stack.Screen
          name="person/[id]"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: "#070708" },
          }}
        />
        <Stack.Screen
          name="list/[category]"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: "#070708" },
          }}
        />
        <Stack.Screen
          name="legal"
          options={{
            headerShown: false,
            animation: "slide_from_bottom",
            presentation: "fullScreenModal",
            contentStyle: { backgroundColor: "#070708" },
          }}
        />
        <Stack.Screen
          name="guide"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: "#070708" },
          }}
        />
        {/* experimental/[...id] - Nuvio provider test page (dev only) */}
        {__DEV__ && (
          <Stack.Screen
            name="experimental/index"
            options={{
              headerShown: false,
              animation: "slide_from_right",
              contentStyle: { backgroundColor: "#070708" },
            }}
          />
        )}
        <Stack.Screen
          name="privacy"
          options={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: { backgroundColor: "#070708" },
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
