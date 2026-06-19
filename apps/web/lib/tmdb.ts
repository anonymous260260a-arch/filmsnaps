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
    apiFetch(`/search/multi?query=${encodeURIComponent(query)}`),

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
/*
export const tmdbApi = {
  getTrending: (mediaType = 'all', timeWindow = 'week') =>
    fetcher(`/trending/${mediaType}/${timeWindow}`),

  getTrendingMovies: () => fetcher('/trending/movie/week'),

  getTrendingTV: () => fetcher('/trending/tv/week'),

  getPopularMovies: async (page = 1) => {
    const res = await fetch(
      `${BASE_URL}/movie/popular?api_key=${API_KEY}&page=${page}`,
      {
        next: { revalidate: 3600 },
        headers: CACHE_HEADERS,
      }
    );

    if (!res.ok) throw new Error('Failed to fetch popular movies');
    return res.json();
  },

  getPopularTV: async (page = 1) => {
    const res = await fetch(
      `${BASE_URL}/tv/popular?api_key=${API_KEY}&page=${page}`,
      {
        next: { revalidate: 3600 },
        headers: CACHE_HEADERS,
      }
    );

    if (!res.ok) throw new Error('Failed to fetch popular TV');
    return res.json();
  },

  getUpcomingMovies: () => fetcher('/movie/upcoming'),

  getMovieDetails: (id) =>
    fetcher(`/movie/${id}?append_to_response=videos,credits,similar`),

  getTVDetails: (id) =>
    fetcher(`/tv/${id}?append_to_response=videos,credits,similar`),

  searchMulti: (query) =>
    fetcher(`/search/multi?query=${encodeURIComponent(query)}`),

  getMovieVideos: (id) => fetcher(`/movie/${id}/videos`),

  getTVVideos: (id) => fetcher(`/tv/${id}/videos`),

  getMovieGenres: async () => {
    const res = await fetch(`${BASE_URL}/genre/movie/list?api_key=${API_KEY}`, {
      next: { revalidate: 86400 }, // Cache for 24 hours
      headers: CACHE_HEADERS,
    });

    if (!res.ok) throw new Error('Failed to fetch movie genres');
    return res.json();
  },

  getTVGenres: async () => {
    const res = await fetch(`${BASE_URL}/genre/tv/list?api_key=${API_KEY}`, {
      next: { revalidate: 86400 }, // Cache for 24 hours
      headers: CACHE_HEADERS,
    });

    if (!res.ok) throw new Error('Failed to fetch TV genres');
    return res.json();
  },

  getMovies: async ({
    genreIds,
    sortBy = 'popularity.desc',
    yearStart,
    yearEnd,
    minRating,
    maxRating,
    language,
    page = 1,
  }) => {
    let url = `${BASE_URL}/discover/movie?api_key=${API_KEY}&page=${page}&sort_by=${sortBy}`;

    if (genreIds && genreIds.length > 0) {
      url += `&with_genres=${genreIds.join(',')}`;
    }

    if (yearStart && yearEnd) {
      url += `&primary_release_date.gte=${yearStart}-01-01&primary_release_date.lte=${yearEnd}-12-31`;
    }

    if (minRating !== undefined) {
      url += `&vote_average.gte=${minRating}`;
    }

    if (maxRating !== undefined) {
      url += `&vote_average.lte=${maxRating}`;
    }

    if (language) {
      url += `&with_original_language=${language}`;
    }

    const res = await fetch(url, {
      next: { revalidate: 3600 },
      headers: CACHE_HEADERS,
    });

    if (!res.ok) throw new Error('Failed to fetch movies');
    return res.json();
  },

  getTVShows: async ({
    genreIds,
    sortBy = 'popularity.desc',
    yearStart,
    yearEnd,
    minRating,
    maxRating,
    language,
    page = 1,
  }) => {
    let url = `${BASE_URL}/discover/tv?api_key=${API_KEY}&page=${page}&sort_by=${sortBy}`;

    if (genreIds && genreIds.length > 0) {
      url += `&with_genres=${genreIds.join(',')}`;
    }

    if (yearStart && yearEnd) {
      url += `&first_air_date.gte=${yearStart}-01-01&first_air_date.lte=${yearEnd}-12-31`;
    }

    if (minRating !== undefined) {
      url += `&vote_average.gte=${minRating}`;
    }

    if (maxRating !== undefined) {
      url += `&vote_average.lte=${maxRating}`;
    }

    if (language) {
      url += `&with_original_language=${language}`;
    }

    const res = await fetch(url, {
      next: { revalidate: 3600 },
      headers: CACHE_HEADERS,
    });

    if (!res.ok) throw new Error('Failed to fetch TV shows');
    return res.json();
  },
};
*/
