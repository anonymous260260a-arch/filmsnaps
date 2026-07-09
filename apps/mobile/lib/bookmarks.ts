import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@filmsnaps/bookmarks';

export interface Bookmark {
  tmdbId: string;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string | null;
  year: string;
  addedAt: number;
}

/**
 * Save a bookmark (idempotent — overwrites if same tmdbId already exists)
 */
export async function saveBookmark(item: Bookmark): Promise<void> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const map: Record<string, Bookmark> = raw ? JSON.parse(raw) : {};
  map[item.tmdbId] = item;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

/**
 * Remove a bookmark by TMDB id
 */
export async function removeBookmark(tmdbId: string): Promise<void> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  const map: Record<string, Bookmark> = JSON.parse(raw);
  delete map[tmdbId];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

/**
 * Get a single bookmark
 */
export async function getBookmark(tmdbId: string): Promise<Bookmark | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const map: Record<string, Bookmark> = JSON.parse(raw);
  return map[tmdbId] ?? null;
}

/**
 * Check if a TMDB id is bookmarked
 */
export async function isBookmarked(tmdbId: string): Promise<boolean> {
  const bm = await getBookmark(tmdbId);
  return bm !== null;
}

/**
 * Get all bookmarks, newest first
 */
export async function getAllBookmarks(): Promise<Bookmark[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const map: Record<string, Bookmark> = JSON.parse(raw);
  return Object.values(map).sort((a, b) => b.addedAt - a.addedAt);
}

/**
 * Get bookmark count
 */
export async function getBookmarkCount(): Promise<number> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return 0;
  const map: Record<string, Bookmark> = JSON.parse(raw);
  return Object.keys(map).length;
}

/**
 * Clear all bookmarks
 */
export async function clearAllBookmarks(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
