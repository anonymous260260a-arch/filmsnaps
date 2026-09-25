import React, { useEffect, useRef, useState } from "react";
import { View, Image, Modal, BackHandler, AppState } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack, usePathname } from "expo-router";
import { safeGoBack, resetNavigationInterlock } from "../lib/navigation";
import { initLongTaskMonitor } from "../lib/performance/long-task-monitor";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "@expo-google-fonts/inter";
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
} from "@expo-google-fonts/geist";
import { Fraunces_700Bold } from "@expo-google-fonts/fraunces";
import * as SplashScreen from "expo-splash-screen";
import { Image as ExpoImage } from "expo-image";
import { UpdateOverlay } from "../components/UpdateOverlay";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { DownloadInfraProvider, useDownloadQueue } from "../lib/download";
import { migrateDownloads, isMigrationDone } from "../lib/download/migration";
import {
  SettingsProvider,
  useSettings,
  startSettingsPreload,
  isSettingsPreloaded,
  getSettingsReadCount,
} from "../lib/settings";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { initNetworkMonitor } from "../lib/networkMonitor";
import { initPlayerConfig } from "../lib/playerConfig";
import { warmProviderConfig } from "../lib/directStreams";
import {
  asyncStoragePersister,
  isPersistableQuery,
  readPersistedCacheBytes,
} from "../lib/queryPersister";
import { DownloadToastView } from "../components/DownloadToast";
import LegalGate from "../components/LegalGate";
import { colors } from "../theme/colors";
import {
  launchNow,
  markLaunch,
  logLaunchSummary,
} from "../lib/launchMetrics";
import {
  setTelemetryGate,
  refreshConnectionClass,
  setPrefAudioLang,
  trackScreenView,
  emitSessionEndOnBackground,
} from "../lib/telemetry";
import { initSentryIfAllowed } from "../lib/sentry";
import { getImageUrl } from "@filmsnaps/shared";
import { HERO_BACKDROP_SIZE } from "../components/heroLayout";
import "./globals.css";

// FIX 4: hold the native splash until the app tree is ready (module top).
SplashScreen.preventAutoHideAsync().catch(() => {});

// FIX 9: cold-start t0 — module scope, before any work below.
launchNow();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // FIX 3: typed smart retry — no retry on 4xx (except 408/429), else ≤2.
      retry: (failureCount, error) => {
        const status = (error as { status?: number } | null)?.status;
        if (
          typeof status === "number" &&
          status < 500 &&
          status !== 408 &&
          status !== 429
        ) {
          return false;
        }
        return failureCount < 2;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 8000),
      staleTime: 1000 * 60 * 5, // safety net — overridden per-hook for TMDB queries
      gcTime: 30 * 60 * 1000, // FIX 3: was Infinity — GC idle queries after 30min
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

// FIX 5: start cache restore at module scope (parallel with fonts + settings).
const cacheRestoreStartedAt = launchNow();
const [, persistPromise] = persistQueryClient({
  queryClient,
  persister: asyncStoragePersister,
  maxAge: 1000 * 60 * 60 * 24, // 24h backstop
  dehydrateOptions: {
    shouldDehydrateQuery: (q) => isPersistableQuery(q.queryKey),
  },
});

const cacheRestorePromise = persistPromise
  .then(async () => {
    const bytes = await readPersistedCacheBytes();
    const ms = Math.round(launchNow() - cacheRestoreStartedAt);
    console.log(`[perf] cacheRestore ms=${ms} bytes=${bytes}`);

    const trending = queryClient.getQueryState(["movies", "trending"]);
    let reason: "no-cache" | "stale" | "warm" = "no-cache";
    if (trending?.data !== undefined) {
      const age = Date.now() - (trending.dataUpdatedAt || 0);
      // Home trending staleTime is 10min — align coldStartReason with that.
      reason = age > 10 * 60 * 1000 ? "stale" : "warm";
    }
    markLaunch("cacheRestoredMs", launchNow());
    markLaunch("cacheBytes", bytes);
    markLaunch("coldStartReason", reason);

    // FIX 6: fire-and-forget warm of hero backdrop + first 4 posters.
    // Skip network work when there is nothing cached to prefetch from.
    try {
      const data = queryClient.getQueryData(["movies", "trending"]) as
        | { results?: Array<{ backdrop_path?: string | null; poster_path?: string | null }> }
        | undefined;
      const results = data?.results ?? [];
      if (results.length > 0) {
        const hero = results.find((r) => r.backdrop_path) ?? results[0];
        if (hero?.backdrop_path) {
          // Same URL as Hero.tsx render path (HERO_BACKDROP_SIZE = w1280).
          ExpoImage.prefetch(getImageUrl(hero.backdrop_path, HERO_BACKDROP_SIZE)).catch(
            () => {},
          );
        }
        results.slice(0, 4).forEach((r) => {
          if (r.poster_path) {
            ExpoImage.prefetch(getImageUrl(r.poster_path, "w342")).catch(
              () => {},
            );
          }
        });
      }
    } catch {
      // best-effort image warm
    }
  })
  .catch(() => {
    markLaunch("cacheRestoredMs", launchNow());
    markLaunch("cacheBytes", 0);
    markLaunch("coldStartReason", "no-cache");
  });

