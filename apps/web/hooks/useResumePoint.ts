/**
 * useResumePoint — fetch the best resume point for a movie or TV show.
 *
 * Reads `useWatchHistory.getResumePoint` against the shared storage adapter,
 * memoised per (tmdbId, mediaType) so it does not re-fire while the detail
 * page is mounted. Returns `null` when there is no meaningful progress
 * (not started, or fully completed).
 *
 * The caller builds the `?t=<seconds>` link to the watch route; the player
 * layer consumes `?t=` to seek on load (forward-compatible — the watch page
 * already accepts arbitrary search params via page.jsx).
 */

import { useEffect, useState } from "react";
import {
  createLocalStorageAdapter,
  useWatchHistory,
  type WatchProgress,
} from "@filmsnaps/shared";

const storage = createLocalStorageAdapter();

export interface ResumePoint {
  /** Current playback position in seconds. */
  currentTime: number;
  /** 0…1 of total duration. */
  percent: number;
  /** Human-friendly summary, e.g. "1h 42m" / "12m 5s". */
  label: string;
  /** TV-specific — season of the in-progress episode (if applicable). */
  season?: number;
  /** TV-specific — episode number (if applicable). */
  episode?: number;
}

export function useResumePoint(
  tmdbId: string | undefined | null,
  mediaType: "movie" | "tv" | undefined,
  season?: number,
  episode?: number,
): ResumePoint | null {
  const { getResumePoint } = useWatchHistory(storage);
  const [point, setPoint] = useState<ResumePoint | null>(null);

  useEffect(() => {
    if (!tmdbId || !mediaType) return;
    let active = true;
    getResumePoint(tmdbId, mediaType, season, episode).then((p) => {
      if (!active || !p) return;
      setPoint({
        currentTime: p.currentTime,
        percent: p.percent,
        label: formatSeconds(p.currentTime),
        season: p.season,
        episode: p.episode,
      });
    });
    return () => {
      active = false;
    };
  }, [tmdbId, mediaType, season, episode, getResumePoint]);

  return point;
}

/** Short, screen-reader-friendly duration string (no locale dependency). */
function formatSeconds(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
