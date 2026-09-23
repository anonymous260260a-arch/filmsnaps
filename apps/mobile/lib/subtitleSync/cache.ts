/**
 * Result caching keyed by contentId, never URL.
 * AsyncStorage-backed, best-effort.
 *
 * RULE: any change to the signal engine (VAD, scorer) must bump BOTH version
 * tokens — cached evidence from a different engine is stale by definition.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SpeechSignal } from "./types";
import { validateSignal } from "./types";
import { ENGINE_TOKEN } from "./engineConstants";

const KEY_PREFIX = "@subtitles/autosync:";

/**
 * Namespace version applied to BOTH cache families (B1). Bumped to "v2" in the
 * round-4 audit fix so every pre-fix entry is orphaned:
 *   - a poisoned full-result entry (offsetMs -73900, confidence 0.70) replayed
 *     twice through cache hits and re-applied a 74s wrong shift;
 *   - window entries written before the signal payload existed (B2) carry no
 *     signalB64, so a rerun could not cross-validate its own candidates.
 * Orphaning is deliberate: the old keys stay on disk, unreachable.
 */
// v3: Silero v5.1.2 — all pre-Silero full results are stale (energy-VAD era).
const CACHE_NAMESPACE = "v3";

export type CachedSync = {
  offsetMs: number;
  scale: number;
  method: "offset" | "rewrite";
  confidence: number;
  createdAt: number;
};

/**
 * Per-window correlation cache: skips re-scanning a window on retry/re-run.
 *
 * Since B2 the entry also carries the decoded signal, so a cache hit can
 * rebuild the SpeechSignal (validateSignal) and the disagreement
 * cross-validation still has both windows' audio to work with. An entry
 * without the payload is treated as a MISS and the window is re-scanned.
 */
export type CachedWindow = {
  offsetMs: number;
  confidence: number;
  createdAt: number;
  /** Signal payload (B2). Absent on pre-fix entries -> cache miss. */
  startSec?: number;
  endSec?: number;
  bins?: number;
  signalB64?: string;
};

/** DJB2 hash - stable, fast, no deps. */
function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function cacheKey(subtitleCacheKey: string, contentId: string): string {
  // W1-d: BOTH cache families carry ENGINE_TOKEN so a mark-threshold change
  // (0.35→0.42) orphans full-result entries the same way it orphans windows —
  // no manual namespace bump, no stale replay. Previously only the window
  // family had it (the trap).
  return `${KEY_PREFIX}${ENGINE_TOKEN}/${subtitleCacheKey}:${djb2(contentId)}:${CACHE_NAMESPACE}`;
}

function windowCacheKey(
  subtitleCacheKey: string,
  contentId: string,
  windowKey: string,
): string {
  // "v8/" invalidates window results produced by the pre-servo VAD: its duty
  // cycle drifted with the mix (0.227 on one file, 0.454 on another, vs the
  // ~0.20 target), and a dense speech signal flattens the correlation surface
  // (Lioness S01E01: three incompatible candidates at 0.28/0.28/0.27). Those
  // results must not replay against the corrected signal.
  //
  // Earlier: "v7/" invalidated results from before the flow-relative scorer:
  // the old normalizers let a true-but-clipped offset lose to an all-inside
  // wrong one (Blacklist +54s -> -6.25s, Lanterns +85.25s -> -10.45s), and the
  // 0.65 confidence ceiling collapsed every confidence to ~0.001. Results from
  // that era are meaningless and must never replay.
  //
  // Round 4 (B1): the stale "the full-result cache is NOT version-bumped" note
  // is superseded - BOTH families now carry CACHE_NAMESPACE, because a poisoned
  // full-result entry DID replay and re-apply a 74s wrong shift.
  // v9: Silero v5.1.2 asset swap — all pre-Silero window signals (EnergyVad) are stale.
  // v10: F6 Silero mark-threshold hysteresis (MARK_ON 0.35 / MARK_OFF 0.25) — every
  // cached signal still carries old-rule (prob >= 0.5) marks and must not replay.
  // Stage D: ENGINE_TOKEN (derived from MARK_ON/MARK_OFF in engineConstants)
  // replaces the hardcoded v10 token — a threshold change orphans old entries
  // automatically without a second place to remember to bump.
  return `${KEY_PREFIX}${ENGINE_TOKEN}/win/${subtitleCacheKey}:${djb2(contentId)}:${windowKey}:${CACHE_NAMESPACE}`;
}

export async function getCachedSync(
  subtitleCacheKey: string,
  contentId: string,
): Promise<CachedSync | null> {
  try {
    const raw = await AsyncStorage.getItem(
      cacheKey(subtitleCacheKey, contentId),
    );
    if (!raw) return null;
    return JSON.parse(raw) as CachedSync;
  } catch {
    return null;
  }
}

export async function setCachedSync(
  subtitleCacheKey: string,
  contentId: string,
  value: CachedSync,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      cacheKey(subtitleCacheKey, contentId),
      JSON.stringify(value),
    );
  } catch {
    // persistence is best-effort
  }
}

export async function invalidateCachedSync(
  subtitleCacheKey: string,
  contentId: string,
): Promise<void> {
  try {
    await AsyncStorage.removeItem(cacheKey(subtitleCacheKey, contentId));
  } catch {
    // best-effort
  }
}

/**
 * Cache hit, with its signal rebuilt (B2 + R5-1).
 *
 * The rebuild lives here on purpose: `validateSignal` throws on a corrupt
 * payload (e.g. a truncated signalB64), and an unrebuildable entry must be a
 * MISS so the window is re-scanned. Doing the rebuild at the call site made a
 * corrupt entry abort the whole sync instead.
 */
export type CachedWindowHit = CachedWindow & { signal: SpeechSignal };

export async function getCachedWindow(
  subtitleCacheKey: string,
  contentId: string,
  windowKey: string,
): Promise<CachedWindowHit | null> {
  try {
    const raw = await AsyncStorage.getItem(
      windowCacheKey(subtitleCacheKey, contentId, windowKey),
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedWindow;
    // Never treat a no-confidence result as a hit - it blocks re-scans.
    if (parsed.confidence < 0.3) return null;
    // An entry without the signal payload cannot be cross-validated: miss.
    if (
      typeof parsed.signalB64 !== "string" ||
      parsed.signalB64.length === 0 ||
      typeof parsed.startSec !== "number" ||
      typeof parsed.endSec !== "number" ||
      typeof parsed.bins !== "number" ||
      parsed.bins <= 0
    ) {
      return null;
    }
    try {
      const signal = validateSignal({
        rate: 100,
        startSec: parsed.startSec,
        endSec: parsed.endSec,
        bins: parsed.bins,
        signalB64: parsed.signalB64,
      });
      return { ...parsed, signal };
    } catch (e: any) {
      // R5-1: unrebuildable payload == miss (rescan), never a hard failure.
      console.log(
        `[SubSync] cached window payload unrebuildable (${e?.message ?? e}) - rescanning`,
      );
      return null;
    }
  } catch {
    return null;
  }
}

export async function setCachedWindow(
  subtitleCacheKey: string,
  contentId: string,
  windowKey: string,
  value: CachedWindow,
): Promise<void> {
  if (value.confidence < 0.3) return; // failures are not cacheable
  try {
    await AsyncStorage.setItem(
      windowCacheKey(subtitleCacheKey, contentId, windowKey),
      JSON.stringify(value),
    );
  } catch {
    // persistence is best-effort
  }
}
