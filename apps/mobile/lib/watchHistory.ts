import AsyncStorage from "@react-native-async-storage/async-storage";
import { tmdbApi } from "./api";
import { getNextEpisode } from "./tvUtils";

/**
 * Watch-history storage — keyed-per-item with an LRU index.
 *
 * The previous version stored the ENTIRE history as one JSON blob under
 * `@filmsnaps/watch-history` and re-parsed it on every save/get/resume. That
 * meant every 5%-threshold save serialized the whole map — exactly the
 * "full-reparse-on-every-save" cost the redesign set out to remove.
 *
 * New layout:
 *   - Each movie / episode is its own key:  `@filmsnaps/watch:<flatKey>`
 *   - A small MRU index lists the flat keys: `@filmsnaps/watch-index`
 *     (array of { k: flatKey, t: updatedAt }, most-recent-first, capped).
 *
 * Saves now write ONE small item + update ONE small index entry. Resume/get
 * read a single item (or, for TV, the bounded set of that show's episodes)
 * instead of deserializing the whole history.
 *
 * A one-time migration splits the legacy blob into per-item keys and rebuilds
 * the index, then deletes the old key — so existing watch history survives the
 * upgrade transparently.
 */

const OLD_STORAGE_KEY = "@filmsnaps/watch-history";
const INDEX_KEY = "@filmsnaps/watch-index";
const ITEM_PREFIX = "@filmsnaps/watch:";
/** Keep the index bounded so it never grows unbounded across a long history. */
const INDEX_CAP = 1000;

export interface WatchProgress {
  /** TMDB id of the movie or TV show */
  tmdbId: string;
  mediaType: "movie" | "tv";
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
 * - Movies:   "movie:123"
 * - TV shows: "tv:123:season:1:episode:3"
 */
export function buildStorageKey(
  tmdbId: string,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): string {
  if (mediaType === "tv" && season != null && episode != null) {
    return `tv:${tmdbId}:season:${season}:episode:${episode}`;
  }
  return `${mediaType}:${tmdbId}`;
}

// ── Index / migration ──────────────────────────────────────────

interface IndexEntry {
  /** flat storage key (the suffix after ITEM_PREFIX) */
  k: string;
  /** updatedAt of the item, for LRU/MRU ordering */
  t: number;
}

let indexCache: IndexEntry[] | null = null;
let migrateChecked = false;

async function loadIndex(): Promise<IndexEntry[]> {
  if (indexCache) return indexCache;
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as IndexEntry[];
      indexCache = Array.isArray(parsed) ? parsed : [];
      return indexCache;
    }
  } catch {
    // fall through to empty
  }
  indexCache = [];
  return indexCache;
}

async function persistIndex(index: IndexEntry[]): Promise<void> {
  indexCache = index;
  try {
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // Silently fail
  }
}

/** One-time split of the legacy single-map blob into per-item keys + index. */
async function migrateIfNeeded(): Promise<void> {
  if (migrateChecked) return;
  migrateChecked = true;
  try {
    const raw = await AsyncStorage.getItem(OLD_STORAGE_KEY);
    if (!raw) return;
    const map = JSON.parse(raw) as WatchHistoryMap;
    const index: IndexEntry[] = [];
    for (const [flatKey, prog] of Object.entries(map)) {
      await AsyncStorage.setItem(ITEM_PREFIX + flatKey, JSON.stringify(prog));
      index.push({ k: flatKey, t: prog.updatedAt || 0 });
    }
    index.sort((a, b) => b.t - a.t);
    await persistIndex(index.slice(0, INDEX_CAP));
    await AsyncStorage.removeItem(OLD_STORAGE_KEY);
  } catch {
    // If migration fails, leave the old blob in place; reads degrade to it.
  }
}

// ── Item read/write ────────────────────────────────────────────

async function readItem(flatKey: string): Promise<WatchProgress | null> {
  try {
    const raw = await AsyncStorage.getItem(ITEM_PREFIX + flatKey);
    return raw ? (JSON.parse(raw) as WatchProgress) : null;
  } catch {
    return null;
  }
}

