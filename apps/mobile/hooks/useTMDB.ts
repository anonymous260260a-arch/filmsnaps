import { useQuery } from '@tanstack/react-query';
import { tmdbApi } from '../lib/api';

// ── Movies ──

export function useTrendingMovies() {
  return useQuery({
    queryKey: ['movies', 'trending'],
    queryFn: () => tmdbApi.getTrendingMovies(),
    staleTime: 1000 * 60 * 10, // 10 min
    gcTime: 1000 * 60 * 30,    // 30 min
    refetchOnWindowFocus: false,
  });
}

export function usePopularMovies(page = 1) {
  return useQuery({
    queryKey: ['movies', 'popular', page],
    queryFn: () => tmdbApi.getPopularMovies(page),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
  });
}

export function useUpcomingMovies() {
  return useQuery({
    queryKey: ['movies', 'upcoming'],
    queryFn: () => tmdbApi.getUpcomingMovies(),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
  });
}

export function useMovieDetails(id: number | string) {
  return useQuery({
    queryKey: ['movie', id],
    queryFn: () => tmdbApi.getMovieDetails(id),
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 60,    // 1 hour
    refetchOnWindowFocus: false,
  });
}

// ── TV ──

export function useTrendingTV() {
  return useQuery({
    queryKey: ['tv', 'trending'],
    queryFn: () => tmdbApi.getTrendingTV(),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
  });
}

export function useTVDetails(id: number | string) {
  return useQuery({
    queryKey: ['tv', id],
    queryFn: () => tmdbApi.getTVDetails(id),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
  });
}

export function useTVSeasonsOnly(id: number | string) {
  return useQuery({
    queryKey: ['tv', id, 'seasons'],
    queryFn: () => tmdbApi.getTVSeasonsOnly(id),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
  });
}

export function useSeasonEpisodes(tvId: number | string, seasonNumber: number) {
  return useQuery({
    queryKey: ['tv', tvId, 'season', seasonNumber],
    queryFn: () => tmdbApi.getSeasonEpisodes(tvId, seasonNumber),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60,
    enabled: !!tvId && !!seasonNumber,
    refetchOnWindowFocus: false,
  });
}

// ── Search ──

export function useSearch(query: string) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: () => tmdbApi.searchMulti(query),
    enabled: query.length >= 2,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
    refetchOnWindowFocus: false,
  });
}

// ── Person / Cast ──

export function usePersonDetails(id: number) {
  return useQuery({
    queryKey: ['person', id],
    queryFn: () => tmdbApi.getPersonDetails(id),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60,
    enabled: !!id,
    refetchOnWindowFocus: false,
  });
}

export function usePersonCredits(id: number) {
  return useQuery({
    queryKey: ['person', id, 'credits'],
    queryFn: () => tmdbApi.getPersonCredits(id),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60,
    enabled: !!id,
    refetchOnWindowFocus: false,
  });
}

// ── Filtered Discover (for search/browse) ──

export function useFilteredMovies(params: {
  genreIds?: number[];
  sortBy?: string;
  page?: number;
}) {
  return useQuery({
    queryKey: ['movies', 'filtered', params],
    queryFn: () => tmdbApi.getMovies(params),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
  });
}

export function useFilteredTVShows(params: {
  genreIds?: number[];
  sortBy?: string;
  page?: number;
}) {
  return useQuery({
    queryKey: ['tv', 'filtered', params],
    queryFn: () => tmdbApi.getTVShows(params),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
  });
}
