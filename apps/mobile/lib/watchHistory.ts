import AsyncStorage from '@react-native-async-storage/async-storage';
import { tmdbApi } from './api';
import { getNextEpisode } from './tvUtils';

const STORAGE_KEY = '@filmsnaps/watch-history';

// ── Types ───────────────────────────────────────────────────────

export interface WatchProgress {
  /** TMDB id of the movie or TV show */
  tmdbId: string;
  mediaType: 'movie' | 'tv';
  /** Which provider was used (e.g. nxsha, peachify, screenscape, etc.) */
  providerId?: string;
  /** Last playback position in seconds */
  currentTime: number;
  /** Total duration in seconds */
  duration: number;
  /** Percent complete (0–1) */
  percent: number;
  /** TV-specific — current season number */
  season?: number;
  /** TV-specific — current episode number */
  episode?: number;
  /** Timestamp of last update (ms) */
  updatedAt: number;
  /** Explicitly marked as fully watched */
  completed: boolean;
}

export type WatchHistoryMap = Record<string, WatchProgress>;

// ── Key helpers ─────────────────────────────────────────────────

/**
 * Build a flat storage key for a given media item.
 *
 * - Movies:   "movie:123"
 * - TV shows: "tv:123:season:1:episode:3"
 */
export function buildStorageKey(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number,
): string {
  if (mediaType === 'tv' && season != null && episode != null) {
    return `tv:${tmdbId}:season:${season}:episode:${episode}`;
  }
  return `${mediaType}:${tmdbId}`;
}

// ── Storage service ─────────────────────────────────────────────

/**
 * Load the entire watch-history map from disk.
 */
async function loadAll(): Promise<WatchHistoryMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as WatchHistoryMap;
  } catch {
    // Silently fail — app works fine without history
  }
  return {};
}

/**
 * Persist the entire watch-history map to disk.
 */
async function persistAll(map: WatchHistoryMap): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Silently fail — storage write is non-critical
  }
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Save (or update) progress for a single movie / TV episode.
 *
 * If the item is >= 95% complete it is automatically marked as `completed`.
 */
export async function saveProgress(progress: WatchProgress): Promise<void> {
  const key = buildStorageKey(
    progress.tmdbId,
    progress.mediaType,
    progress.season,
    progress.episode,
  );

  const map = await loadAll();
  const existing = map[key];

  // Only persist meaningful progress (>5s) or mark completed
  const shouldPersist =
    progress.currentTime > 5 || progress.completed;

  if (!shouldPersist) return;

  const isFinished = progress.percent >= 0.95 || progress.completed;

  // Don't overwrite with lower progress (e.g. switching providers mid-episode
  // — the new provider may start tracking from 0% for the same episode).
  // Always allow completed entries to overwrite non-completed ones.
  if (existing && !isFinished && progress.percent < existing.percent) {
    return;
  }

  map[key] = {
    ...progress,
    completed: isFinished || (existing?.completed ?? false),
    updatedAt: Date.now(),
  };

  await persistAll(map);
}

/**
 * Get saved progress for a specific movie / TV episode.
 * Returns `null` when nothing has been saved.
 */
export async function getProgress(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number,
): Promise<WatchProgress | null> {
  const key = buildStorageKey(tmdbId, mediaType, season, episode);
  const map = await loadAll();
  return map[key] ?? null;
}

/**
 * Return a resume point for a movie or the most-recently-watched
 * episode of a TV show.
 *
 * TV-show resume logic:
 * - Finds the highest (season, episode) that is marked `completed: true`.
 * - If the current season/episode has progress (regardless of completed),
 *   returns that (so user resumes where they left off).
 * - Otherwise returns the next uncompleted episode after the last
 *   completed one, using TMDB season/episode counts for season transitions.
 */
