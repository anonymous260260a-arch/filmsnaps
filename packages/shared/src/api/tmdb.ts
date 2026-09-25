import { IMAGE_BASE_URL } from "../constants/tmdb";

/** Typed HTTP error carrying the response status (for smart retry). */
export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;

  constructor(status: number, statusText: string, url?: string) {
    super(
      `TMDB API error: ${status} ${statusText}${url ? ` (${url})` : ""}`,
    );
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
  }
}

export interface FetchJsonOptions {
  /** Caller-owned cancellation (e.g. React Query's AbortSignal). */
  signal?: AbortSignal | null;
  /** Hard timeout; aborts the request. Default 10000ms. */
  timeoutMs?: number;
}

/**
 * fetch + JSON with a merged abort signal (caller signal ∪ manual timeout)
 * and a typed ApiError on non-2xx.
 *
 * Defaults to `any` so existing call sites keep their previous structural
 * typing; pass an explicit type parameter when you need a narrow result.
 */
export async function fetchJson<T = any>(
  url: string,
  options: FetchJsonOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  const external = options.signal;
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternalAbort);
  }

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new ApiError(res.status, res.statusText, url);
    }
    // Read as text first so we can log exact payload size for detail calls.
    const text = await res.text();
    if (
      typeof text === "string" &&
      /\/api\/tmdb\/(movie|tv)\/\d+\?/.test(url)
    ) {
      let bytes = text.length;
      try {
        if (typeof TextEncoder !== "undefined") {
          bytes = new TextEncoder().encode(text).length;
        }
      } catch {
        // Hermes without reliable TextEncoder → character length fallback.
      }
      // Side-channel for mobile detailMetrics (no-op if no session open).
      const mod = globalThis as unknown as {
        __markDetailPayloadBytes?: (n: number) => void;
      };
      if (mod.__markDetailPayloadBytes) {
        mod.__markDetailPayloadBytes(bytes);
      } else {
        // Fallback so the line is never silently dropped (FIX 6).
        console.log(`[detail] payload bytes=${bytes}`);
      }
    }
    return JSON.parse(text) as T;
  } catch (err) {
    // Surface timeout/cancel as-is so React Query can classify retries.
    throw err;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", onExternalAbort);
  }
}

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
  const fetchTmdb = (
    path: string,
    signal?: AbortSignal | null,
    timeoutMs?: number,
  ) => fetchJson(`${apiBase}/api/tmdb${path}`, { signal, timeoutMs });

  return {
    getTrendingMovies: (page = 1, signal?: AbortSignal | null) =>
      fetchTmdb(
        `/trending/movie/week${page > 1 ? `?page=${page}` : ""}`,
        signal,
      ),

    getTrendingTV: (page = 1, signal?: AbortSignal | null) =>
      fetchTmdb(
        `/trending/tv/week${page > 1 ? `?page=${page}` : ""}`,
        signal,
      ),

    getPopularMovies: (page = 1, signal?: AbortSignal | null) =>
      fetchTmdb(`/movie/popular?page=${page}`, signal),

    getUpcomingMovies: (signal?: AbortSignal | null) =>
      fetchTmdb("/movie/upcoming", signal),

    getMovieDetails: (id: number | string, signal?: AbortSignal | null) =>
      fetchTmdb(
        `/movie/${id}?append_to_response=videos,credits,similar&trim=1`,
        signal,
        // Detail payloads are large — allow a bit more than the default 10s.
        15_000,
      ),

    getTVDetails: (id: number | string, signal?: AbortSignal | null) =>
      fetchTmdb(
        `/tv/${id}?append_to_response=videos,credits,similar&trim=1`,
        signal,
        15_000,
      ),

    getTVSeasonsOnly: (id: number | string, signal?: AbortSignal | null) =>
      fetchTmdb(`/tv/${id}`, signal),

    getSeasonEpisodes: (
      tvId: number | string,
      seasonNumber: number,
      signal?: AbortSignal | null,
    ) => fetchTmdb(`/tv/${tvId}/season/${seasonNumber}`, signal),

    searchMulti: (
      query: string,
      page = 1,
      signal?: AbortSignal | null,
    ) =>
      fetchTmdb(
        `/search/multi?query=${encodeURIComponent(query)}&page=${page}`,
        signal,
      ),

    getMovies: (
      params: {
        genreIds?: number[];
        sortBy?: string;
        yearStart?: number;
        yearEnd?: number;
        minRating?: number;
        maxRating?: number;
        language?: string;
        page?: number;
      },
      signal?: AbortSignal | null,
    ) => {
      const q = new URLSearchParams();
      q.set("page", String(params.page ?? 1));
      q.set("sort_by", params.sortBy ?? "popularity.desc");
      if (params.genreIds?.length)
        q.set("with_genres", params.genreIds.join(","));
      if (params.yearStart && params.yearEnd) {
        q.set("primary_release_date.gte", `${params.yearStart}-01-01`);
        q.set("primary_release_date.lte", `${params.yearEnd}-12-31`);
      }
      if (params.minRating !== undefined)
        q.set("vote_average.gte", String(params.minRating));
      if (params.maxRating !== undefined)
        q.set("vote_average.lte", String(params.maxRating));
      if (params.language) q.set("with_original_language", params.language);

      return fetchTmdb(`/discover/movie?${q}`, signal);
    },

    getExternalIds: (
      id: number | string,
      mediaType: "movie" | "tv",
      signal?: AbortSignal | null,
    ) => fetchTmdb(`/${mediaType}/${id}/external_ids`, signal),

    getPersonDetails: (id: number, signal?: AbortSignal | null) =>
      fetchTmdb(`/person/${id}`, signal),

    getPersonCredits: (id: number, signal?: AbortSignal | null) =>
      fetchTmdb(`/person/${id}/combined_credits`, signal),

    getTVShows: (
      params: {
        genreIds?: number[];
        sortBy?: string;
        yearStart?: number;
        yearEnd?: number;
        minRating?: number;
        maxRating?: number;
        language?: string;
        page?: number;
      },
      signal?: AbortSignal | null,
    ) => {
      const q = new URLSearchParams();
      q.set("page", String(params.page ?? 1));
      q.set("sort_by", params.sortBy ?? "popularity.desc");
      if (params.genreIds?.length)
        q.set("with_genres", params.genreIds.join(","));
      if (params.yearStart && params.yearEnd) {
        q.set("first_air_date.gte", `${params.yearStart}-01-01`);
        q.set("first_air_date.lte", `${params.yearEnd}-12-31`);
      }
      if (params.minRating !== undefined)
        q.set("vote_average.gte", String(params.minRating));
      if (params.maxRating !== undefined)
        q.set("vote_average.lte", String(params.maxRating));
      if (params.language) q.set("with_original_language", params.language);

      return fetchTmdb(`/discover/tv?${q}`, signal);
    },
  };
}

/** Re-export the image URL builder for convenience */
export { IMAGE_BASE_URL };
export { getImageUrl } from "../utils/image";
export { getTrailerKey } from "../utils/video";
