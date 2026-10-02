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

// ── More Like This ──
//
// Phase: quality rewrite. The old implementation took the LAST watched
// title's top-2 genres and ran a popularity-sorted genre discover — that
// returns "popular movies sharing a genre" (a horror fan got romcoms), the
// #1 source of "bad results". The fix uses TMDB's OWN relevance engine:
// the /recommendations endpoint for EACH of the last few watched titles,
// aggregated with recency weighting, deduped, and quality-gated.

const MLT_SEEDS = 3; // recommendation seeds: the 3 most recent watched titles
// Quality gate is deliberately LIGHT (5.5 / 15 votes): TMDB's recommendation
// engine already curates for relevance — the heavy 6.0/25 gate pruned real
// recommendations and made the row emptier (and worse) than the TMDB site.
// This only removes the true bottom-feeder junk.
const MLT_QUALITY_FLOOR = 5.5;
const MLT_MIN_VOTES = 15;

/** Recency weight: newest seed ×1.0, then ×0.7, ×0.49 … */
function recencyWeight(index: number): number {
  return Math.pow(0.7, index);
}

/**
 * Build a deduped, recency-weighted, quality-gated "More Like This" pool.
 * Exported for testing. Raw candidate shape: { item, weight }.
 */
export function aggregateRecommendations(
  seedLists: Array<{
    seedId: number | string;
    seedIndex: number;
    results: any[];
  }>,
): any[] {
  const scores = new Map<
    number,
    { item: any; score: number; seedIndex: number }
  >();
  // Every watched seed is excluded from its own recommendations AND every
  // other seed's (built up front — a candidate matching a later seed must
  // still be dropped when encountered in an earlier list).
  const exclude = new Set<number>(
    seedLists.map((l) => Number(l.seedId)).filter((n) => Number.isFinite(n)),
  );

  for (const list of seedLists) {
    list.results.forEach((r, position) => {
      const id = Number(r.id);
      if (!Number.isFinite(id) || exclude.has(id)) return;
      // TMDB's OWN ordering is the primary signal (what their website
      // renders): earlier position = more relevant. Recency scales it; a
      // capped agreement bonus compounds when multiple seeds push the same
      // title. NO raw popularity term — it was overriding TMDB's curation
      // and dragging the row back toward generic-popular filler.
      const w = recencyWeight(list.seedIndex);
      const positionScore = Math.max(0, 20 - position) / 20;
      const score = positionScore * w;
      const existing = scores.get(id);
      if (existing) {
        // Agreement: +60% of the strongest contributing score per extra seed.
        existing.score += score + existing.score * 0.6;
        if (list.seedIndex < existing.seedIndex) {
          existing.seedIndex = list.seedIndex;
          existing.item = r;
        }
      } else {
        scores.set(id, { item: r, score, seedIndex: list.seedIndex });
      }
    });
  }

  return [...scores.values()]
    .filter(
      (e) =>
        (e.item.vote_average ?? 0) >= MLT_QUALITY_FLOOR &&
        (e.item.vote_count ?? 0) >= MLT_MIN_VOTES,
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((e) => ({
      ...e.item,
      _mediaType: e.item.media_type ?? (e.item.first_air_date ? "tv" : "movie"),
      _mltScore: e.score,
    }));
}

export function useMoreLikeThis(
  historyEntries: Array<{
    latest: { tmdbId: string | number; mediaType: string };
  }>,
) {
  const seeds = historyEntries.slice(0, MLT_SEEDS);
  const hasHistory = seeds.length > 0;
  // Explicit element type: the queryFn's inferred union (multiple return
  // paths + catch) reads as possibly-undefined at call sites.
  return useQuery<any[]>({
    queryKey: [
      "more-like-this",
      seeds.map((s) => `${s.latest.mediaType}:${s.latest.tmdbId}`).join("|"),
    ],
    queryFn: async (ctx: Ctx) => {
      if (!hasHistory) return [];

      // Recs for each seed, in parallel; each failure is contained (one dead
      // seed must not kill the row).
      const lists = await Promise.all(
        seeds.map(async (seed, index) => {
          const id = Number(seed.latest.tmdbId);
          try {
            const recs =
              seed.latest.mediaType === "tv"
                ? await tmdbApi.getTVRecommendations(id, 1, ctx.signal)
                : await tmdbApi.getMovieRecommendations(id, 1, ctx.signal);
            return {
              seedId: id,
              seedIndex: index,
              results: recs?.results ?? [],
            };
          } catch {
            return { seedId: id, seedIndex: index, results: [] };
          }
        }),
      );

      const aggregated = aggregateRecommendations(lists);
      if (aggregated.length >= 8) return aggregated;

      // Fallback: the old genre-discover path (quality-gated now too) — only
      // used when recommendations come up short (thin history / obscure seed).
      const last = seeds[0].latest;
      try {
        const details =
          last.mediaType === "tv"
            ? await tmdbApi.getTVDetails(Number(last.tmdbId), ctx.signal)
            : await tmdbApi.getMovieDetails(Number(last.tmdbId), ctx.signal);
        const genreIds =
          details?.genres?.slice(0, 2).map((g: any) => g.id) ?? [];
        if (genreIds.length === 0) return aggregated;
        const result =
          last.mediaType === "tv"
            ? await tmdbApi.getTVShowsAdvanced({
                genreIds,
                sortBy: "popularity.desc",
                minRating: 6,
                minVotes: 60,
              })
            : await tmdbApi.getMoviesAdvanced({
                genreIds,
                sortBy: "popularity.desc",
                minRating: 6,
                minVotes: 60,
              });
        const existingIds = new Set([
          ...aggregated.map((m: any) => Number(m.id)),
          ...seeds.map((s) => Number(s.latest.tmdbId)),
        ]);
        const filler = (result.results ?? [])
          .filter((m: any) => !existingIds.has(Number(m.id)))
          .map((m: any) => ({
            ...m,
            _mediaType: last.mediaType === "tv" ? "tv" : "movie",
          }));
        return [...aggregated, ...filler].slice(0, 20);
      } catch {
        return aggregated;
      }
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
