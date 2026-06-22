import Fuse from 'fuse.js';

const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';
const BASE_API = '/api/tmdb';

export const getImageUrl = (path?: string, size = 'original') => {
  if (!path) return '/placeholder.jpg';
  return `${IMAGE_BASE_URL}/${size}${path}`;
};

export const getTrailerKey = (videos: any) => {
  return videos?.results?.find(
    (v: any) => v.type === 'Trailer' && v.site === 'YouTube'
  )?.key;
};

const getBaseUrl = () => {
  // Browser
  if (typeof window !== 'undefined') {
    return '';
  }

  // Server (Vercel / Node)
  return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
};

const apiFetch = async (path: string) => {
  const baseUrl = getBaseUrl();

  const res = await fetch(`${baseUrl}/api/tmdb${path}`, {
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error('Failed to fetch TMDB data');
  }

  return res.json();
};

export const tmdbApi = {
  getTrendingMovies: () => apiFetch('/trending/movie/week'),

  getTrendingTV: () => apiFetch('/trending/tv/week'),

  getPopularMovies: (page = 1) => apiFetch(`/movie/popular?page=${page}`),

  getUpcomingMovies: () => apiFetch('/movie/upcoming'),

  getMovieDetails: (id: number | string) =>
    apiFetch(`/movie/${id}?append_to_response=videos,credits,similar`),

  searchMulti: (query: string) =>
    apiFetch(`/search/multi?query=${encodeURIComponent(query)}&language=en-US&include_adult=false`),

  searchMultiVerbose: (query: string, page = 1) =>
    apiFetch(`/search/multi?query=${encodeURIComponent(query)}&language=en-US&include_adult=false&page=${page}`),

  getMovies: (params: {
    genreIds?: number[];
    sortBy?: string;
    yearStart?: number;
    yearEnd?: number;
    minRating?: number;
    maxRating?: number;
    language?: string;
    page?: number;
  }) => {
    const q = new URLSearchParams();
    q.set('page', String(params.page ?? 1));
    q.set('sort_by', params.sortBy ?? 'popularity.desc');

    if (params.genreIds?.length)
      q.set('with_genres', params.genreIds.join(','));

    if (params.yearStart && params.yearEnd) {
      q.set('primary_release_date.gte', `${params.yearStart}-01-01`);
      q.set('primary_release_date.lte', `${params.yearEnd}-12-31`);
    }

    if (params.minRating !== undefined)
      q.set('vote_average.gte', String(params.minRating));
    if (params.maxRating !== undefined)
      q.set('vote_average.lte', String(params.maxRating));
    if (params.language) q.set('with_original_language', params.language);

    return apiFetch(`/discover/movie?${q}`);
  },
};

// ── Helper: normalize a query for variant generation ──
function preprocessQuery(q: string): string {
  return q
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')        // collapse whitespace
    .replace(/[^\w\s-]/g, '');   // strip punctuation except hyphens
}

// ── Helper: generate search variants ──
function generateVariants(query: string): string[] {
  const raw = preprocessQuery(query);
  const set = new Set<string>([raw]);
  const noSpace = raw.replace(/\s+/g, '');
  if (noSpace !== raw) set.add(noSpace);
  const dashed = raw.replace(/\s+/g, '-');
  if (dashed !== raw && !set.has(dashed)) set.add(dashed);
  // "spider-man" → also search as "spider man"
  const unDashed = raw.replace(/[-_]/g, ' ');
  if (unDashed !== raw) set.add(unDashed);
  return Array.from(set);
}

/**
 * Smart search — tries multiple query variants in parallel,
 * merges results deduplicated by TMDB ID.
 *
 * Variants: original query, no-space, dashed, un-dashed.
 * This handles "zombie land" → "zombieland", "spider-man" → "spider man", etc.
 */
export async function smartSearch(query: string): Promise<{
  results: any[];
  page: number;
  total_pages: number;
  total_results: number;
}> {
  const variants = generateVariants(query);

  const responses = await Promise.all(
    variants.map((q) =>
      apiFetch(
        `/search/multi?query=${encodeURIComponent(q)}&language=en-US&include_adult=false`,
      ),
    ),
  );

  // Merge results, dedup by ID (first variant's results keep priority)
  const seen = new Set<number>();
  const merged: any[] = [];
  for (const resp of responses) {
    for (const item of resp.results || []) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
  }

  return {
    results: merged,
    page: 1,
    total_pages: 1,
    total_results: merged.length,
  };
}

/**
 * Rank search results using a hybrid of Fuse.js fuzzy matching and
 * popularity/vote signals.
 *
 * Pipeline:
 *   1. Filter to movies + TV only
 *   2. Run Fuse.js fuzzy search against titles (handles spacing, partial, typos)
 *   3. Hybrid score: fuzzyScore × 0.5 + popularity × 0.2 + voteAvg × 0.2 + voteCount × 0.1
 *   4. Filter out low-confidence results, slice to maxResults
 */
export interface ScoredResult {
  _score: number;
  _fuzzyScore: number;
  [key: string]: any;
}

export function rankSearchResults(
  results: any[],
  query: string,
  maxResults = 20,
): ScoredResult[] {
  const q = preprocessQuery(query);
  if (!q) return [];

  const candidates = results.filter(
    (r: any) => r.media_type === 'movie' || r.media_type === 'tv',
  );
  if (!candidates.length) return [];

  const fuse = new Fuse(candidates, {
    keys: ['title', 'name', 'original_title', 'original_name'],
    threshold: 0.45,
    includeScore: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  const fuseResults = fuse.search(q);

  const scored = fuseResults
    .map((fr: any) => {
      const item = fr.item;
      // fr.score: 0 = perfect match, 1 = no match → invert to 0-100
      const fuzzyScore = Math.max(0, (1 - fr.score) * 100);

      // ── Hybrid score: fuzzy dominates ──
      let score = fuzzyScore * 0.5;

      // Popularity (normalised to 0-100, scaled to 20% weight)
      const pop = Math.min((item.popularity || 0) / 5, 100);
      score += pop * 0.2;

      // Vote average (0-10 → 0-100, scaled to 20% weight)
      const voteAvg = (item.vote_average || 0) * 10;
      score += voteAvg * 0.2;

      // Vote count (scaled to 10% weight)
      const voteCount = Math.min((item.vote_count || 0) * 0.05, 20);
      score += voteCount * 0.1;

      return { ...item, _score: Math.round(score * 100) / 100, _fuzzyScore: fuzzyScore };
    })
    .filter((item: ScoredResult) => item._fuzzyScore > 5) // fuzzy must pass a minimum bar
    .sort((a: ScoredResult, b: ScoredResult) => b._score - a._score)
    .slice(0, maxResults);

  return scored;
}
