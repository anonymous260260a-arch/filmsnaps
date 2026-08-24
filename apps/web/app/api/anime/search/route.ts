/**
 * /api/anime/search — AniList GraphQL proxy with 24h edge cache + Kitsu fallback.
 *
 * Originally a Jikan (MyAnimeList) proxy per verdict §9 Q3/F4; swapped to
 * AniList after Jikan's MyAnimeList upstream proved chronically unavailable
 * (2026-08-23 outage: only Redis-cached URLs answered). AniList is keyless,
 * returns BOTH ids natively (`id` + `idMal`), so the downstream contract —
 * lookupMal() twin-mapping gate keyed by malId — is unchanged.
 *
 * 2026-08-23: AniList began returning 403 "temporarily disabled due to severe
 * stability issues" — a hard upstream outage. Kitsu is the fallback: it is
 * independent of AniList AND MyAnimeList, and its `include=mappings` yields a
 * `myanimelist/anime` external id, so the same MalId→TMDB-spine gate holds.
 * Kitsu is the secondary, not the default: AniList still wins when reachable
 * because it returns both ids and ranks better.
 *
 * One upstream request per call per source; the edge caches results for a day
 * so debounced client queries stay well under AniList's ~90 req/min ceiling.
 *
 * Each result is cross-linked to its TMDB twin through the derived map;
 * titles WITHOUT a TMDB twin are dropped (verdict Q1 — hide unmapped titles
 * in v1; they would need an entire parallel detail/watch surface).
 */

import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders, handleOptions } from "@/lib/cors";
import { lookupMal } from "@/lib/anime/resolve";

const ANILIST_GRAPHQL = "https://graphql.anilist.co";
const KITSU_BASE = "https://kitsu.io/api/edge/anime";

// Both upstreams get a hard timeout so a hung endpoint (AniList hung ~7.5s
// during the 2026-08-23 outage) can't stall the route.
const UPSTREAM_TIMEOUT_MS = 9000;

// 24h edge cache. SWR keeps serving stale results while revalidating so
// bursts never hit AniList.
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
  /** TV | Movie | OVA | ONA | Special */
  type: string | null;
  score: number | null;
  members: number | null;
}

/** AniList format → the card badge vocabulary the UI expects. */
const FORMAT_LABELS: Record<string, string> = {
  // AniList formats
  TV: "TV",
  TV_SHORT: "TV",
  MOVIE: "Movie",
  SPECIAL: "Special",
  OVA: "OVA",
  ONA: "ONA",
  MUSIC: "Music",
  // Kitsu subtypes (uppercased before lookup)
  TV_SPECIAL: "Special",
};

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

// Kitsu caps page[limit] at 20 (400 above that); AniList's perPage is fine up
// to the route's 25. Keep the two independent so a 30-result client request
// doesn't 400 the fallback.
const KITSU_MAX_LIMIT = 20;

/** fetch with a hard timeout — rejects on timeout so callers can fall back. */
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

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const origin = req.headers.get("origin");

  if (!q) return corsResponse({ error: "missing q" }, origin);

  const limitRaw = Number(sp.get("limit")) || 20;
  const limit = Math.min(Math.max(Math.trunc(limitRaw), 1), 25);

  // Primary: AniList. On any failure (throw / non-ok / invalid json / empty),
  // fall back to Kitsu so a single upstream outage never blanks search.
  const anilistResults = await fetchFromAnilist(q, limit);
  if (anilistResults) {
    return corsResponse(
      { query: q, source: "anilist", ...anilistResults },
      origin,
    );
  }

  const kitsuResults = await fetchFromKitsu(q, limit);
  if (kitsuResults) {
    return corsResponse({ query: q, source: "kitsu", ...kitsuResults }, origin);
  }

  return corsResponse(
    { error: "anime search unavailable (all upstreams down)", source: "none" },
    origin,
    { status: 502 },
  );
}

type SlimBundle = {
  count: number;
  hiddenUnmapped: number;
  results: SlimAnimeResult[];
};

