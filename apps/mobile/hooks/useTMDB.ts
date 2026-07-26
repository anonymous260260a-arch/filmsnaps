import { useQuery } from "@tanstack/react-query";
import { tmdbApi } from "../lib/api";

const MIN = 60_000;
const DAY = 86_400_000;

// ── Movies ──

export function useTrendingMovies() {
  return useQuery({
    queryKey: ["movies", "trending"],
    queryFn: () => tmdbApi.getTrendingMovies(),
    staleTime: 10 * MIN,
  });
}

export function usePopularMovies(page = 1) {
  return useQuery({
    queryKey: ["movies", "popular", page],
    queryFn: () => tmdbApi.getPopularMovies(page),
    staleTime: 10 * MIN,
  });
}

export function useUpcomingMovies() {
  return useQuery({
    queryKey: ["movies", "upcoming"],
    queryFn: () => tmdbApi.getUpcomingMovies(),
    staleTime: DAY, // release schedule changes infrequently
  });
}

export function useMovieDetails(id: number | string) {
  return useQuery({
    queryKey: ["movie", id],
    queryFn: () => tmdbApi.getMovieDetails(id),
    staleTime: 7 * DAY, // TMDB metadata is essentially static
  });
}

// ── TV ──

export function useTrendingTV() {
  return useQuery({
    queryKey: ["tv", "trending"],
    queryFn: () => tmdbApi.getTrendingTV(),
    staleTime: 10 * MIN,
  });
}

export function useTVDetails(id: number | string) {
  return useQuery({
    queryKey: ["tv", id],
    queryFn: () => tmdbApi.getTVDetails(id),
    staleTime: 7 * DAY,
  });
}

export function useTVSeasonsOnly(id: number | string) {
  return useQuery({
    queryKey: ["tv", id, "seasons"],
    queryFn: () => tmdbApi.getTVSeasonsOnly(id),
    staleTime: 7 * DAY,
  });
}

export function useSeasonEpisodes(tvId: number | string, seasonNumber: number) {
  return useQuery({
    queryKey: ["tv", tvId, "season", seasonNumber],
    queryFn: () => tmdbApi.getSeasonEpisodes(tvId, seasonNumber),
    staleTime: 7 * DAY,
    enabled: !!tvId && !!seasonNumber,
  });
}

// ── Search ──

export function useSearch(query: string, page = 1) {
  return useQuery({
    queryKey: ["search", query, page],
    queryFn: () => tmdbApi.searchMulti(query, page),
    enabled: query.length >= 2,
    staleTime: 5 * MIN,
  });
}

// ── Person / Cast ──

export function usePersonDetails(id: number) {
  return useQuery({
    queryKey: ["person", id],
    queryFn: () => tmdbApi.getPersonDetails(id),
    staleTime: 7 * DAY,
    enabled: !!id,
  });
}

export function usePersonCredits(id: number) {
  return useQuery({
    queryKey: ["person", id, "credits"],
    queryFn: () => tmdbApi.getPersonCredits(id),
    staleTime: 7 * DAY,
    enabled: !!id,
  });
}

// ── More Like This (genre-based recommendations from history) ──

export function useMoreLikeThis(
  historyEntries: Array<{
    latest: { tmdbId: string | number; mediaType: string };
  }>,
) {
  const hasHistory = historyEntries.length > 0;
  return useQuery({
    queryKey: ["movies", "more-like-this", historyEntries[0]?.latest?.tmdbId],
    queryFn: async () => {
      if (!hasHistory) return [];
      const last = historyEntries[0].latest;
      let details: any;
      if (last.mediaType === "tv") {
        details = await tmdbApi.getTVDetails(Number(last.tmdbId));
      } else {
        details = await tmdbApi.getMovieDetails(Number(last.tmdbId));
      }
      const genreIds = details?.genres?.slice(0, 2).map((g: any) => g.id) ?? [];
      if (genreIds.length === 0) return [];
      const result = await tmdbApi.getMovies({
        genreIds,
        sortBy: "popularity.desc",
      });
      return (result.results ?? []).filter(
        (m: any) => m.id !== Number(last.tmdbId),
      );
    },
    staleTime: DAY,
    enabled: hasHistory,
  });
}

// ── Filtered Discover ──

export function useFilteredMovies(params: {
  genreIds?: number[];
  sortBy?: string;
  page?: number;
}) {
  return useQuery({
    queryKey: ["movies", "filtered", params],
    queryFn: () => tmdbApi.getMovies(params),
    staleTime: 10 * MIN,
  });
}

export function useFilteredTVShows(params: {
  genreIds?: number[];
  sortBy?: string;
  page?: number;
}) {
  return useQuery({
    queryKey: ["tv", "filtered", params],
    queryFn: () => tmdbApi.getTVShows(params),
    staleTime: 10 * MIN,
  });
}
