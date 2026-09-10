/**
 * Per-series subtitle sync offset persistence.
 *
 * Sync errors are consistent per release — users should not have to re-dial
 * the offset for every episode. Keyed by `${mediaType}:${tmdbId}` (series
 * level, not episode level). Values are seconds in 0.5s steps, ±30s.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_PREFIX = "subtitleOffset:";
const STEP_S = 0.5;
const LIMIT_S = 30;

/** In-memory mirror — synchronous reads for the sheet while it's open. */
const CACHE = new Map<string, number>();

export function clampSubtitleOffset(seconds: number): number {
  const stepped = Math.round(seconds / STEP_S) * STEP_S;
  return Math.max(-LIMIT_S, Math.min(LIMIT_S, stepped));
}

export async function getSubtitleOffset(key: string): Promise<number> {
  if (CACHE.has(key)) return CACHE.get(key) as number;
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + key);
    const value = raw ? parseFloat(raw) : 0;
    const clamped = Number.isFinite(value) ? clampSubtitleOffset(value) : 0;
    CACHE.set(key, clamped);
    return clamped;
  } catch {
    return 0;
  }
}

export async function setSubtitleOffset(
  key: string,
  seconds: number,
): Promise<number> {
  const clamped = clampSubtitleOffset(seconds);
  CACHE.set(key, clamped);
  try {
    if (clamped === 0) await AsyncStorage.removeItem(KEY_PREFIX + key);
    else await AsyncStorage.setItem(KEY_PREFIX + key, String(clamped));
  } catch {
    // Persistence is best-effort; the in-memory value still applies this session.
  }
  return clamped;
}
