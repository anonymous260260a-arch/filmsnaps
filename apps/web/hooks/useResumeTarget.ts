/**
 * useResumeTarget — resume-aware target for a detail page's primary Watch
 * button. Wraps `useResumePoint` and builds the watch-route href with the
 * `?t=<seconds>` seek offset (and TV season/episode when known) appended.
 *
 * There is no separate "Resume" button: when a resume point exists the caller
 * relabels its Watch button to "Resume" and pushes this href instead.
 * Without a point, `href === watchHref` so callers can push it unconditionally.
 */

import { useResumePoint, type ResumePoint } from "./useResumePoint";

export function useResumeTarget(
  tmdbId: string | undefined | null,
  mediaType: "movie" | "tv" | undefined,
  watchHref: string,
  season?: number,
  episode?: number,
): { point: ResumePoint | null; href: string } {
  const point = useResumePoint(tmdbId, mediaType, season, episode);

  if (!point) return { point: null, href: watchHref };

  const params = new URLSearchParams();
  if (point.season != null) params.set("season", String(point.season));
  if (point.episode != null) params.set("episode", String(point.episode));
  params.set("t", String(Math.floor(point.currentTime)));
  const join = watchHref.includes("?") ? "&" : "?";
  return { point, href: `${watchHref}${join}${params.toString()}` };
}
