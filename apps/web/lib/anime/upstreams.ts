/**
 * Shared anime upstream plumbing for /api/anime/* routes.
 *
 * Provider chain (2026-09 rework after the AniList outage):
 *   1. Kitsu      — JSON:API, keyless, independent of AniList AND MAL.
 *   2. Shikimori  — keyless, its `id` IS the MAL id, plugs into lookupMal()
 *                   with zero mapping hops.
 *   3. AniList    — kept as opportunistic link; 403s from Cloudflare Workers
 *                   egress since 2026-09 but works from some client IPs.
 *   4. TMDB       — final link; every result must map to a TMDB twin anyway
 *                   (Q1 gate), so the feed cannot blank unless TMDB is down.
 * Jikan (unofficial MAL) was evaluated and dropped: its public instance
 * 504s whenever MyAnimeList refuses it — chronically unreliable upstream.
 *
 * All parsers enforce the same TMDB-spine gate: results without a TMDB twin
 * in the derived map are dropped (verdict Q1 — no parallel detail surface).
 */

import { lookupMal } from "./resolve";

export interface SlimAnimeResult {
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

export interface SlimBundle {
  count: number;
  hiddenUnmapped: number;
  results: SlimAnimeResult[];
}

/** Upstream format/subtype/kind → the card badge vocabulary the UI expects. */
export const FORMAT_LABELS: Record<string, string> = {
  TV: "TV",
  TV_SHORT: "TV",
  // Shikimori kinds (lowercased before lookup)
  TV_SERIES: "TV",
  MOVIE: "Movie",
  SPECIAL: "Special",
  TV_SPECIAL: "Special",
  OVA: "OVA",
  ONA: "ONA",
  MUSIC: "Music",
};

/** fetch with a hard timeout — rejects on timeout so callers can fall back. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms = 9000,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Northern-hemisphere anime season for the current month. */
export function currentSeasonName(): "WINTER" | "SPRING" | "SUMMER" | "FALL" {
  const m = new Date().getMonth();
  if (m <= 1 || m === 11) return "WINTER";
  if (m <= 4) return "SPRING";
  if (m <= 7) return "SUMMER";
  return "FALL";
}

export const KITSU_BASE = "https://kitsu.io/api/edge/anime";
export const SHIKIMORI_BASE = "https://shikimori.one/api";
export const ANILIST_GRAPHQL = "https://graphql.anilist.co";

/**
 * Kitsu JSON:API payload (data + included mappings) → gated slim results.
 * Returns null when nothing survives the TMDB twin gate.
 */
export function parseKitsuToSlim(payload: {
  data?: Array<Record<string, any>>;
  included?: Array<Record<string, any>>;
}): { results: SlimAnimeResult[]; hiddenUnmapped: number } | null {
  const media = payload.data ?? [];
  if (media.length === 0) return null;

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

  let hiddenUnmapped = 0;
  const results: SlimAnimeResult[] = [];

  for (const item of media) {
    const attr = item.attributes ?? {};
    const rel = item.relationships?.mappings?.data;
    const mappingRefs = Array.isArray(rel) ? rel : rel ? [rel] : [];
    const malId = mappingRefs
      .map((r: { id: string }) => malByMappingId.get(String(r.id)))
      .find((v: string | undefined): v is string => !!v && /^\d+$/.test(v));
    const parsedMal = malId ? Number(malId) : NaN;

    if (!Number.isFinite(parsedMal)) {
      hiddenUnmapped++;
      continue;
    }

    const mapped = lookupMal(parsedMal);
    if (!mapped || (mapped.tmdbShowId == null && mapped.tmdbMovieId == null)) {
      hiddenUnmapped++;
      continue;
    }

    const titles: Record<string, string> = attr.titles ?? {};
    const titleEnglish = titles.en ?? titles.en_jp ?? null;
    const titleRomaji = titles.en_jp ?? titles.ja_ro ?? null;

    results.push({
      malId: parsedMal,
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
      type:
        FORMAT_LABELS[(attr.subtype ?? attr.showType ?? "").toUpperCase()] ??
        null,
      score:
        typeof attr.averageRating === "string" && attr.averageRating !== ""
          ? Math.round((Number(attr.averageRating) / 10) * 10) / 10
          : null,
      members: typeof attr.userCount === "number" ? attr.userCount : null,
    });
  }

  return results.length > 0 ? { results, hiddenUnmapped } : null;
}

/**
 * Shikimori /api/animes payload → gated slim results. Shikimori's `id` is the
 * MAL id, so no mapping hop is needed — straight into lookupMal().
 */
export function parseShikimoriToSlim(
  items: Array<Record<string, any>>,
): { results: SlimAnimeResult[]; hiddenUnmapped: number } | null {
  if (!Array.isArray(items) || items.length === 0) return null;

  let hiddenUnmapped = 0;
  const results: SlimAnimeResult[] = [];

  for (const item of items) {
    const malId = Number(item.id);
    if (!Number.isFinite(malId)) {
      hiddenUnmapped++;
      continue;
    }

    const mapped = lookupMal(malId);
    if (!mapped || (mapped.tmdbShowId == null && mapped.tmdbMovieId == null)) {
      hiddenUnmapped++;
      continue;
    }

    const image = item.image?.original as string | undefined;
    const airedOn = typeof item.aired_on === "string" ? item.aired_on : null;

    results.push({
      malId,
      anilistId: mapped.anilistId ?? null,
      tmdbShowId: mapped.tmdbShowId,
      tmdbMovieId: mapped.tmdbMovieId,
      title: item.name ?? "",
      titleEnglish: null,
      image:
        image && !image.includes("missing_original")
          ? `${SHIKIMORI_BASE.replace("/api", "")}${image}`
          : null,
      year: airedOn ? Number(airedOn.slice(0, 4)) || null : null,
      episodes: typeof item.episodes === "number" ? item.episodes : null,
      type: FORMAT_LABELS[String(item.kind ?? "").toUpperCase()] ?? null,
      score:
        typeof item.score === "string" && item.score !== ""
          ? Number(item.score)
          : null,
      members: null,
    });
  }

  return results.length > 0 ? { results, hiddenUnmapped } : null;
}
