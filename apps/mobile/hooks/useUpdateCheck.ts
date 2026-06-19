import { useState, useEffect, useCallback } from 'react';
import { Linking, Alert, Platform } from 'react-native';
import Constants from 'expo-constants';

/** The shape of the remote version.json */
type VersionInfo = {
  latestVersion: string;
  downloadUrl: string;
  releaseNotes?: string;
};

/**
 * Default URL — uses the web backend base so it works in dev and prod.
 * Override with EXPO_PUBLIC_VERSION_URL if you want a separate host.
 */
 const VERSION_CHECK_URL =
   process.env.EXPO_PUBLIC_VERSION_URL ||
   `${process.env.EXPO_PUBLIC_WEB_URL || 'https://filmsnaps.app'}/version.json`;

/**
 * Returns the local app version from app.json (e.g. "1.0.0")
 */
function getLocalVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

/**
 * Simple semver comparison (only major.minor.patch, no prerelease).
 * Returns  1 if a > b,  -1 if a < b,  0 if equal.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * useUpdateCheck — call once at app root.
 *
 * Fetches a remote version.json, compares it to the local version,
 * and if a newer version exists, prompts the user to download it.
 *
 * Hosting the version.json:
 *   Option A — Deploy the web app (served at https://filmsnaps.app/version.json)
 *   Option B — Upload to a GitHub Gist / raw URL
 *   Option C — Any free static host (Netlify, Vercel, Surge.sh)
 *   Set EXPO_PUBLIC_VERSION_URL to point at it.
 */
export function useUpdateCheck() {
  const [available, setAvailable] = useState<VersionInfo | null>(null);

  const localVersion = getLocalVersion();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(VERSION_CHECK_URL, { cache: 'no-cache' });
        if (!res.ok) return;
        const remote: VersionInfo = await res.json();
        if (!remote.latestVersion) return;

        console.log(
          `[UpdateCheck] local=${localVersion} remote=${remote.latestVersion}`,
        );

        if (compareVersions(remote.latestVersion, localVersion) > 0) {
          if (!cancelled) setAvailable(remote);
        }
      } catch {
        // Silent — network failure means no check available
        console.log('[UpdateCheck] Failed to fetch version.json');
      }
    })();

    return () => { cancelled = true; };
  }, [localVersion]);

  const showUpdatePrompt = useCallback(() => {
    if (!available) return;

    Alert.alert(
      '📥 Update Available',
      `Version ${available.latestVersion} is now available.\n\n` +
        (available.releaseNotes
          ? `What's new:\n${available.releaseNotes}\n\n`
          : '') +
        'Would you like to download the latest version?',
      [
        { text: 'Later', style: 'cancel' },
        {
          text: 'Download',
          onPress: () => {
            const url = available.downloadUrl;
            if (url) {
              Linking.openURL(url).catch(() =>
                Alert.alert('Download', `Open this link in your browser:\n${url}`),
              );
            }
          },
        },
      ],
    );
  }, [available]);

  return { updateAvailable: available !== null, showUpdatePrompt };
}
