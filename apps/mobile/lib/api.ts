import { Platform } from 'react-native';

/**
 * Get the base URL for the Filmsnaps API.
 *
 * - In development, uses the local dev server.
 * - Android emulator uses 10.0.2.2 to reach the host machine.
 * - In production, uses the live app URL.
 */
export function getApiBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_WEB_URL;
  console.log('[API] EXPO_PUBLIC_WEB_URL:', envUrl);

  if (envUrl) {
    console.log('[API] Using env URL:', envUrl);
    return envUrl;
  }

  if (__DEV__) {
    if (Platform.OS === 'android') {
      // Real Android device via Expo Go — can't use 10.0.2.2
      // Try the env var or fall back to localhost
      console.log('[API] Android device, using localhost (if on emulator this will fail)');
      return 'http://localhost:3000';
    }
    return 'http://localhost:3000';
  }

  return 'https://filmsnaps.app';
}

/**
 * Pre-configured TMDB API client pointing at the web app's pass-through.
 */
import { createTmdbApi } from '@filmsnaps/shared';

export const tmdbApi = createTmdbApi(getApiBaseUrl());