async function writeItem(flatKey: string, prog: WatchProgress): Promise<void> {
  try {
    await AsyncStorage.setItem(ITEM_PREFIX + flatKey, JSON.stringify(prog));
  } catch {
    // Silently fail
  }
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Save (or update) progress for a single movie / TV episode.
 *
 * If the item is >= 95% complete it is automatically marked as `completed`.
 * Writes only the one item + touches the index — no full-map reparse.
 */
export async function saveProgress(progress: WatchProgress): Promise<void> {
  await migrateIfNeeded();

  const key = buildStorageKey(
    progress.tmdbId,
    progress.mediaType,
    progress.season,
    progress.episode,
  );

  // Only persist meaningful progress (>5s) or mark completed
  const shouldPersist = progress.currentTime > 5 || progress.completed;
  if (!shouldPersist) return;

  const existing = await readItem(key);
  const isFinished = progress.percent >= 0.95 || progress.completed;

  // Don't overwrite with lower progress (e.g. switching providers mid-episode
  // — the new provider may start tracking from 0% for the same episode).
  // Always allow completed entries to overwrite non-completed ones.
  if (existing && !isFinished && progress.percent < existing.percent) return;

  const next: WatchProgress = {
    ...progress,
    completed: isFinished || (existing?.completed ?? false),
    updatedAt: Date.now(),
  };

  await writeItem(key, next);

  const index = await loadIndex();
  const t = next.updatedAt;
  const filtered = index.filter((e) => e.k !== key);
  filtered.unshift({ k: key, t });
  await persistIndex(filtered.slice(0, INDEX_CAP));
}

/**
 * Get saved progress for a specific movie / TV episode.
 * Returns `null` when nothing has been saved.
 */
export async function getProgress(
  tmdbId: string,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): Promise<WatchProgress | null> {
  await migrateIfNeeded();
  const key = buildStorageKey(tmdbId, mediaType, season, episode);
  return readItem(key);
}

/**
 * Return a resume point for a movie or the most-recently-watched
 * episode of a TV show.
 */
export async function getResumePoint(
  tmdbId: string,
  mediaType: "movie" | "tv",
  currentSeason?: number,
  currentEpisode?: number,
): Promise<WatchProgress | null> {
  await migrateIfNeeded();

  if (mediaType === "movie") {
    const entry = await readItem(`movie:${tmdbId}`);
    if (entry && !entry.completed && entry.percent > 0.01) return entry;
    return null;
  }

  // TV: read only this show's episodes (bounded set).
  const index = await loadIndex();
  const prefix = `tv:${tmdbId}:`;
  const keys = index.filter((e) => e.k.startsWith(prefix)).map((e) => e.k);
  const tvEntries: WatchProgress[] = [];
  for (const k of keys) {
    const item = await readItem(k);
    if (item) tvEntries.push(item);
  }

  if (tvEntries.length === 0) return null;

  // If current episode has progress (not completed), resume that
  if (currentSeason != null && currentEpisode != null) {
    const currentKey = buildStorageKey(
      tmdbId,
      "tv",
      currentSeason,
      currentEpisode,
    );
    const current = tvEntries.find(
      (e) => buildStorageKey(tmdbId, "tv", e.season, e.episode) === currentKey,
    );
    if (current && !current.completed && current.percent > 0.01) return current;
  }

  // Find the last completed episode
  const completedEntries = tvEntries
    .filter((e) => e.completed && e.season != null && e.episode != null)
    .sort((a, b) => {
      if ((a.season ?? 0) !== (b.season ?? 0))
        return (a.season ?? 0) - (b.season ?? 0);
      return (a.episode ?? 0) - (b.episode ?? 0);
    });

  if (completedEntries.length > 0) {
    const last = completedEntries[completedEntries.length - 1];
    // Use TMDB-aware next episode calculation for season transitions
    const { nextSeason, nextEpisode } = await getNextEpisode(
      tmdbId,
      last.season!,
      last.episode!,
    );
    // Check if next exists and has partial progress
    const nextKey = buildStorageKey(tmdbId, "tv", nextSeason, nextEpisode);
    const next = tvEntries.find(
      (e) => buildStorageKey(tmdbId, "tv", e.season, e.episode) === nextKey,
    );
    if (next && !next.completed) return next;
    // Return a synthetic resume hint
    return {
      tmdbId,
      mediaType: "tv",
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
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): Promise<void> {
  await migrateIfNeeded();
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
    const index = await loadIndex();
    for (const e of index) {
      await AsyncStorage.removeItem(ITEM_PREFIX + e.k);
    }
    await AsyncStorage.removeItem(INDEX_KEY);
    await AsyncStorage.removeItem(OLD_STORAGE_KEY);
    indexCache = [];
  } catch {
    // Silently fail
  }
}

/**
 * Remove progress for a single media item.
 */
export async function clearProgress(
  tmdbId: string,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): Promise<void> {
  await migrateIfNeeded();
  const key = buildStorageKey(tmdbId, mediaType, season, episode);
  await AsyncStorage.removeItem(ITEM_PREFIX + key);
  const index = await loadIndex();
  const filtered = index.filter((e) => e.k !== key);
  await persistIndex(filtered);
}

/**
 * Remove ALL progress for a single media item (a whole movie, or every
 * episode/season of a TV show). Used by the per-item "remove" affordance in
 * Continue Watching / History, as opposed to `clearAllProgress` which wipes
 * everything.
 */
export async function clearMediaProgress(
  tmdbId: string | number,
  mediaType: "movie" | "tv",
): Promise<void> {
  await migrateIfNeeded();
  const idStr = String(tmdbId);
  const matchKey = (k: string): boolean =>
    mediaType === "tv"
      ? k === `tv:${idStr}` || k.startsWith(`tv:${idStr}:`)
      : k === `movie:${idStr}` || k.startsWith(`movie:${idStr}:`);
  const index = await loadIndex();
  const matched = index.filter((e) => matchKey(e.k));
  for (const m of matched) {
    await AsyncStorage.removeItem(ITEM_PREFIX + m.k);
  }
  const filtered = index.filter((e) => !matched.includes(e));
  await persistIndex(filtered);
}

/**
 * Get all watch history entries, sorted by most recently updated.
 */
export async function getAllProgress(): Promise<WatchProgress[]> {
  await migrateIfNeeded();
  const index = await loadIndex();
  const out: WatchProgress[] = [];
  for (const e of index) {
    const item = await readItem(e.k);
    if (item && (item.currentTime > 0 || item.completed)) out.push(item);
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/**
 * Get aggregated history grouped by TMDB id.
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
      entries.sort((a, b) => b.updatedAt - a.updatedAt);
      return {
        latest: entries[0],
        episodeCount: entries.length,
        fullyWatched: entries.every((e) => e.completed),
      };
    })
    .sort((a, b) => b.latest.updatedAt - a.latest.updatedAt);
}
