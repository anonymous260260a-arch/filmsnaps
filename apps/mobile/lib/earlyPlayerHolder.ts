/**
 * earlyPlayerHolder — D3 pre-playback warm player.
 *
 * When the stream pipeline reaches READY while the user is still on the
 * details page, we construct an expo-video player on the chain head so the
 * native demuxer/decoder can start before navigation. HevcPlayer adopts the
 * held instance via `externalPlayer` and marks sourceSet/playerReady from
 * the adoption path instead of constructing a cold player.
 *
 * Rules:
 *  - LRU capacity 2 (details dwell rarely overlaps more than one title).
 *  - Keyed by the same cache key the watch pipeline uses:
 *      `${mediaType}:${tmdbId}:s${season ?? 0}:e${episode ?? 0}:${providerId}`
 *  - Skip falix / local file URLs / URL-param playback (no pipeline head).
 *  - Explicit release on: detail-unmount without navigating to watch,
 *    watch close, or key change. `take` removes the entry (adoption).
 */

import { createVideoPlayer, type VideoPlayer } from "expo-video";
import type { StreamLink } from "../components/player/streamTypes";

interface HeldPlayer {
  key: string;
  player: VideoPlayer;
  url: string;
  createdAt: number;
}

const MAX_HOLDERS = 2;
/** Insertion-ordered LRU: newest at the end. */
const holders = new Map<string, HeldPlayer>();

/**
 * Adoption claims, keyed by holder key. SINGLE-OWNER RULE: once `take`
 * hands the object to the watch screen, only that screen's terminal
 * `disposeEarlyPlayer` may release it. Borrowers (HevcPlayer instances)
 * must never release — React remount cleanup runs BEFORE the new mount's
 * effects, so any borrower-side release races the next borrower's render
 * (device 2026-09 crash: HevcPlayer mounted twice for one key, instance
 * A's cleanup released the adopted player while instance B's VideoView
 * was still rendering it — "Cannot use shared object that was already
 * released", the Integer is the dead native handle). Claim generations
 * and refcounts cannot fix that ordering; removing borrower-side releases
 * makes the crash structurally impossible.
 */
const claims = new Map<string, { player: VideoPlayer }>();

function shouldSkip(url: string): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();
  // Falix download-only / local files / content URIs — not pipeline heads.
  if (lower.startsWith("file://") || lower.startsWith("content://"))
    return true;
  if (lower.includes("falixmovies.com")) return true;
  return false;
}

function evictIfNeeded(): void {
  while (holders.size > MAX_HOLDERS) {
    const oldestKey = holders.keys().next().value;
    if (oldestKey === undefined) break;
    const held = holders.get(oldestKey);
    holders.delete(oldestKey);
    try {
      held?.player.release();
    } catch {}
  }
}

/**
 * Create and hold a warm player for the given chain head. Returns false when
 * the URL is ineligible (falix/local) or creation throws.
 */
export function holdEarlyPlayer(
  key: string,
  head: Pick<StreamLink, "url" | "headers"> | undefined,
): boolean {
  if (!key || !head?.url || shouldSkip(head.url)) return false;
  // Replace any previous hold for this key first.
  releaseEarlyPlayer(key);
  try {
    const player = createVideoPlayer({
      uri: head.url,
      headers: head.headers ?? {},
    });
    // Match HevcPlayer's construction knobs so adoption doesn't re-tune.
    player.loop = false;
    player.timeUpdateEventInterval = 0.25;
    player.preservesPitch = true;
    player.seekTolerance = { toleranceBefore: 5, toleranceAfter: 5 };
    // Do NOT play() here — a held player has no VideoView, so audio would
    // leak with no pause path (survives navigation + minimize). Constructing
    // the player still warms the demuxer; HevcPlayer plays on adoption.
    holders.set(key, {
      key,
      player,
      url: head.url,
      createdAt: Date.now(),
    });
    evictIfNeeded();
    console.log(`[Flow] early player HELD for ${key}`);
    return true;
  } catch (err) {
    console.log(
      `[Flow] early player hold failed for ${key}: ${err instanceof Error ? err.message : err}`,
    );
    return false;
  }
}

/**
 * Take the held player for this key (watch screen adopt). Removes it from
 * the holder and registers the adoption claim; the screen MUST call
 * `disposeEarlyPlayer(key)` on unmount — that is the ONLY release path
 * for the adopted object.
 */
export function takeEarlyPlayer(
  key: string,
): { player: VideoPlayer; url: string } | null {
  const held = holders.get(key);
  if (!held) return null;
  holders.delete(key);
  // Defensive: a previous claim for this key must never be orphaned.
  const prev = claims.get(key);
  if (prev && prev.player !== held.player) {
    try {
      prev.player.release();
    } catch {}
  }
  claims.set(key, { player: held.player });
  console.log(
    `[Flow] early player ADOPTED for ${key} (age ${Date.now() - held.createdAt}ms)`,
  );
  return { player: held.player, url: held.url };
}

/**
 * Terminal release for a key: the adopted player (if a claim remains) AND
 * any holder entry that was never taken. Idempotent. The watch screen's
 * single release site on unmount.
 */
export function disposeEarlyPlayer(key: string): void {
  const claim = claims.get(key);
  if (claim) {
    claims.delete(key);
    try {
      claim.player.release();
      console.log(`[Flow] early player DISPOSED for ${key}`);
    } catch {}
  }
  releaseEarlyPlayer(key);
}

/** Release a specific key (detail unmount without watch, watch close). */
export function releaseEarlyPlayer(key: string): void {
  const held = holders.get(key);
  if (!held) return;
  holders.delete(key);
  try {
    held.player.release();
    console.log(`[Flow] early player RELEASED for ${key}`);
  } catch {}
}

/** Release everything (media change / cache clear). */
export function releaseAllEarlyPlayers(): void {
  for (const held of holders.values()) {
    try {
      held.player.release();
    } catch {}
  }
  holders.clear();
  for (const claim of claims.values()) {
    try {
      claim.player.release();
    } catch {}
  }
  claims.clear();
}

/** Debug/telemetry: how many warm players are held. */
export function earlyPlayerCount(): number {
  return holders.size;
}
