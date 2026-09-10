/**
 * Subtitle choice cache — remembers which online subtitle the user loaded
 * per title/episode so the next playback auto-attaches it (no re-search, no
 * re-download). Cleared when the user explicitly turns subtitles Off.
 *
 * The referenced file lives in the app cache (see downloadSubtitle in
 * lib/subtitleSearch) — auto-load re-checks existence before attaching.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SubtitleSearchQuery } from "./subtitleSearch";

export interface CachedSubtitleChoice {
  uri: string;
  mimeType: string;
  language: string;
  label: string;
}

const keyFor = (query: SubtitleSearchQuery): string =>
  `@subtitles/choice:${query.mediaType}:${query.tmdbId}:${query.season ?? ""}:${query.episode ?? ""}`;

export async function saveSubtitleChoice(
  query: SubtitleSearchQuery,
  choice: CachedSubtitleChoice,
): Promise<void> {
  await AsyncStorage.setItem(keyFor(query), JSON.stringify(choice)).catch(
    () => {},
  );
}

export async function getSubtitleChoice(
  query: SubtitleSearchQuery,
): Promise<CachedSubtitleChoice | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(query));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSubtitleChoice;
    if (
      typeof parsed?.uri !== "string" ||
      typeof parsed?.mimeType !== "string" ||
      typeof parsed?.language !== "string" ||
      typeof parsed?.label !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function clearSubtitleChoice(
  query: SubtitleSearchQuery,
): Promise<void> {
  await AsyncStorage.removeItem(keyFor(query)).catch(() => {});
}
