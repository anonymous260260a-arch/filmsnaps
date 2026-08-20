import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Movie } from "@filmsnaps/shared";

/**
 * Device cache for Continue Watching / History poster metadata.
 *
 * The home screen's Continue Watching row renders posters from TMDB `Movie`
 * metadata (poster_path / title / name). Trending/popular rows are instant on
 * relaunch because their data is restored from the persisted react-query cache
 * — but the CW metadata was previously fetched fresh from TMDB every launch,
 * so the poster component didn't even mount until those network calls finished.
 *
 * This mirrors the announcements cache: return the cached map immediately on
 * open, then refresh in the background and persist the fresh copy. The cached
 * `poster_path` lets <ProgressiveImage> mount at once and reuse the expo-image
 * disk cache (keyed at w342, identical to trending).
 *
 * Each entry now carries a `ts` (timestamp) so the WatchHistoryStore can apply
 * a 24h TTL: metadata newer than the TTL is trusted, older/stale is refreshed in
 * the background batch.
 */

const CACHE_KEY = "@filmsnaps/home/history-meta/v1";

/** Cache is best-effort; keep it usable for a day before forcing refresh. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CachedHistoryMeta {
  /** TMDB metadata, or null if the fetch failed (negative-cached). */
  meta: Movie | null;
  /** Epoch ms when `meta` was fetched. */
  ts: number;
}

interface CacheBlob {
  data: Record<string, CachedHistoryMeta>;
  fetchedAt: number;
}

export async function readHistoryMetaCache(): Promise<Record<
  string,
  CachedHistoryMeta
> | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheBlob;
    if (!parsed || typeof parsed !== "object" || !parsed.data) return null;
    if (Date.now() - (parsed.fetchedAt ?? 0) > MAX_AGE_MS) return null;
    return parsed.data as Record<string, CachedHistoryMeta>;
  } catch {
    return null;
  }
}

export async function writeHistoryMetaCache(
  data: Record<string, CachedHistoryMeta>,
): Promise<void> {
  try {
    const blob: CacheBlob = { data, fetchedAt: Date.now() };
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(blob));
  } catch {
    // Silently fail — cache is best-effort
  }
}
