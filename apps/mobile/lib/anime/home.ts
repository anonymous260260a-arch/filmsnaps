/**
 * Mobile anime HOME feed — on-device multi-provider chain.
 *
 * 2026-09 rework: AniList 403-blocks Cloudflare Workers egress AND residential
 * IPs, so it can no longer be the primary. Kitsu and Shikimori are both
 * keyless, independent, and yield MAL ids natively — the same TMDB-twin gate
 * (verdict Q1) holds regardless of source. Jikan evaluated and dropped: public
 * instance chronically 504s when MAL refuses it.
 *
 * Chain: Kitsu → Shikimori → AniList (opportunistic) → null (UI graceful).
 * Each link's results are mapped into the AniListMedia shape the UI expects,
 * so the consuming component is unchanged.
 */

import { useQuery } from "@tanstack/react-query";
import { lookupMal } from "./resolve";

const KITSU_BASE = "https://kitsu.io/api/edge/anime";
const SHIKIMORI_BASE = "https://shikimori.one/api";
const ANILIST_ENDPOINT = "https://graphql.anilist.co";
const KITSU_MAX_LIMIT = 20;
const UPSTREAM_TIMEOUT_MS = 9000;

export interface AniListMedia {
  id: number;
  malId: number | null;
  title: string;
  titleEnglish: string | null;
  coverImage: string | null;
  bannerImage: string | null;
  /** TV | MOVIE | OVA | ONA | SPECIAL */
  format: string | null;
  episodeCount: number | null;
  season: string | null;
  seasonYear: number | null;
  averageScore: number | null;
  genres: string[];
}

interface AniListPage {
  trending: AniListMedia[];
  popular: AniListMedia[];
  seasonal: AniListMedia[];
}

