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

function shouldSkip(url: string): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();
  // Falix download-only / local files / content URIs — not pipeline heads.
  if (lower.startsWith("file://") || lower.startsWith("content://")) return true;
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
 * Take ownership of the held player for this key (HevcPlayer adopt).
 * Removes it from the holder — the consumer owns release from here on.
 */
export function takeEarlyPlayer(
  key: string,
): { player: VideoPlayer; url: string } | null {
  const held = holders.get(key);
  if (!held) return null;
  holders.delete(key);
  console.log(`[Flow] early player ADOPTED for ${key} (age ${Date.now() - held.createdAt}ms)`);
  return { player: held.player, url: held.url };
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
}

/** Debug/telemetry: how many warm players are held. */
export function earlyPlayerCount(): number {
  return holders.size;
}
