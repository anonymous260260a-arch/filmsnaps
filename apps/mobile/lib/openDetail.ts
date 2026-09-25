/**
 * openDetail — single entry path for movie/TV detail navigation (Phase 2 FIX 1).
 *
 * prepareDetail (onPressIn): 1–4 — source mark, query prefetch, image prefetch,
 * router.prefetch. openDetail / pushDetail (onPress): 5 — navigate with
 * header params so the detail screen can paint before the query resolves.
 */
import { Image } from "expo-image";
import { useRouter, type Href } from "expo-router";
import { getImageUrl } from "@filmsnaps/shared";
import { tmdbApi } from "./api";
import { DETAIL_STALE_TIME } from "./detailQuery";
import { DETAIL_BACKDROP_SIZE } from "../components/heroLayout";
import { markDetailNav, type DetailSource } from "./detailMetrics";
import { useSafeNavigation } from "@/lib/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

export interface DetailNavItem {
  id: string | number;
  mediaType?: "movie" | "tv" | string | null;
  title?: string | null;
  name?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number | null;
  release_date?: string | null;
  first_air_date?: string | null;
  blurhash?: string | null;
}

function resolveMediaType(item: DetailNavItem): "movie" | "tv" {
  const t = item.mediaType;
  if (t === "tv" || t === "movie") return t;
  if (item.first_air_date || item.name) return "tv";
  return "movie";
}

function detailPath(item: DetailNavItem): string {
  const type = resolveMediaType(item);
  return `/${type}/${item.id}`;
}

function detailParams(item: DetailNavItem): Record<string, string> {
  const title = item.title || item.name || "";
  const params: Record<string, string> = {
    title: String(title ?? ""),
  };
  if (item.poster_path) params.poster_path = String(item.poster_path);
  if (item.backdrop_path) params.backdrop_path = String(item.backdrop_path);
  if (item.vote_average != null && item.vote_average !== undefined) {
    params.vote_average = String(item.vote_average);
  }
  const date = item.release_date || item.first_air_date;
  if (date) params.release_date = String(date);
  if (item.blurhash) params.blurhash = String(item.blurhash);
  return params;
}

/**
 * Steps 1–4 — call on touch-down (onPressIn).
 * Safe to call when the touch becomes a scroll; results are cached.
 */
export function prepareDetail(
  item: DetailNavItem,
  source: DetailSource,
  queryClient: ReturnType<typeof useQueryClient>,
  router: ReturnType<typeof useRouter>,
): void {
  const type = resolveMediaType(item);
  const id = item.id;
  if (id == null) return;

  // 1. Source for [detail] … source=…
  markDetailNav(source);

  // 2. Query prefetch — same key/staleTime as useMovieDetails / useTVDetails.
  void queryClient.prefetchQuery({
    queryKey: [type, id],
    queryFn: () =>
      type === "tv"
        ? tmdbApi.getTVDetails(Number(id))
        : tmdbApi.getMovieDetails(Number(id)),
    staleTime: DETAIL_STALE_TIME,
  });

  // 3. Image prefetch — header art used by params-first paint.
  const urls: string[] = [];
  if (item.backdrop_path) {
    urls.push(getImageUrl(item.backdrop_path, DETAIL_BACKDROP_SIZE));
  }
  if (item.poster_path) {
    urls.push(getImageUrl(item.poster_path, "w342"));
  }
  if (urls.length) {
    Image.prefetch(urls).catch(() => {});
  }

  // 4. Route module preload.
  try {
    void router.prefetch(detailPath(item) as Href);
  } catch {
    // prefetch is best-effort
  }
}

/**
 * Step 5 — navigate with header params (onPress).
 * Prefer calling prepareDetail first; this also marks source if skipped.
 */
export function pushDetail(
  item: DetailNavItem,
  source: DetailSource,
  nav: ReturnType<typeof useSafeNavigation>,
): void {
  if (item.id == null) return;
  markDetailNav(source);
  const path = detailPath(item);
  const params = detailParams(item);
  nav.push({ pathname: path as Href, params } as Href);
}

/** prepare + push in one call (for entry points without onPressIn). */
export function openDetail(
  item: DetailNavItem,
  source: DetailSource,
  deps: {
    queryClient: ReturnType<typeof useQueryClient>;
    router: ReturnType<typeof useRouter>;
    nav: ReturnType<typeof useSafeNavigation>;
  },
): void {
  prepareDetail(item, source, deps.queryClient, deps.router);
  pushDetail(item, source, deps.nav);
}

/**
 * Hook form for screens that need stable callbacks.
 * Returns { prepare, open, pressIn, press } wired to the item.
 */
export function useOpenDetail(
  getItem: () => DetailNavItem | null | undefined,
  source: DetailSource,
) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const nav = useSafeNavigation();

  const prepare = useCallback(() => {
    const item = getItem();
    if (item) prepareDetail(item, source, queryClient, router);
  }, [getItem, source, queryClient, router]);

  const open = useCallback(() => {
    const item = getItem();
    if (item) pushDetail(item, source, nav);
  }, [getItem, source, nav]);

  return { prepare, open, pressIn: prepare, press: open };
}

/** Build a stable DetailNavItem from any card/list row shape. */
export function toDetailNavItem(
  raw: any,
  fallbackType?: "movie" | "tv",
): DetailNavItem | null {
  if (!raw) return null;
  const id = raw.id ?? raw.tmdbId ?? raw.tmdb_id;
  if (id == null) return null;
  return {
    id,
    mediaType: fallbackType || raw.media_type || raw.mediaType || null,
    title: raw.title ?? null,
    name: raw.name ?? null,
    poster_path: raw.poster_path ?? raw.posterPath ?? null,
    backdrop_path: raw.backdrop_path ?? raw.backdropPath ?? null,
    vote_average: raw.vote_average ?? null,
    release_date: raw.release_date ?? null,
    first_air_date: raw.first_air_date ?? null,
    blurhash: raw.blurhash ?? null,
  };
}
