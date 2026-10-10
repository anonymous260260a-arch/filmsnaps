import { getAnonId } from "../telemetry/anonId";
import type { AdsConfig } from "./types";

/**
 * Deterministic per-install rollout bucket.
 *
 * Same anonId always lands in the same bucket, so a staged enable
 * (10% → 50% → 100%) never flickers between sessions and needs no OTA.
 */
export function hashBucket(anonId: string): number {
  // FNV-1a 32-bit — tiny, stable, no deps.
  let h = 0x811c9dc5;
  for (let i = 0; i < anonId.length; i++) {
    h ^= anonId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 100;
}

/**
 * Final per-slot decision:
 *  1. global kill off → no
 *  2. SDK/AppId missing (old binary or blank config) → no
 *  3. no anonId yet (telemetry gate closed / still loading) → no
 *  4. this install not in the rollout bucket → no
 *  5. slot itself disabled in config → no
 */
export function shouldShowAdSlot(
  config: AdsConfig,
  slot: keyof AdsConfig["slots"],
  anonId: string | null,
): boolean {
  if (!config.enabled) return false;
  if (!config.appId) return false;
  if (!anonId) return false;
  if (config.rolloutPercent <= 0) return false;
  if (hashBucket(anonId) >= config.rolloutPercent) return false;
  return config.slots[slot]?.enabled === true;
}

/** Start.io ad tags are letters-only — map our snake_case slot ids over. */
export function adTagForSlot(slot: string): string {
  return slot.replace(/[^a-zA-Z0-9]/g, "");
}
