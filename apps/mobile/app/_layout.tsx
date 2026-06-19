import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUpdateCheck } from '../hooks/useUpdateCheck';
import './globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5,
    },
  },
});

export default function RootLayout() {
  const { updateAvailable, showUpdatePrompt } = useUpdateCheck();

  // Show update prompt once on launch if a newer version is available
  useEffect(() => {
    if (updateAvailable) {
      // Small delay so the app can finish rendering first
      const timer = setTimeout(() => showUpdatePrompt(), 1500);
      return () => clearTimeout(timer);
    }
  }, [updateAvailable, showUpdatePrompt]);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#09090b' },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="movie/[id]"
            options={{ headerShown: false, animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="tv/[id]"
            options={{ headerShown: false, animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="watch/[...id]"
            options={{
              headerShown: false,
              animation: 'slide_from_bottom',
              presentation: 'fullScreenModal',
            }}
          />
          {/* download/[...id] (VidVault) — kept in codebase, only registered in dev builds */}
          {__DEV__ && (
            <Stack.Screen
              name="download/[...id]"
              options={{
                headerShown: false,
                animation: 'slide_from_bottom',
                presentation: 'fullScreenModal',
              }}
            />
          )}
          <Stack.Screen
            name="download2/[...id]"
            options={{
              headerShown: false,
              animation: 'slide_from_bottom',
              presentation: 'fullScreenModal',
            }}
          />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