function currentSeason(): { season: string; year: number } {
  const now = new Date();
  const m = now.getMonth();
  const season =
    m <= 1 || m === 11
      ? "WINTER"
      : m <= 4
        ? "SPRING"
        : m <= 7
          ? "SUMMER"
          : "FALL";
  return { season, year: now.getFullYear() };
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

// ── Link 1: Kitsu ──────────────────────────────────────────────────────

function parseKitsuMedia(payload: {
  data?: Array<Record<string, any>>;
  included?: Array<Record<string, any>>;
}): AniListMedia[] {
  const media = payload.data ?? [];
  if (media.length === 0) return [];

  // kitsu-mapping-id → MAL external id index from the included block.
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

  const results: AniListMedia[] = [];
  for (const item of media) {
    const attr = item.attributes ?? {};
    const rel = item.relationships?.mappings?.data;
    const mappingRefs = Array.isArray(rel) ? rel : rel ? [rel] : [];
    const malStr = mappingRefs
      .map((r: { id: string }) => malByMappingId.get(String(r.id)))
      .find((v: string | undefined): v is string => !!v && /^\d+$/.test(v));
    const malId = malStr ? Number(malStr) : NaN;
    if (!Number.isFinite(malId)) continue;

    const mapped = lookupMal(malId);
    if (!mapped || (mapped.tmdbShowId == null && mapped.tmdbMovieId == null))
      continue;

    const titles: Record<string, string> = attr.titles ?? {};
    const titleEnglish = titles.en ?? titles.en_jp ?? null;

    results.push({
      id: malId,
      malId,
      title:
        titleEnglish ??
        titles.en_jp ??
        titles.ja_ro ??
        attr.canonicalTitle ??
        "",
      titleEnglish,
      coverImage:
        (attr.posterImage?.original as string | undefined) ??
        (attr.posterImage?.large as string | undefined) ??
        null,
      bannerImage: null,
      format: (attr.subtype ?? attr.showType ?? "").toUpperCase() || null,
      episodeCount:
        typeof attr.episodeCount === "number" ? attr.episodeCount : null,
      season: null,
      seasonYear:
        typeof attr.startDate?.year === "number" ? attr.startDate.year : null,
      averageScore:
        typeof attr.averageRating === "string" && attr.averageRating !== ""
          ? Math.round((Number(attr.averageRating) / 10) * 10) / 10
          : null,
      genres: [],
    });
  }
  return results;
}

async function fetchKitsuRail(params: string): Promise<AniListMedia[]> {
  const url = `${KITSU_BASE}?page%5Blimit%5D=${KITSU_MAX_LIMIT}&include=mappings&${params}`;
  const res = await fetchWithTimeout(url, {
    headers: { Accept: "application/vnd.api+json" },
  });
  if (!res.ok) throw new Error(`kitsu rail ${res.status}`);
  return parseKitsuMedia(await res.json());
}

async function fetchFromKitsu(limit: number): Promise<AniListPage | null> {
  const { season, year } = currentSeason();
  const [trending, popular, seasonal] = await Promise.allSettled([
    fetchKitsuRail("sort=-userCount&filter%5Bstatus%5D=current"),
    fetchKitsuRail("sort=-userCount"),
    fetchKitsuRail(
      `sort=-userCount&filter%5Bseason%5D=${season.toLowerCase()}&filter%5Bseason_year%5D=${year}`,
    ),
  ]);
  const pick = (r: PromiseSettledResult<AniListMedia[]>) =>
    r.status === "fulfilled" ? r.value.slice(0, limit) : [];
  const bundle = {
    trending: pick(trending),
    popular: pick(popular),
    seasonal: pick(seasonal),
  };
  if (
    bundle.trending.length === 0 &&
    bundle.popular.length === 0 &&
    bundle.seasonal.length === 0
  )
    return null;
  return bundle;
}

// ── Link 2: Shikimori ──────────────────────────────────────────────────

function parseShikimoriMedia(items: unknown): AniListMedia[] {
  if (!Array.isArray(items)) return [];
  const results: AniListMedia[] = [];
  for (const item of items) {
    const r = item as Record<string, any>;
    const malId = Number(r.id);
    if (!Number.isFinite(malId)) continue;
    const mapped = lookupMal(malId);
    if (!mapped || (mapped.tmdbShowId == null && mapped.tmdbMovieId == null))
      continue;

    const img = r.image?.original as string | undefined;
    const airedOn = typeof r.aired_on === "string" ? r.aired_on : null;

    results.push({
      id: malId,
      malId,
      title: r.name ?? "",
      titleEnglish: null,
      coverImage:
        img && !img.includes("missing")
          ? `${SHIKIMORI_BASE.replace("/api", "")}${img}`
          : null,
      bannerImage: null,
      format: String(r.kind ?? "").toUpperCase() || null,
      episodeCount: typeof r.episodes === "number" ? r.episodes : null,
      season: null,
      seasonYear: airedOn ? Number(airedOn.slice(0, 4)) || null : null,
      averageScore:
        typeof r.score === "string" && r.score !== "" ? Number(r.score) : null,
      genres: [],
    });
  }
  return results;
}

async function fetchShikimoriRail(params: string): Promise<AniListMedia[]> {
  const res = await fetchWithTimeout(`${SHIKIMORI_BASE}/animes?${params}`, {
    headers: { "User-Agent": "Filmsnaps/2.2 (anime feed)" },
  });
  if (!res.ok) throw new Error(`shikimori rail ${res.status}`);
  return parseShikimoriMedia(await res.json());
}

async function fetchFromShikimori(limit: number): Promise<AniListPage | null> {
  const { season, year } = currentSeason();
  const [trending, popular, seasonal] = await Promise.allSettled([
    fetchShikimoriRail(`limit=25&status=ongoing&order=popularity`),
    fetchShikimoriRail(`limit=25&order=popularity`),
    fetchShikimoriRail(
      `limit=25&season=${season.toLowerCase()}_${year}&order=popularity`,
    ),
  ]);
  const pick = (r: PromiseSettledResult<AniListMedia[]>) =>
    r.status === "fulfilled" ? r.value.slice(0, limit) : [];
  const bundle = {
    trending: pick(trending),
    popular: pick(popular),
    seasonal: pick(seasonal),
  };
  if (
    bundle.trending.length === 0 &&
    bundle.popular.length === 0 &&
    bundle.seasonal.length === 0
  )
    return null;
  return bundle;
}

// ── Link 3: AniList (opportunistic — 403s from most IPs since Sep 2026) ─

const MEDIA_FIELDS = `
  id format idMal episodes season seasonYear averageScore genres
  title { romaji english }
  coverImage { extraLarge large }
  bannerImage
`;

const HOME_QUERY = `
  query Home($season: MediaSeason, $seasonYear: Int) {
    trending: Page(page: 1, perPage: 20) {
      media(sort: TRENDING_DESC, type: ANIME) { ${MEDIA_FIELDS} }
    }
    popular: Page(page: 1, perPage: 20) {
      media(sort: POPULARITY_DESC, type: ANIME) { ${MEDIA_FIELDS} }
    }
    seasonal: Page(page: 1, perPage: 20) {
      media(sort: POPULARITY_DESC, type: ANIME, season: $season, seasonYear: $seasonYear) { ${MEDIA_FIELDS} }
    }
  }
`;

function mapAnilistMedia(n: any): AniListMedia | null {
  const malId = Number(n.idMal);
  if (!Number.isFinite(malId)) return null;
  const mapped = lookupMal(malId);
  if (!mapped || (mapped.tmdbShowId == null && mapped.tmdbMovieId == null))
    return null;
  return {
    id: malId,
    malId,
    title: n.title?.romaji ?? n.title?.english ?? "Unknown",
    titleEnglish: n.title?.english ?? null,
    coverImage: n.coverImage?.extraLarge ?? n.coverImage?.large ?? null,
    bannerImage: n.bannerImage ?? null,
    format: n.format ?? null,
    episodeCount: n.episodes ?? null,
    season: n.season ?? null,
    seasonYear: n.seasonYear ?? null,
    averageScore: n.averageScore ?? null,
    genres: n.genres ?? [],
  };
}

async function fetchFromAnilist(limit: number): Promise<AniListPage | null> {
  const { season, year } = currentSeason();
  const res = await fetchWithTimeout(
    ANILIST_ENDPOINT,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: HOME_QUERY,
        variables: { season, seasonYear: year },
      }),
    },
    UPSTREAM_TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`anilist home failed (${res.status})`);
  const json = await res.json();
  const data = json?.data ?? {};
  const toList = (key: string): AniListMedia[] =>
    (data[key]?.media ?? [])
      .map(mapAnilistMedia)
      .filter((x: AniListMedia | null): x is AniListMedia => x != null);
  return {
    trending: toList("trending"),
    popular: toList("popular"),
    seasonal: toList("seasonal"),
  };
}

// ── Chain entry point ──────────────────────────────────────────────────

export async function fetchAniListHome(): Promise<AniListPage> {
  const limit = 20;
  const chain: Array<() => Promise<AniListPage | null>> = [
    () => fetchFromKitsu(limit),
    () => fetchFromShikimori(limit),
    () => fetchFromAnilist(limit),
  ];
  for (const fetcher of chain) {
    try {
      const result = await fetcher();
      if (result) return result;
    } catch {
      // try next
    }
  }
  // All failed — return empty so the UI shows graceful empty state
  return { trending: [], popular: [], seasonal: [] };
}

export function useAniListHome() {
  return useQuery({
    queryKey: ["anilist", "home"],
    queryFn: fetchAniListHome,
    staleTime: 10 * 60_000,
  });
}
