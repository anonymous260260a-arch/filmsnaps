/**
 * IMDB id cache — write-through AsyncStorage map keyed by `${mediaType}:${tmdbId}`.
 *
 * D2: resolveImdbId used to hit tmdbApi.getExternalIds on every pipeline run.
 * A re-watch of the same title now reads the id from here (TTL 30 days,
 * LRU cap 500) and skips the worker roundtrip entirely. Log on hit:
 *   `[Flow] imdb cache HIT …`
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@filmsnaps/imdb-id-cache/v1";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_ENTRIES = 500;

interface CacheEntry {
  id: string;
  savedAt: number;
  usedAt: number;
}

type CacheMap = Record<string, CacheEntry>;

let memory: CacheMap | null = null;
let loadPromise: Promise<CacheMap> | null = null;

async function load(): Promise<CacheMap> {
  if (memory) return memory;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as CacheMap) : {};
      memory = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      memory = {};
    }
    return memory!;
  })().finally(() => {
    loadPromise = null;
  });
  return loadPromise;
}

function persist(map: CacheMap): void {
  try {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map)).catch(() => {});
  } catch {}
}

function prune(map: CacheMap): void {
  const now = Date.now();
  const keys = Object.keys(map);
  for (const k of keys) {
    const e = map[k];
    if (!e || now - e.savedAt > TTL_MS) delete map[k];
  }
  const remaining = Object.keys(map);
  if (remaining.length > MAX_ENTRIES) {
    remaining.sort((a, b) => (map[a]?.usedAt ?? 0) - (map[b]?.usedAt ?? 0));
    const excess = remaining.length - MAX_ENTRIES;
    for (let i = 0; i < excess; i++) delete map[remaining[i]!];
  }
}

function cacheKey(mediaType: "movie" | "tv", tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

/** Return a cached IMDB id, or null on miss/expired. Logs `[Flow] imdb cache HIT`. */
export async function getImdbId(
  mediaType: "movie" | "tv",
  tmdbId: number,
): Promise<string | null> {
  const key = cacheKey(mediaType, tmdbId);
  const map = await load();
  const entry = map[key];
  if (!entry?.id) return null;
  if (Date.now() - entry.savedAt > TTL_MS) {
    delete map[key];
    persist(map);
    return null;
  }
  entry.usedAt = Date.now();
  persist(map);
  console.log(`[Flow] imdb cache HIT ${key} → ${entry.id}`);
  return entry.id;
}

/** Write-through: store a resolved IMDB id (LRU-capped). Never throws. */
export async function setImdbId(
  mediaType: "movie" | "tv",
  tmdbId: number,
  imdbId: string,
): Promise<void> {
  if (!imdbId || !/^tt\d+$/i.test(imdbId)) return;
  const key = cacheKey(mediaType, tmdbId);
  const map = await load();
  const now = Date.now();
  map[key] = { id: imdbId, savedAt: now, usedAt: now };
  prune(map);
  persist(map);
}
