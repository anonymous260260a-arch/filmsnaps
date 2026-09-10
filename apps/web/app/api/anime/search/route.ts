/**
 * /api/anime/search — anime keyword search, 24h edge cached.
 *
 * Provider chain (2026-09 rework; see lib/anime/upstreams.ts for rationale):
 *   Kitsu → Shikimori → AniList (opportunistic) → 502.
 * Originally a Jikan proxy, then AniList-primary until AniList 403-blocked
 * Cloudflare Workers egress in Sep 2026. Kitsu and Shikimori are both
 * keyless and independent of each other; both yield a MAL id so the
 * MalId→TMDB-spine gate (verdict Q1) is unchanged regardless of source.
 *
 * One upstream request per call per source; the edge caches results for a day
 * so debounced client queries stay well under provider rate ceilings.
 *
 * Each result is cross-linked to its TMDB twin through the derived map;
 * titles WITHOUT a TMDB twin are dropped (verdict Q1 — hide unmapped titles
 * in v1; they would need an entire parallel detail/watch surface).
 */

import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders, handleOptions } from "@/lib/cors";
import { desktopSkip } from "../../desktop-skip";

// force-static removed — same fix as tmdb route (was caching search at build time)
import { lookupMal } from "@/lib/anime/resolve";
import {
  ANILIST_GRAPHQL,
  FORMAT_LABELS,
  KITSU_BASE,
  SHIKIMORI_BASE,
  SlimBundle,
  fetchWithTimeout,
  parseKitsuToSlim,
  parseShikimoriToSlim,
} from "@/lib/anime/upstreams";

// Both upstreams get a hard timeout so a hung endpoint can't stall the route.
const UPSTREAM_TIMEOUT_MS = 9000;

// Kitsu caps page[limit] at 20 (400 above that); keep the two providers
// independent so a 30-result client request doesn't 400 the fallback.
const KITSU_MAX_LIMIT = 20;

// 24h edge cache. SWR keeps serving stale results while revalidating.
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
  // Only successful lookups earn the 24h edge cache — an upstream outage must
  // not get pinned for a day at the edge.
  const cache = status < 400 ? cacheHeaders : { "Cache-Control": "no-store" };
  return NextResponse.json(data, {
    ...init,
    headers: { ...cache, ...init?.headers, ...getCorsHeaders(requestOrigin) },
  });
}

export async function GET(req: NextRequest) {
  const skip = desktopSkip();
  if (skip) return skip;
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const origin = req.headers.get("origin");

  if (!q) return corsResponse({ error: "missing q" }, origin);

  const limitRaw = Number(sp.get("limit")) || 20;
  const limit = Math.min(Math.max(Math.trunc(limitRaw), 1), 25);

  // Kitsu → Shikimori → AniList. On any failure (throw / non-ok / invalid
  // json / empty) fall through so a single upstream outage never blanks search.
  const kitsuResults = await fetchFromKitsu(q, limit).catch(() => null);
  if (kitsuResults) {
    return corsResponse({ query: q, source: "kitsu", ...kitsuResults }, origin);
  }

  const shikimoriResults = await fetchFromShikimori(q, limit).catch(() => null);
  if (shikimoriResults) {
    return corsResponse(
      { query: q, source: "shikimori", ...shikimoriResults },
      origin,
    );
  }

  const anilistResults = await fetchFromAnilist(q, limit).catch(() => null);
  if (anilistResults) {
    return corsResponse(
      { query: q, source: "anilist", ...anilistResults },
      origin,
    );
  }

  return corsResponse(
    { error: "anime search unavailable (all upstreams down)", source: "none" },
    origin,
    { status: 502 },
  );
}

/** Kitsu primary. Keyless, independent of AniList and MAL. */
async function fetchFromKitsu(
  q: string,
  limit: number,
): Promise<SlimBundle | null> {
  const kitsuLimit = Math.min(limit, KITSU_MAX_LIMIT);
  const url = `${KITSU_BASE}?filter%5Btext%5D=${encodeURIComponent(
    q,
  )}&page%5Blimit%5D=${kitsuLimit}&include=mappings`;
  const upstream = await fetchWithTimeout(url, {
    headers: { Accept: "application/vnd.api+json" },
  });
  if (!upstream.ok) return null;
  const parsed = parseKitsuToSlim(await upstream.json());
  if (!parsed) return null;
  return {
    count: parsed.results.length,
    hiddenUnmapped: parsed.hiddenUnmapped,
    results: parsed.results,
  };
}

/** Shikimori fallback. Keyless; its `id` IS the MAL id. */
async function fetchFromShikimori(
  q: string,
  limit: number,
): Promise<SlimBundle | null> {
  const url = `${SHIKIMORI_BASE}/animes?limit=${limit}&search=${encodeURIComponent(q)}`;
  const upstream = await fetchWithTimeout(url, {
    headers: { "User-Agent": "Filmsnaps/2.2 (anime search)" },
  });
  if (!upstream.ok) return null;
  const parsed = parseShikimoriToSlim(await upstream.json());
  if (!parsed) return null;
  return {
    count: parsed.results.length,
    hiddenUnmapped: parsed.hiddenUnmapped,
    results: parsed.results,
  };
}

const SEARCH_QUERY = `
query AnimeSearch($search: String, $perPage: Int) {
  Page(page: 1, perPage: $perPage) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH, isAdult: false) {
      id
      idMal
      title { romaji english }
      coverImage { extraLarge }
      startDate { year }
      episodes
      format
      averageScore
      popularity
    }
  }
}`;

/**
 * AniList opportunistic link — 403s from Cloudflare Workers egress since
 * 2026-09, kept for when requests arrive from other IPs.
 */
async function fetchFromAnilist(
  q: string,
  limit: number,
): Promise<SlimBundle | null> {
  const upstream = await fetchWithTimeout(
    ANILIST_GRAPHQL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: SEARCH_QUERY,
        variables: { search: q, perPage: limit },
      }),
    },
    UPSTREAM_TIMEOUT_MS,
  );
  if (!upstream.ok) return null;

  const payload: {
    data?: { Page?: { media?: Array<Record<string, any>> } };
  } = await upstream.json();

  let hiddenUnmapped = 0;
  const results = [];

  for (const item of payload.data?.Page?.media ?? []) {
    const malId = Number(item.idMal);
    if (!Number.isFinite(malId)) {
      hiddenUnmapped++;
      continue;
    }

    const mapped = lookupMal(malId);
    if (!mapped || (mapped.tmdbShowId == null && mapped.tmdbMovieId == null)) {
      hiddenUnmapped++;
      continue;
    }

    results.push({
      malId,
      anilistId: Number(item.id) || mapped.anilistId || null,
      tmdbShowId: mapped.tmdbShowId,
      tmdbMovieId: mapped.tmdbMovieId,
      title: item.title?.english ?? item.title?.romaji ?? "",
      titleEnglish: item.title?.english ?? null,
      image: item.coverImage?.extraLarge ?? null,
      year:
        typeof item.startDate?.year === "number" ? item.startDate.year : null,
      episodes: typeof item.episodes === "number" ? item.episodes : null,
      type: FORMAT_LABELS[item.format as string] ?? null,
      score:
        typeof item.averageScore === "number"
          ? Math.round((item.averageScore / 10) * 10) / 10
          : null,
      members: typeof item.popularity === "number" ? item.popularity : null,
    });
  }

  return results.length > 0
    ? { count: results.length, hiddenUnmapped, results }
    : null;
}
