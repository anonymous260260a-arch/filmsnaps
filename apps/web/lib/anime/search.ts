/**
 * Anime search client — talks to /api/anime/search (AniList GraphQL proxy,
 * 24h edge-cached server-side; never call graphql.anilist.co directly from
 * the browser — keep the single-upstream-request guarantee in one place).
 *
 * Ranking reuses rankSearchResults' hybrid philosophy (verdict §9 Q3):
 * fuzzy title match dominates, then community score, then popularity as the
 * mass-appeal proxy. Type badges (TV/OVA/ONA/Special) are surfaced on cards,
 * not in ranking.
 */

import Fuse from "fuse.js";

/** Slim result shape returned by /api/anime/search. */
export interface AnimeResult {
  malId: number;
  anilistId: number | null;
  tmdbShowId?: number;
  tmdbMovieId?: number;
  title: string;
  titleEnglish: string | null;
  image: string | null;
  year: number | null;
  episodes: number | null;
  /** TV | Movie | OVA | ONA | Special */
  type: string | null;
  score: number | null;
  members: number | null;
}

export interface AnimeSearchResponse {
  query: string;
  count: number;
  /** Titles dropped because they have no TMDB twin (hidden in v1, Q1). */
  hiddenUnmapped: number;
  results: AnimeResult[];
}

export async function animeSearch(
  query: string,
  limit = 20,
): Promise<AnimeSearchResponse> {
  const res = await fetch(
    `/api/anime/search?q=${encodeURIComponent(query)}&limit=${limit}`,
  );
  if (!res.ok) throw new Error(`anime search failed (${res.status})`);
  return res.json();
}

export interface ScoredAnimeResult extends AnimeResult {
  _score: number;
  _fuzzyScore: number;
}

function preprocessQuery(q: string): string {
  return q
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s-]/g, "");
}

/**
 * Rank anime results: fuzzy ×0.45 + score ×0.3 + log-popularity ×0.25.
 * `members` now carries AniList popularity (~1k…~1M) but log-scaling keeps
 * the ordering identical; the 3M ceiling just compresses absolute scores.
 */
export function rankAnimeSearchResults(
  results: AnimeResult[],
  query: string,
  maxResults = 24,
): ScoredAnimeResult[] {
  const q = preprocessQuery(query);
  if (!q || results.length === 0) return [];

  const fuse = new Fuse(results, {
    keys: ["title", "titleEnglish"],
    threshold: 0.45,
    includeScore: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  const LOG_CEIL = Math.log10(3_000_000);

  return fuse
    .search(q)
    .map((fr) => {
      const item = fr.item;
      // Fuse similarity: 0 = perfect match (typings mark it optional).
      const fuzzyScore = Math.max(0, (1 - (fr.score ?? 0)) * 100);
      let score = fuzzyScore * 0.45;

      // Community score 0-10 → 0-100
      score += ((item.score ?? 0) / 10) * 100 * 0.3;

      // Popularity proxy: log-scaled tracking users
      const memberScore =
        item.members && item.members > 0
          ? Math.min(Math.log10(item.members) / LOG_CEIL, 1) * 100
          : 0;
      score += memberScore * 0.25;

      return {
        ...item,
        _score: Math.round(score * 100) / 100,
        _fuzzyScore: fuzzyScore,
      };
    })
    .filter((item) => item._fuzzyScore > 5)
    .sort((a, b) => b._score - a._score)
    .slice(0, maxResults);
}
