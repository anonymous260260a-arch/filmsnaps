import { IMAGE_BASE_URL } from '../constants/tmdb';

/**
 * Cross-platform TMDB client.
 *
 * Calls the web app's /api/tmdb pass-through endpoint so the API key
 * stays server-side. Works in both browser and React Native.
 *
 * @param apiBase - Base URL of the Filmsnaps API.
 *   Browser: '' (same origin)
 *   React Native dev: 'http://localhost:3000' or 'http://10.0.2.2:3000'
 *   React Native prod: 'https://filmsnaps.app'
 */
export function createTmdbApi(apiBase: string) {
  const fetchTmdb = async (path: string) => {
    const res = await fetch(`${apiBase}/api/tmdb${path}`, {
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`TMDB API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
  };

  return {
    getTrendingMovies: () => fetchTmdb('/trending/movie/week'),

    getTrendingTV: () => fetchTmdb('/trending/tv/week'),

    getPopularMovies: (page = 1) => fetchTmdb(`/movie/popular?page=${page}`),

    getUpcomingMovies: () => fetchTmdb('/movie/upcoming'),

    getMovieDetails: (id: number | string) =>
      fetchTmdb(`/movie/${id}?append_to_response=videos,credits,similar`),

    getTVDetails: (id: number | string) =>
      fetchTmdb(`/tv/${id}?append_to_response=videos,credits,similar`),

    getSeasonEpisodes: (tvId: number | string, seasonNumber: number) =>
      fetchTmdb(`/tv/${tvId}/season/${seasonNumber}`),

    searchMulti: (query: string) =>
      fetchTmdb(`/search/multi?query=${encodeURIComponent(query)}`),

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
      if (params.genreIds?.length) q.set('with_genres', params.genreIds.join(','));
      if (params.yearStart && params.yearEnd) {
        q.set('primary_release_date.gte', `${params.yearStart}-01-01`);
        q.set('primary_release_date.lte', `${params.yearEnd}-12-31`);
      }
      if (params.minRating !== undefined) q.set('vote_average.gte', String(params.minRating));
      if (params.maxRating !== undefined) q.set('vote_average.lte', String(params.maxRating));
      if (params.language) q.set('with_original_language', params.language);

      return fetchTmdb(`/discover/movie?${q}`);
    },

    getTVShows: (params: {
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
      if (params.genreIds?.length) q.set('with_genres', params.genreIds.join(','));
      if (params.yearStart && params.yearEnd) {
        q.set('first_air_date.gte', `${params.yearStart}-01-01`);
        q.set('first_air_date.lte', `${params.yearEnd}-12-31`);
      }
      if (params.minRating !== undefined) q.set('vote_average.gte', String(params.minRating));
      if (params.maxRating !== undefined) q.set('vote_average.lte', String(params.maxRating));
      if (params.language) q.set('with_original_language', params.language);

      return fetchTmdb(`/discover/tv?${q}`);
    },
  };
}

/** Re-export the image URL builder for convenience */
export { IMAGE_BASE_URL };
export { getImageUrl } from '../utils/image';
export { getTrailerKey } from '../utils/video';
