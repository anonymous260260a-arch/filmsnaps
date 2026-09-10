/**
 * Last working source — remembers WHICH link played successfully for a title
 * so the next playback can start from it directly.
 *
 * Stream URLs expire (presigned tokens, rotating CDNs), so we store a stable
 * identity instead: the URL with its query string stripped
 * (`https://host/path/file.mkv?token=…` → `https://host/path/file.mkv`).
 * On the next watch, if the API lists a link with the same stable identity,
 * it is promoted to the default (probe validation still guards it).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "@filmsnaps/last-source/v1:";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — stale entries simply miss

interface StoredSource {
  urlKey: string;
  at: number;
}

/** Stable identity of a stream URL (no query string — tokens expire). */
export function urlKeyOf(url: string): string {
  return url.split("?")[0];
}

function storageKey(mediaType: "movie" | "tv", tmdbId: string): string {
  return `${PREFIX}${mediaType}:${tmdbId}`;
}

/** Remember that this URL played successfully (call on first frames). */
export async function rememberWorkingSource(
  mediaType: "movie" | "tv",
  tmdbId: string,
  url: string,
): Promise<void> {
  if (!url) return;
  try {
    const entry: StoredSource = { urlKey: urlKeyOf(url), at: Date.now() };
    await AsyncStorage.setItem(
      storageKey(mediaType, tmdbId),
      JSON.stringify(entry),
    );
  } catch {
    // best-effort only
  }
}

/**
 * Stable URL key of the last working source for a title, or null when
 * nothing was remembered (or the memory expired).
 */
export async function getLastWorkingSource(
  mediaType: "movie" | "tv",
  tmdbId: string,
): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(mediaType, tmdbId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as StoredSource;
    if (Date.now() - entry.at > TTL_MS) {
      await AsyncStorage.removeItem(storageKey(mediaType, tmdbId));
      return null;
    }
    return entry.urlKey;
  } catch {
    return null;
  }
}

/**
 * Forget the remembered source for a title — called when a remembered URL
 * fails again on replay, so a poisoned entry can't be auto-promoted forever.
 */
export async function forgetWorkingSource(
  mediaType: "movie" | "tv",
  tmdbId: string,
): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(mediaType, tmdbId));
  } catch {
    // best-effort only
  }
}
