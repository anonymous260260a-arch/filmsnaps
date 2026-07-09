import React, { useEffect, useRef } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: '#080808' }}>
        <ActivityIndicator size="large" color="#e8a020" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#080808' }}>
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <UpdateOverlay />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#080808' },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ contentStyle: { backgroundColor: '#080808' } }} />
          <Stack.Screen
            name="movie/[id]"
            options={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#080808' } }}
          />
          <Stack.Screen
            name="tv/[id]"
            options={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#080808' } }}
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
          {/* download/[...id] — kept in codebase, only registered in dev builds */}
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
            options={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#080808' } }}
          />
          <Stack.Screen
            name="list/[category]"
            options={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#080808' } }}
          />
          <Stack.Screen
            name="browse"
            options={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#080808' } }}
          />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
    </View>
  );
}