async function fetchFromAnilist(
  q: string,
  limit: number,
): Promise<SlimBundle | null> {
  let upstream: Response;
  try {
    upstream = await fetchWithTimeout(ANILIST_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: SEARCH_QUERY,
        variables: { search: q, perPage: limit },
      }),
    });
  } catch {
    return null;
  }

  if (!upstream.ok) return null;

  let payload: {
    data?: { Page?: { media?: Array<Record<string, any>> } };
    errors?: Array<{ message: string }>;
  };
  try {
    payload = await upstream.json();
  } catch {
    return null;
  }

  let hiddenUnmapped = 0;
  const results: SlimAnimeResult[] = [];

  for (const item of payload.data?.Page?.media ?? []) {
    const malId = Number(item.idMal);
    if (!Number.isFinite(malId)) {
      // No MAL id → MegaPlay can't be keyed → same bucket as unmapped.
      hiddenUnmapped++;
      continue;
    }

    // TMDB-spine gate: no twin → hidden from v1 results.
    const mapped = lookupMal(malId);
    if (!mapped || (mapped.tmdbShowId == null && mapped.tmdbMovieId == null)) {
      hiddenUnmapped++;
      continue;
    }

    results.push({
      malId,
      // Upstream IS AniList — its own id is authoritative over the map's.
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

  // Empty list (e.g. query returned nothing) — let Kitsu take a shot.
  return results.length > 0
    ? { count: results.length, hiddenUnmapped, results }
    : null;
}

/** Kitsu fallback. Independent of AniList + MAL; yields a MAL id via mappings. */
async function fetchFromKitsu(
  q: string,
  limit: number,
): Promise<SlimBundle | null> {
  let upstream: Response;
  try {
    const kitsuLimit = Math.min(limit, KITSU_MAX_LIMIT);
    const url = `${KITSU_BASE}?filter%5Btext%5D=${encodeURIComponent(
      q,
    )}&page%5Blimit%5D=${kitsuLimit}&include=mappings`;
    upstream = await fetchWithTimeout(url, {
      headers: { Accept: "application/vnd.api+json" },
    });
  } catch {
    return null;
  }

  if (!upstream.ok) return null;

  let payload: {
    data?: Array<Record<string, any>>;
    included?: Array<Record<string, any>>;
  };
  try {
    payload = await upstream.json();
  } catch {
    return null;
  }

  const media = payload.data ?? [];
  if (media.length === 0) return null;

  // Build kitsu-mapping-id → MAL external id index from the included block.
  const malByMappingId = new Map<string, string>();
  for (const inc of payload.included ?? []) {
    if (
      inc.type === "mappings" &&
      inc.attributes?.externalSite === "myanimelist/anime" &&
      typeof inc.attributes?.externalId === "string"
    ) {
      malByMappingId.set(String(inc.id), inc.attributes.externalId);
    }
  }

  let hiddenUnmapped = 0;
  const results: SlimAnimeResult[] = [];

  for (const item of media) {
    const attr = item.attributes ?? {};
    // Collect MAL ids from this anime's mappings relationships.
    const rel = item.relationships?.mappings?.data;
    const mappingRefs = Array.isArray(rel) ? rel : rel ? [rel] : [];
    const malCandidates = mappingRefs
      .map((r: { id: string }) => malByMappingId.get(String(r.id)))
      .filter((v: string | undefined): v is string => !!v && /^\d+$/.test(v))
      .map(Number);

    const malId = malCandidates[0];
    if (!Number.isFinite(malId)) {
      hiddenUnmapped++;
      continue;
    }

    const mapped = lookupMal(malId);
    if (!mapped || (mapped.tmdbShowId == null && mapped.tmdbMovieId == null)) {
      hiddenUnmapped++;
      continue;
    }

    const titles: Record<string, string> = attr.titles ?? {};
    const titleEnglish = titles.en ?? titles.en_jp ?? null;
    const titleRomaji = titles.en_jp ?? titles.ja_ro ?? null;

    results.push({
      malId,
      // Kitsu has no AniList id; rely on the map's m2a derivation only.
      anilistId: mapped.anilistId ?? null,
      tmdbShowId: mapped.tmdbShowId,
      tmdbMovieId: mapped.tmdbMovieId,
      title: titleEnglish ?? titleRomaji ?? attr.canonicalTitle ?? "",
      titleEnglish,
      image:
        (attr.posterImage?.original as string | undefined) ??
        (attr.posterImage?.large as string | undefined) ??
        null,
      year:
        typeof attr.startDate?.year === "number" ? attr.startDate.year : null,
      episodes:
        typeof attr.episodeCount === "number" ? attr.episodeCount : null,
      // Kitsu subtypes: TV, MOVIE, OVA, ONA, SPECIAL, MUSIC, TV_SPECIAL …
      type:
        FORMAT_LABELS[(attr.subtype ?? attr.showType ?? "").toUpperCase()] ??
        null,
      score:
        typeof attr.averageRating === "string"
          ? Math.round((Number(attr.averageRating) / 10) * 10) / 10
          : null,
      members: typeof attr.userCount === "number" ? attr.userCount : null,
    });
  }

  return results.length > 0
    ? { count: results.length, hiddenUnmapped, results }
    : null;
}
