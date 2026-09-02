/**
 * /api/anime/home — AniList GraphQL proxy for the home browse feed, 24h edge
 * cached. Mirrors /api/anime/search (same upstream, same TMDB-spine gate, same
 * Kitsu fallback shape) but pulls Trending / Popular / This-Season rails instead
 * of keyword search.
 *
 * Each result is cross-linked to its TMDB twin through the derived map; titles
 * without a twin are dropped (same Q1 rule as search — no parallel detail
 * surface for unmapped anime). The three rails share one cached upstream call.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders, handleOptions } from "@/lib/cors";
import { lookupMal } from "@/lib/anime/resolve";
import { desktopSkip } from "../../desktop-skip";

export const dynamic = "force-static";

const ANILIST_GRAPHQL = "https://graphql.anilist.co";
const KITSU_BASE = "https://kitsu.io/api/edge/anime";

const UPSTREAM_TIMEOUT_MS = 9000;

const cacheHeaders = {
  "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
};

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

function corsResponse(
  data: unknown,
  requestOrigin: string | null,
  init?: ResponseInit,
) {
  const status = init?.status ?? 200;
  const cache = status < 400 ? cacheHeaders : { "Cache-Control": "no-store" };
  return NextResponse.json(data, {
    ...init,
    headers: { ...cache, ...init?.headers, ...getCorsHeaders(requestOrigin) },
  });
}

interface SlimAnimeResult {
  malId: number;
  anilistId: number | null;
  tmdbShowId?: number;
  tmdbMovieId?: number;
  title: string;
  titleEnglish: string | null;
  image: string | null;
  year: number | null;
  episodes: number | null;
  type: string | null;
  score: number | null;
  members: number | null;
}

const FORMAT_LABELS: Record<string, string> = {
  TV: "TV",
  TV_SHORT: "TV",
  MOVIE: "Movie",
  SPECIAL: "Special",
  OVA: "OVA",
  ONA: "ONA",
  MUSIC: "Music",
  TV_SPECIAL: "Special",
};

const HOME_QUERY = `
query AnimeHome($perPage: Int) {
  Trending: Page(page: 1, perPage: $perPage) {
    media(sort: TRENDING_DESC, type: ANIME, isAdult: false) {
      id idMal title { romaji english } coverImage { extraLarge }
      startDate { year } episodes format averageScore popularity
    }
  }
  Popular: Page(page: 1, perPage: $perPage) {
    media(sort: POPULARITY_DESC, type: ANIME, isAdult: false) {
      id idMal title { romaji english } coverImage { extraLarge }
      startDate { year } episodes format averageScore popularity
    }
  }
  Season: Page(page: 1, perPage: $perPage) {
    media(season: ${currentSeasonName()}, seasonYear: ${currentYear()}, sort: POPULARITY_DESC, type: ANIME, isAdult: false) {
      id idMal title { romaji english } coverImage { extraLarge }
      startDate { year } episodes format averageScore popularity
    }
  }
}`;

function currentYear(): number {
  return new Date().getFullYear();
}

function currentSeasonName(): string {
  const m = new Date().getMonth();
  // Northern-hemisphere anime seasons: WINTER (Dec-Feb), SPRING (Mar-May),
  // SUMMER (Jun-Aug), FALL (Sep-Nov).
  if (m <= 1 || m === 11) return "WINTER";
  if (m <= 4) return "SPRING";
  if (m <= 7) return "SUMMER";
  return "FALL";
}

function mapMedia(item: Record<string, any>): SlimAnimeResult | null {
  const malId = Number(item.idMal);
  if (!Number.isFinite(malId)) return null;
  const mapped = lookupMal(malId);
  if (!mapped || (mapped.tmdbShowId == null && mapped.tmdbMovieId == null)) {
    return null;
  }
  return {
    malId,
    anilistId: Number(item.id) || mapped.anilistId || null,
    tmdbShowId: mapped.tmdbShowId,
    tmdbMovieId: mapped.tmdbMovieId,
    title: item.title?.english ?? item.title?.romaji ?? "",
    titleEnglish: item.title?.english ?? null,
    image: item.coverImage?.extraLarge ?? null,
    year: typeof item.startDate?.year === "number" ? item.startDate.year : null,
    episodes: typeof item.episodes === "number" ? item.episodes : null,
    type: FORMAT_LABELS[item.format as string] ?? null,
    score:
      typeof item.averageScore === "number"
        ? Math.round((item.averageScore / 10) * 10) / 10
        : null,
    members: typeof item.popularity === "number" ? item.popularity : null,
  };
}

export async function GET(req: NextRequest) {
  const skip = desktopSkip();
  if (skip) return skip;
  const origin = req.headers.get("origin");
  const limitRaw = Number(req.nextUrl.searchParams.get("limit")) || 20;
  const limit = Math.min(Math.max(Math.trunc(limitRaw), 1), 25);

  const bundle = await fetchFromAnilist(limit);
  if (bundle) {
    return corsResponse({ source: "anilist", ...bundle }, origin);
  }
  return corsResponse(
    { error: "anime home unavailable (upstream down)", source: "none" },
    origin,
    { status: 502 },
  );
}

async function fetchFromAnilist(limit: number): Promise<{
  trending: SlimAnimeResult[];
  popular: SlimAnimeResult[];
  seasonal: SlimAnimeResult[];
} | null> {
  let upstream: Response;
  try {
    upstream = await fetchWithTimeout(ANILIST_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: HOME_QUERY,
        variables: { perPage: limit },
      }),
    });
  } catch {
    return null;
  }
  if (!upstream.ok) return null;

  let payload: {
    data?: Record<string, { media?: Array<Record<string, any>> }>;
  };
  try {
    payload = await upstream.json();
  } catch {
    return null;
  }

  const toList = (key: string) =>
    (payload.data?.[key]?.media ?? [])
      .map(mapMedia)
      .filter((x: SlimAnimeResult | null): x is SlimAnimeResult => x != null);

  const trending = toList("Trending");
  const popular = toList("Popular");
  const seasonal = toList("Season");
  if (trending.length === 0 && popular.length === 0 && seasonal.length === 0) {
    return null;
  }
  return { trending, popular, seasonal };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms = UPSTREAM_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
