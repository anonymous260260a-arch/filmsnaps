/**
 * Mobile anime search client — talks to the web backend's AniList proxy
 * (/api/anime/search) because mobile ships no native AniList integration and
 * must stay OTA-only (no new deps; fuse.js was rejected for that reason).
 *
 * Ranking is a dependency-free re-implementation of web's rankAnimeSearchResults:
 * fuzzy title match (Levenshtein-similarity, no fuse.js) dominates, then
 * community score, then log-popularity. The server already pre-filters to
 * TMDB-twinned titles, so this only re-orders.
 */

import { getApiBaseUrl } from "../api";

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
  const base = getApiBaseUrl();
  const res = await fetch(
    `${base}/api/anime/search?q=${encodeURIComponent(query)}&limit=${limit}`,
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

// ── Minimal Levenshtein (no fuse.js) ──
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Similarity 0..1 (1 = identical) between two strings. */
function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Rank anime results: fuzzy ×0.45 + score ×0.3 + log-popularity ×0.25.
 * Dependency-free (uses similarity() instead of Fuse).
 */
export function rankAnimeSearchResults(
  results: AnimeResult[],
  query: string,
  maxResults = 24,
): ScoredAnimeResult[] {
  const q = preprocessQuery(query);
  if (!q || results.length === 0) return [];

  const LOG_CEIL = Math.log10(3_000_000);

  return results
    .map((item) => {
      const titles = [item.title, item.titleEnglish].filter(
        Boolean,
      ) as string[];
      const bestFuzzy = Math.max(
        0,
        ...titles.map((t) => similarity(q, preprocessQuery(t)) * 100),
      );
      let score = bestFuzzy * 0.45;
      score += ((item.score ?? 0) / 10) * 100 * 0.3;
      const memberScore =
        item.members && item.members > 0
          ? Math.min(Math.log10(item.members) / LOG_CEIL, 1) * 100
          : 0;
      score += memberScore * 0.25;
      return {
        ...item,
        _score: Math.round(score * 100) / 100,
        _fuzzyScore: bestFuzzy,
      };
    })
    .filter((item) => item._fuzzyScore > 5)
    .sort((a, b) => b._score - a._score)
    .slice(0, maxResults);
}
