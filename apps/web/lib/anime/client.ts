/**
 * Browser-side anime resolution — thin typed client over /api/anime/resolve.
 * The heavy map stays server-side (Worker bundle); the watch page calls this
 * once per (title, season, episode) to get MegaPlay's MAL/AniList identity.
 */

import { apiUrl } from "@/lib/tmdb";

export interface ResolveShowOk {
  ok: true;
  malId: number;
  anilistId: number | null;
  /** MAL-relative episode for MegaPlay. */
  episode: number;
  matchedSeason: number | null;
  via: "season-match" | "single-candidate";
}

export interface ResolveMiss {
  ok: false;
  miss: true;
  reason: "no-candidates" | "no-season-match" | "episode-below-offset";
  candidates: number;
}

export type ShowResolutionResult = ResolveShowOk | ResolveMiss;

export async function resolveAnimeShow(
  tmdbShowId: string | number,
  season: number,
  episode: number,
): Promise<ShowResolutionResult> {
  const res = await fetch(
    apiUrl(
      `/api/anime/resolve?from=tmdb_show&id=${tmdbShowId}&season=${season}&episode=${episode}`,
    ),
  );
  if (!res.ok) throw new Error(`anime resolve failed (${res.status})`);
  return res.json();
}

export async function resolveAnimeMovie(
  tmdbMovieId: string | number,
): Promise<
  | { ok: true; malId: number; anilistId: number | null }
  | { ok: false; miss: true }
> {
  const res = await fetch(
    apiUrl(`/api/anime/resolve?from=tmdb_movie&id=${tmdbMovieId}`),
  );
  if (!res.ok) throw new Error(`anime resolve failed (${res.status})`);
  return res.json();
}
