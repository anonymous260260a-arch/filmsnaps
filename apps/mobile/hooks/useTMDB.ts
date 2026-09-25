import { useQuery, type QueryFunctionContext } from "@tanstack/react-query";
import { tmdbApi } from "../lib/api";
import { DETAIL_STALE_TIME } from "../lib/detailQuery";

const MIN = 60_000;
const DAY = 86_400_000;

type Ctx = QueryFunctionContext;

// ── Movies ──

export function useTrendingMovies() {
  return useQuery({
    queryKey: ["movies", "trending"],
    queryFn: (ctx: Ctx) => tmdbApi.getTrendingMovies(1, ctx.signal),
    staleTime: 10 * MIN,
  });
}

export function usePopularMovies(page = 1) {
  return useQuery({
    queryKey: ["movies", "popular", page],
    queryFn: (ctx: Ctx) => tmdbApi.getPopularMovies(page, ctx.signal),
    staleTime: 10 * MIN,
  });
}

export function useUpcomingMovies() {
  return useQuery({
    queryKey: ["movies", "upcoming"],
    queryFn: (ctx: Ctx) => tmdbApi.getUpcomingMovies(ctx.signal),
    staleTime: DAY, // release schedule changes infrequently
  });
}

export function useMovieDetails(id: number | string) {
  return useQuery({
    queryKey: ["movie", id],
    queryFn: (ctx: Ctx) => tmdbApi.getMovieDetails(id, ctx.signal),
    staleTime: DETAIL_STALE_TIME,
  });
}

// ── TV ──

export function useTrendingTV() {
  return useQuery({
    queryKey: ["tv", "trending"],
    queryFn: (ctx: Ctx) => tmdbApi.getTrendingTV(1, ctx.signal),
    staleTime: 10 * MIN,
  });
}

export function useTVDetails(id: number | string) {
  return useQuery({
    queryKey: ["tv", id],
    queryFn: (ctx: Ctx) => tmdbApi.getTVDetails(id, ctx.signal),
    staleTime: DETAIL_STALE_TIME,
  });
}

export function useTVSeasonsOnly(id: number | string) {
  return useQuery({
    queryKey: ["tv", id, "seasons"],
    queryFn: (ctx: Ctx) => tmdbApi.getTVSeasonsOnly(id, ctx.signal),
    staleTime: DETAIL_STALE_TIME,
  });
}

export function useSeasonEpisodes(tvId: number | string, seasonNumber: number) {
  return useQuery({
    queryKey: ["tv", tvId, "season", seasonNumber],
    queryFn: (ctx: Ctx) =>
      tmdbApi.getSeasonEpisodes(tvId, seasonNumber, ctx.signal),
    staleTime: DETAIL_STALE_TIME,
    enabled: !!tvId && !!seasonNumber,
  });
}

// ── Search ──

export function useSearch(query: string, page = 1) {
  return useQuery({
    queryKey: ["search", query, page],
    queryFn: (ctx: Ctx) => tmdbApi.searchMulti(query, page, ctx.signal),
    enabled: query.length >= 2,
    staleTime: 5 * MIN,
  });
}

// ── Person / Cast ──

export function usePersonDetails(id: number) {
  return useQuery({
    queryKey: ["person", id],
    queryFn: (ctx: Ctx) => tmdbApi.getPersonDetails(id, ctx.signal),
    staleTime: 7 * DAY,
    enabled: !!id,
  });
}

export function usePersonCredits(id: number) {
  return useQuery({
    queryKey: ["person", id, "credits"],
    queryFn: (ctx: Ctx) => tmdbApi.getPersonCredits(id, ctx.signal),
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
    queryFn: async (ctx: Ctx) => {
      if (!hasHistory) return [];
      const last = historyEntries[0].latest;
      let details: any;
      if (last.mediaType === "tv") {
        details = await tmdbApi.getTVDetails(Number(last.tmdbId), ctx.signal);
      } else {
        details = await tmdbApi.getMovieDetails(Number(last.tmdbId), ctx.signal);
      }
      const genreIds = details?.genres?.slice(0, 2).map((g: any) => g.id) ?? [];
      if (genreIds.length === 0) return [];
      const result = await tmdbApi.getMovies(
        {
          genreIds,
          sortBy: "popularity.desc",
        },
        ctx.signal,
      );
      return (result.results ?? []).filter(
        (m: any) => m.id !== Number(last.tmdbId),
      );
    },
    staleTime: DAY,
    enabled: hasHistory,
  });
}

// ── Filtered Discover ──

export function useFilteredMovies(
  params: {
    genreIds?: number[];
    sortBy?: string;
    page?: number;
  },
  enabled = true,
) {
  return useQuery({
    queryKey: ["movies", "filtered", params],
    queryFn: (ctx: Ctx) => tmdbApi.getMovies(params, ctx.signal),
    staleTime: 10 * MIN,
    enabled,
  });
}

export function useFilteredTVShows(
  params: {
    genreIds?: number[];
    sortBy?: string;
    page?: number;
  },
  enabled = true,
) {
  return useQuery({
    queryKey: ["tv", "filtered", params],
    queryFn: (ctx: Ctx) => tmdbApi.getTVShows(params, ctx.signal),
    staleTime: 10 * MIN,
    enabled,
  });
}
