/**
 * /api/anime/home — anime browse feed for the home rails, 24h edge cached.
 *
 * Provider chain (2026-09 rework; see lib/anime/upstreams.ts for rationale):
 *   Kitsu → Shikimori → AniList (opportunistic) → TMDB discover → 502.
 * AniList 403-blocked Cloudflare Workers egress IPs in Sep 2026, so it can no
 * longer be the primary from this Worker; TMDB is the terminal link because
 * every result must map to a TMDB twin anyway (Q1 gate) — the feed can only
 * blank if TMDB itself is down.
 *
 * Each result is cross-linked to its TMDB twin through the derived map;
 * titles without a twin are dropped. The three rails share one cached
 * response per source.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders, handleOptions } from "@/lib/cors";
import { desktopSkip } from "../../desktop-skip";
import { lookupMal, lookupTmdbShow } from "@/lib/anime/resolve";
import {
  ANILIST_GRAPHQL,
  FORMAT_LABELS,
  KITSU_BASE,
  SHIKIMORI_BASE,
  SlimAnimeResult,
  currentSeasonName,
  fetchWithTimeout,
  parseKitsuToSlim,
  parseShikimoriToSlim,
} from "@/lib/anime/upstreams";

const UPSTREAM_TIMEOUT_MS = 9000;

// Kitsu caps page[limit] at 20.
const KITSU_MAX_LIMIT = 20;

const cacheHeaders = {
  "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
};

interface HomeBundle {
  trending: SlimAnimeResult[];
  popular: SlimAnimeResult[];
  seasonal: SlimAnimeResult[];
}

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

function bundleHasContent(bundle: HomeBundle): boolean {
  return (
    bundle.trending.length > 0 ||
    bundle.popular.length > 0 ||
    bundle.seasonal.length > 0
  );
}

export async function GET(req: NextRequest) {
  const skip = desktopSkip();
  if (skip) return skip;
  const origin = req.headers.get("origin");
  const limitRaw = Number(req.nextUrl.searchParams.get("limit")) || 20;
  const limit = Math.min(Math.max(Math.trunc(limitRaw), 1), 25);

  const chain: Array<[string, () => Promise<HomeBundle | null>]> = [
    ["kitsu", () => fetchFromKitsuHome(limit)],
    ["shikimori", () => fetchFromShikimoriHome(limit)],
    ["anilist", () => fetchFromAnilist(limit)],
    ["tmdb", () => fetchFromTmdbHome(limit)],
  ];

  for (const [source, fetcher] of chain) {
    try {
      const bundle = await fetcher();
      if (bundle && bundleHasContent(bundle)) {
        console.log(`[AnimeHome] serving from ${source}`);
        return corsResponse({ source, ...bundle }, origin);
      }
      console.warn(`[AnimeHome] ${source} returned empty — trying next`);
    } catch (e: any) {
      console.warn(`[AnimeHome] ${source} failed:`, e?.message ?? e);
    }
  }

  console.warn("[AnimeHome] all upstreams failed — 502");
  return corsResponse(
    { error: "anime home unavailable (all upstreams down)", source: "none" },
    origin,
    { status: 502 },
  );
}

// ── Link 1: Kitsu ──────────────────────────────────────────────────────

async function fetchKitsuRail(params: string): Promise<SlimAnimeResult[]> {
  const url = `${KITSU_BASE}?page%5Blimit%5D=${KITSU_MAX_LIMIT}&include=mappings&${params}`;
  const res = await fetchWithTimeout(url, {
    headers: { Accept: "application/vnd.api+json" },
  });
  if (!res.ok) throw new Error(`kitsu rail ${res.status}`);
  const parsed = parseKitsuToSlim(await res.json());
  return parsed?.results ?? [];
}

async function fetchFromKitsuHome(limit: number): Promise<HomeBundle | null> {
  const season = currentSeasonName().toLowerCase();
  const year = new Date().getFullYear();
  // Three independent rails; best-effort per rail (allSettled).
  const [trending, popular, seasonal] = await Promise.allSettled([
    fetchKitsuRail("sort=-userCount&filter%5Bstatus%5D=current"),
    fetchKitsuRail("sort=-userCount"),
    fetchKitsuRail(
      `sort=-userCount&filter%5Bseason%5D=${season}&filter%5Bseason_year%5D=${year}`,
    ),
  ]);
  const pick = (r: PromiseSettledResult<SlimAnimeResult[]>) =>
    r.status === "fulfilled" ? r.value.slice(0, limit) : [];
  return {
    trending: pick(trending),
    popular: pick(popular),
    seasonal: pick(seasonal),
  };
}

// ── Link 2: Shikimori ──────────────────────────────────────────────────

async function fetchShikimoriRail(params: string): Promise<SlimAnimeResult[]> {
  const res = await fetchWithTimeout(`${SHIKIMORI_BASE}/animes?${params}`, {
    headers: { "User-Agent": "Filmsnaps/2.2 (anime feed)" },
  });
  if (!res.ok) throw new Error(`shikimori rail ${res.status}`);
  const parsed = parseShikimoriToSlim(await res.json());
  return parsed?.results ?? [];
}

async function fetchFromShikimoriHome(
  limit: number,
): Promise<HomeBundle | null> {
  const season = currentSeasonName().toLowerCase();
  const year = new Date().getFullYear();
  const [trending, popular, seasonal] = await Promise.allSettled([
    fetchShikimoriRail(`limit=25&status=ongoing&order=popularity`),
    fetchShikimoriRail(`limit=25&order=popularity`),
    fetchShikimoriRail(`limit=25&season=${season}_${year}&order=popularity`),
  ]);
  const pick = (r: PromiseSettledResult<SlimAnimeResult[]>) =>
    r.status === "fulfilled" ? r.value.slice(0, limit) : [];
  return {
    trending: pick(trending),
    popular: pick(popular),
    seasonal: pick(seasonal),
  };
}

// ── Link 3: AniList (opportunistic — 403s from Workers egress since 2026-09)

const HOME_QUERY = `
query AnimeHome($perPage: Int, $season: MediaSeason, $seasonYear: Int) {
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
    media(season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC, type: ANIME, isAdult: false) {
      id idMal title { romaji english } coverImage { extraLarge }
      startDate { year } episodes format averageScore popularity
    }
  }
}`;

function mapAnilistMedia(item: Record<string, any>): SlimAnimeResult | null {
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

async function fetchFromAnilist(limit: number): Promise<HomeBundle | null> {
  const upstream = await fetchWithTimeout(
    ANILIST_GRAPHQL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: HOME_QUERY,
        variables: {
          perPage: limit,
          season: currentSeasonName(),
          seasonYear: new Date().getFullYear(),
        },
      }),
    },
    UPSTREAM_TIMEOUT_MS,
  );
  if (!upstream.ok) throw new Error(`anilist ${upstream.status}`);
  const payload = await upstream.json();
  const toList = (key: string) =>
    (payload.data?.[key]?.media ?? [])
      .map(mapAnilistMedia)
      .filter((x: SlimAnimeResult | null): x is SlimAnimeResult => x != null);
  return {
    trending: toList("Trending"),
    popular: toList("Popular"),
    seasonal: toList("Season"),
  };
}

// ── Link 4: TMDB discover (terminal — same infra as the TMDB spine) ─────

function mapTmdbShow(item: Record<string, any>):
  | (SlimAnimeResult & {
      _rank: number;
    })
  | null {
  const tmdbShowId = Number(item.id);
  if (!Number.isFinite(tmdbShowId)) return null;
  const hit = lookupTmdbShow(tmdbShowId);
  if (!hit) return null; // map gate: unmapped TMDB anime has no MAL key
  const score = typeof item.vote_average === "number" ? item.vote_average : 0;
  return {
    malId: hit.malId,
    anilistId: hit.anilistId,
    tmdbShowId,
    title: item.name ?? "",
    titleEnglish: item.name ?? null,
    image:
      typeof item.poster_path === "string"
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
        : null,
    year:
      typeof item.first_air_date === "string"
        ? Number(item.first_air_date.slice(0, 4)) || null
        : null,
    episodes: null,
    type: "TV",
    score: score > 0 ? score : null,
    members: null,
    _rank: score,
  };
}

async function fetchTmdbRail(
  path: string,
  apiKey: string,
  limit: number,
): Promise<SlimAnimeResult[]> {
  const url = `https://api.themoviedb.org/3${path}${path.includes("?") ? "&" : "?"}api_key=${apiKey}&page=1`;
  const res = await fetchWithTimeout(url, {});
  if (!res.ok) throw new Error(`tmdb rail ${res.status}`);
  const payload = await res.json();
  const items: Array<Record<string, any>> = path.startsWith("/trending")
    ? (payload.results ?? []).filter((r: Record<string, any>) =>
        Array.isArray(r.genre_ids) ? r.genre_ids.includes(16) : false,
      )
    : (payload.results ?? []);
  return items
    .map(mapTmdbShow)
    .filter((x): x is SlimAnimeResult & { _rank: number } => x != null)
    .sort((a, b) => b._rank - a._rank)
    .map(({ _rank, ...slim }) => slim)
    .slice(0, limit);
}

async function fetchFromTmdbHome(limit: number): Promise<HomeBundle | null> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error("TMDB_API_KEY not configured");
  const year = new Date().getFullYear();
  const [trending, popular, seasonal] = await Promise.allSettled([
    fetchTmdbRail("/trending/tv/week", apiKey, limit * 2),
    fetchTmdbRail(
      "/discover/tv?with_genres=16&sort_by=popularity.desc&vote_count.gte=10",
      apiKey,
      limit,
    ),
    fetchTmdbRail(
      `/discover/tv?with_genres=16&sort_by=popularity.desc&first_air_date_year=${year}`,
      apiKey,
      limit,
    ),
  ]);
  const pick = (r: PromiseSettledResult<SlimAnimeResult[]>) =>
    r.status === "fulfilled" ? r.value.slice(0, limit) : [];
  return {
    trending: pick(trending),
    popular: pick(popular),
    seasonal: pick(seasonal),
  };
}
