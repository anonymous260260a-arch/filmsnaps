import { useQuery } from '@tanstack/react-query';
import { tmdbApi } from '../lib/api';

// ── Movies ──

export function useTrendingMovies() {
  return useQuery({
    queryKey: ['movies', 'trending'],
    queryFn: () => tmdbApi.getTrendingMovies(),
    staleTime: 1000 * 60 * 10, // 10 min
  });
}

export function usePopularMovies(page = 1) {
  return useQuery({
    queryKey: ['movies', 'popular', page],
    queryFn: () => tmdbApi.getPopularMovies(page),
    staleTime: 1000 * 60 * 10,
  });
}

export function useUpcomingMovies() {
  return useQuery({
    queryKey: ['movies', 'upcoming'],
    queryFn: () => tmdbApi.getUpcomingMovies(),
    staleTime: 1000 * 60 * 10,
  });
}

export function useMovieDetails(id: number | string) {
  return useQuery({
    queryKey: ['movie', id],
    queryFn: () => tmdbApi.getMovieDetails(id),
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

// ── TV ──

export function useTrendingTV() {
  return useQuery({
    queryKey: ['tv', 'trending'],
    queryFn: () => tmdbApi.getTrendingTV(),
    staleTime: 1000 * 60 * 10,
  });
}

export function useTVDetails(id: number | string) {
  return useQuery({
    queryKey: ['tv', id],
    queryFn: () => tmdbApi.getTVDetails(id),
    staleTime: 1000 * 60 * 60,
  });
}

export function useSeasonEpisodes(tvId: number | string, seasonNumber: number) {
  return useQuery({
    queryKey: ['tv', tvId, 'season', seasonNumber],
    queryFn: () => tmdbApi.getSeasonEpisodes(tvId, seasonNumber),
    staleTime: 1000 * 60 * 60,
    enabled: !!tvId && !!seasonNumber,
  });
}

// ── Search ──

export function useSearch(query: string) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: () => tmdbApi.searchMulti(query),
    enabled: query.length >= 2,
    staleTime: 1000 * 60 * 5,
  });
}