export async function getResumePoint(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  currentSeason?: number,
  currentEpisode?: number,
): Promise<WatchProgress | null> {
  const map = await loadAll();

  if (mediaType === 'movie') {
    const key = `movie:${tmdbId}`;
    const entry = map[key];
    if (entry && !entry.completed && entry.percent > 0.01) return entry;
    return null;
  }

  // TV: find the best resume point
  const prefix = `tv:${tmdbId}:`;
  const tvEntries = Object.entries(map)
    .filter(([k]) => k.startsWith(prefix))
    .map(([, v]) => v);

  if (tvEntries.length === 0) return null;

  // If current episode has progress (not completed), resume that
  if (currentSeason != null && currentEpisode != null) {
    const currentKey = buildStorageKey(tmdbId, 'tv', currentSeason, currentEpisode);
    const current = map[currentKey];
    if (current && !current.completed && current.percent > 0.01) return current;
  }

  // Find the last completed episode
  const completedEntries = tvEntries
    .filter((e) => e.completed && e.season != null && e.episode != null)
    .sort((a, b) => {
      if ((a.season ?? 0) !== (b.season ?? 0)) return (a.season ?? 0) - (b.season ?? 0);
      return (a.episode ?? 0) - (b.episode ?? 0);
    });

  if (completedEntries.length > 0) {
    const last = completedEntries[completedEntries.length - 1];
    // Use TMDB-aware next episode calculation for season transitions
    const { nextSeason, nextEpisode } = await getNextEpisode(
      tmdbId,
      last.season!,
      last.episode!
    );
    // Check if next exists and has partial progress
    const nextKey = buildStorageKey(tmdbId, 'tv', nextSeason, nextEpisode);
    const next = map[nextKey];
    if (next && !next.completed) return next;
    // Return a synthetic resume hint
    return {
      tmdbId,
      mediaType: 'tv',
      currentTime: 0,
      duration: 0,
      percent: 0,
      season: nextSeason,
      episode: nextEpisode,
      updatedAt: Date.now(),
      completed: false,
    };
  }

  // No completed entries — return most recent partial progress
  const sortedByTime = tvEntries
    .filter((e) => !e.completed)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return sortedByTime[0] ?? null;
}

/**
 * Mark a movie or TV episode as fully watched (completed).
 */
export async function markCompleted(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number,
): Promise<void> {
  await saveProgress({
    tmdbId,
    mediaType,
    currentTime: 0,
    duration: 0,
    percent: 1,
    season,
    episode,
    updatedAt: Date.now(),
    completed: true,
  });
}

/**
 * Remove all watch history (e.g. for debugging / user request).
 */
export async function clearAllProgress(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Silently fail
  }
}

/**
 * Remove progress for a single media item.
 */
export async function clearProgress(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number,
): Promise<void> {
  const key = buildStorageKey(tmdbId, mediaType, season, episode);
  const map = await loadAll();
  delete map[key];
  await persistAll(map);
}

/**
 * Get all watch history entries, sorted by most recently updated.
 *
 * Returns a flat list of all progress entries. TV entries are NOT grouped
 * — each season/episode appears as its own row so the caller can choose
 * how to aggregate them for display.
 */
export async function getAllProgress(): Promise<WatchProgress[]> {
  const map = await loadAll();
  return Object.values(map)
    .filter((e) => e.currentTime > 0 || e.completed)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Get aggregated history grouped by TMDB id.
 *
 * For each unique media item returns:
 * - The latest progress entry
 * - Total number of entries (e.g. TV episodes watched)
 * - Whether it's fully watched
 */
export async function getAggregatedHistory(): Promise<
  Array<{
    latest: WatchProgress;
    episodeCount: number;
    fullyWatched: boolean;
  }>
> {
  const all = await getAllProgress();

  // Group by tmdbId
  const groups = new Map<string, WatchProgress[]>();
  for (const entry of all) {
    const key = `${entry.mediaType}:${entry.tmdbId}`;
    const existing = groups.get(key) ?? [];
    existing.push(entry);
    groups.set(key, existing);
  }

  return Array.from(groups.entries())
    .map(([, entries]) => {
      // Sort by updatedAt descending to get latest first
      entries.sort((a, b) => b.updatedAt - a.updatedAt);
      return {
        latest: entries[0],
        episodeCount: entries.length,
        fullyWatched: entries.every((e) => e.completed),
      };
    })
    .sort((a, b) => b.latest.updatedAt - a.latest.updatedAt);
}