// FIX B: splash mark is recorded synchronously when the tree is first allowed.
let splashMarkDone = false;
function markSplashHiddenOnce(): void {
  if (splashMarkDone) return;
  splashMarkDone = true;
  console.log(`[appReady] true + hide splash at t=${launchNow()}ms`);
  markLaunch("splashHiddenMs", launchNow());
  SplashScreen.hideAsync().catch(() => {});
}

// Phase 1C FIX 1: mount counter — exactly ONE mount per JS runtime expected.
let rootLayoutMountCount = 0;

/** Static branded hold — matches native splash (bg #070708, contain image). */
function SplashHold() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#070708",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Image
        source={require("../assets/splash.png")}
        style={{ width: "100%", height: "100%" }}
        resizeMode="contain"
        accessible={false}
      />
    </View>
  );
}

export default function RootLayout() {
  // Phase 1C FIX 1: detect root remounts (should be #1 only per runtime).
  useEffect(() => {
    rootLayoutMountCount += 1;
    console.log(
      `[RootLayout] mount #${rootLayoutMountCount} at t=${launchNow()}ms readCount=${getSettingsReadCount()}`,
    );
    if (rootLayoutMountCount > 1) {
      console.warn(
        `[RootLayout] REMOUNT detected (#${rootLayoutMountCount}) — providers will re-create`,
      );
    }
  }, []);

  // Alias web fonts onto the app's existing string keys so every
  // `fontFamily: "Inter_*"` / `"PlayfairDisplay_700Bold"` now renders Geist /
  // Fraunces with no per-screen edits. Test swap — remove to revert.
  // FIX C: useFonts returns [loaded, error] — fall back only on rejection.
  const [fontsLoaded, fontsError] = useFonts({
    Inter_400Regular: Geist_400Regular,
    Inter_500Medium: Geist_500Medium,
    Inter_600SemiBold: Geist_600SemiBold,
    Inter_700Bold: Geist_700Bold,
    PlayfairDisplay_700Bold: Fraunces_700Bold,
  });

  const [fontsFallback, setFontsFallback] = useState(false);

  useEffect(() => {
    if (fontsLoaded) {
      console.log(
        `[RootLayout] fonts loaded t=${launchNow()}ms (gate needs fontsLoaded||fontsFallback)`,
      );
      markLaunch("fontsDoneMs", launchNow());
      return;
    }
    if (fontsError) {
      console.warn(
        "[RootLayout] Fonts failed to load (rejection), falling back to system fonts:",
        fontsError,
      );
      setFontsFallback(true);
      markLaunch("fontsDoneMs", launchNow());
      return;
    }
    // FIX C: 10s hard-cap only (safety net) — no 3s false fallback.
    const timer = setTimeout(() => {
      if (!fontsLoaded) {
        console.warn(
          "[RootLayout] Fonts failed to load within 10s, falling back to system fonts",
        );
        setFontsFallback(true);
        markLaunch("fontsDoneMs", launchNow());
      }
    }, 10_000);
    return () => clearTimeout(timer);
  }, [fontsLoaded, fontsError]);

  const [cacheRestored, setCacheRestored] = useState(false);
  const [settingsReady, setSettingsReady] = useState(() =>
    isSettingsPreloaded(),
  );
  const bootRef = useRef(false);

  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;

    // FIX A / Phase 1C: single settings read — RootLayout first effect only.
    // SettingsProvider also calls startSettingsPreload() but that is idempotent.
    startSettingsPreload()
      .then(() => {
        markLaunch("settingsDoneMs", launchNow());
        setSettingsReady(true);
      })
      .catch((e) => {
        console.warn("[RootLayout] settings preload rejected:", e);
        setSettingsReady(true);
      });

    cacheRestorePromise
      .then(() => {
        setCacheRestored(true);
      })
      .catch((e) => {
        console.warn("[RootLayout] cacheRestore rejected:", e);
        setCacheRestored(true);
      });

    // Run download migration once (non-blocking)
    (async () => {
      const done = await isMigrationDone();
      if (!done) {
        console.log("[App] Running download migration...");
        try {
          const result = await migrateDownloads();
          console.log(
            `[App] Migration complete: ${result.migrated} migrated, ${result.cleaned} cleaned`,
          );
        } catch (e) {
          console.warn("[App] Migration failed:", e);
        }
      }
    })();
  }, []);

  // Phase 1C FIX 5.2: REAL gate — cache + (fontsLoaded || fontsError→fallback
  // || 10s cap) + settings. fontsFallback is set by fontsError OR the 10s timer.
  const appReady =
    cacheRestored && (fontsLoaded || fontsFallback) && settingsReady;

  // FIX B: mark + hide BEFORE rendering children (child effects run first).
  if (appReady) {
    markSplashHiddenOnce();
  }

  // FIX 4: static branded view while gated — no ActivityIndicator, no spinner.
  if (!appReady) {
    return <SplashHold />;
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
  const { settings } = useSettings();

  // Phase 4 Package B: open/close the telemetry gate from the legal +
  // analytics settings. Closing either drops the queue and stops sends.
  // Sentry is crashes-only and follows the same gate.
  useEffect(() => {
    const legalAccepted = settings.legalAccepted === true;
    const analyticsEnabled = settings.analyticsEnabled !== false;
    setTelemetryGate({ legalAccepted, analyticsEnabled });
    initSentryIfAllowed({ legalAccepted, analyticsEnabled });
  }, [settings.legalAccepted, settings.analyticsEnabled]);

  useEffect(() => {
    refreshConnectionClass();
  }, []);

  // P2 — preferred audio language sync (whitelisted enum for telemetry).
  useEffect(() => {
    setPrefAudioLang(settings.preferredAudioLanguage);
  }, [settings.preferredAudioLanguage]);

  // P2 — screen_view on every route change (adoption histogram). Maps the
  // current pathname to the small whitelisted screen enum; unmapped screens
  // (legal, guide, announcements, …) emit nothing.
  const pathname = usePathname();
  const lastScreenRef = useRef<string | null>(null);
  useEffect(() => {
    let screen: "home" | "detail_movie" | "detail_tv" | "watch" | "search" | "library" | "history" | "saved" | "settings" | null = null;
    if (pathname.startsWith("/movie/")) screen = "detail_movie";
    else if (pathname.startsWith("/tv/")) screen = "detail_tv";
    else if (pathname.startsWith("/watch/")) screen = "watch";
    else if (pathname.startsWith("/history")) screen = "history";
    else if (pathname.startsWith("/saved")) screen = "saved";
    else if (pathname.startsWith("/search")) screen = "search";
    else if (pathname.startsWith("/library")) screen = "library";
    else if (pathname.startsWith("/settings")) screen = "settings";
    else if (pathname === "/" || pathname === "" || pathname.startsWith("/(tabs)/")) screen = "home";
    if (screen && screen !== lastScreenRef.current) {
      lastScreenRef.current = screen;
      trackScreenView({ screen });
    }
  }, [pathname]);

  // P3 — session_end when the app leaves the foreground (AppState listener
  // lives here so the queue's flush-on-background stays unchanged). iOS
  // "inactive" fires mid-transition (notification shade, app switcher) and
  // would end the session early, so only "background" counts as a leak.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        emitSessionEndOnBackground();
      }
    });
    return () => sub.remove();
  }, []);

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

  // ── Network monitor (speed test in background) ──
  // Schedules via runAfterContentReady(+15s) inside initNetworkMonitor.
  // Non-blocking — uses cached speed for immediate decisions.
  // Gated by user setting (enableSpeedTest).
  useEffect(() => {
    if (!settings.enableSpeedTest) return;
    return initNetworkMonitor();
  }, [settings.enableSpeedTest]);

  // ── Player config (cache-first; no remote fetch) ──
  useEffect(() => {
    initPlayerConfig();
  }, []);

  // ── Stream/download provider registry (remote-updatable URLs) ──
  useEffect(() => {
    warmProviderConfig();
  }, []);

  // Reset the navigation interlock on every screen focus.
  useEffect(() => {
    resetNavigationInterlock();
  });

  // FIX 4: settings are part of appReady — no third ActivityIndicator gate.
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

// Fallback: if home never mounts (deep link into a detail route), still emit
// the one-line launch summary. Idempotent — the home path wins when it runs.
setTimeout(() => {
  logLaunchSummary();
}, 30_000);
