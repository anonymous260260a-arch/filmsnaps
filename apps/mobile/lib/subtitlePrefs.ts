/**
 * Per-series subtitle sync offset persistence.
 *
 * Sync errors are consistent per release — users should not have to re-dial
 * the offset for every episode. Keyed by `${mediaType}:${tmdbId}` (series
 * level, not episode level). Values are seconds in 0.5s steps, ±30s.
 *
 * Extended with autoOffsetMs + autoScale for auto-sync results.
 * Effective offset passed to native = autoOffsetMs + manualOffsetMs.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_PREFIX = "subtitleOffset:";
const STEP_S = 0.5;
const LIMIT_S = 30;

/** In-memory mirror — synchronous reads for the sheet while it's open. */
const CACHE = new Map<string, number>();
const AUTO_CACHE = new Map<
  string,
  { autoOffsetMs: number; autoScale: number }
>();

type AutoSyncPrefs = {
  autoOffsetMs: number;
  autoScale: number;
  schema?: number;
};

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

// ─── Auto-sync preferences ────────────────────────────────

const AUTO_KEY_PREFIX = "autoSync:";

/**
 * Schema version for the AUTO fields only (B1). A mismatch means the stored
 * autoOffsetMs came from a build whose result we no longer trust (the poisoned
 * -73900ms entry was restored at playback start and kept re-applying a 74s
 * wrong shift). On mismatch the auto fields are dropped and the entry deleted;
 * MANUAL offsets live under the separate KEY_PREFIX key and are never touched.
 */
const PREFS_SCHEMA = 2;

export async function getAutoSyncPrefs(key: string): Promise<AutoSyncPrefs> {
  if (AUTO_CACHE.has(key)) return AUTO_CACHE.get(key)!;
  try {
    const raw = await AsyncStorage.getItem(AUTO_KEY_PREFIX + key);
    if (raw) {
      const parsed = JSON.parse(raw) as AutoSyncPrefs;
      if (parsed.schema === PREFS_SCHEMA) {
        AUTO_CACHE.set(key, parsed);
        return parsed;
      }
      // Pre-fix (or unknown) auto result: never resurrect it. Drop the auto
      // entry; the manual offset key is untouched.
      console.log(
        `[SubSync] autoOffset prefs schema ${parsed.schema ?? "none"} != ${PREFS_SCHEMA} - dropping autoOffsetMs=${parsed.autoOffsetMs}`,
      );
      await AsyncStorage.removeItem(AUTO_KEY_PREFIX + key);
    }
  } catch {
    // fall through
  }
  return { autoOffsetMs: 0, autoScale: 1 };
}

export async function setAutoSyncPrefs(
  key: string,
  prefs: AutoSyncPrefs,
): Promise<void> {
  const stamped: AutoSyncPrefs = { ...prefs, schema: PREFS_SCHEMA };
  AUTO_CACHE.set(key, stamped);
  try {
    await AsyncStorage.setItem(AUTO_KEY_PREFIX + key, JSON.stringify(stamped));
  } catch {
    // best-effort
  }
}

export async function clearAutoSyncPrefs(key: string): Promise<void> {
  AUTO_CACHE.delete(key);
  try {
    await AsyncStorage.removeItem(AUTO_KEY_PREFIX + key);
  } catch {
    // best-effort
  }
}

/**
 * Compute the effective offset to pass to native.
 * effectiveMs = autoOffsetMs + manualOffsetSeconds * 1000
 */
export async function getEffectiveOffset(key: string): Promise<number> {
  const [manual, auto] = await Promise.all([
    getSubtitleOffset(key),
    getAutoSyncPrefs(key),
  ]);
  return auto.autoOffsetMs + manual * 1000;
}
