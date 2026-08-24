/**
 * Mobile anime ID resolution — fail-safe mapper over the OTA-bundled slim map
 * (verdict §9 Q7: never guess a cour; return `miss` instead).
 *
 * This is a port of apps/web/lib/anime/resolve.ts. It imports the duplicated
 * anime-map.json directly (ships via EAS OTA — no native rebuild). When a local
 * lookup misses, callers fall back to the web /api/anime/resolve proxy.
 *
 * Map provenance: scripts/derive-anime-map.mjs ← Fribb/anime-lists.
 *   shows  : tmdbShowId → candidates [{ s (TMDB season|null), o (episode offset|null), m (MAL id), a (AniList id|null) }]
 *   movies : tmdbMovieId → { m, a }
 *   m2a    : malId → anilistId
 */

import animeMap from "./anime-map.json";

export interface AnimeCandidate {
  /** TMDB season this candidate is aligned to (null = unaligned). */
  s: number | null;
  /** Episode offset to subtract (TVDb-keyed upstream; null = 0). */
  o: number | null;
  /** MyAnimeList id — MegaPlay's primary key space. */
  m: number;
  /** AniList id — MegaPlay's fallback key space. */
  a: number | null;
}

/** Deterministic success result for a TMDB show → MAL episode translation. */
export interface ShowResolution {
  ok: true;
  malId: number;
  anilistId: number | null;
  /** MAL-relative episode to hand to MegaPlay. */
  episode: number;
  matchedSeason: number | null;
  via: "season-match" | "single-candidate";
}

/**
 * Hard-stop miss (verdict Q7 step 4 — guessing wrong plays the wrong cour,
 * which is strictly worse than "not found").
 */
export interface ShowMiss {
  ok: false;
  miss: true;
  reason: "no-candidates" | "no-season-match" | "episode-below-offset";
  /** How many candidates existed — telemetry/debug context. */
  candidates: number;
}

const shows =
  (animeMap as { shows?: Record<string, AnimeCandidate[]> }).shows ?? {};
const movies =
  (
    animeMap as {
      movies?: Record<string, { m: number; a: number | null }>;
    }
  ).movies ?? {};
const m2a = (animeMap as { m2a?: Record<string, number> }).m2a ?? {};

function pickLowestMal(list: AnimeCandidate[]): AnimeCandidate | undefined {
  return list.reduce<AnimeCandidate | undefined>(
    (best, c) => (!best || c.m < best.m ? c : best),
    undefined,
  );
}

/**
 * Translate (TMDB show id, TMDB season, TMDB episode) → (MAL entry, episode).
 *   1. No candidates → miss ("no-candidates").
 *   2. Candidate aligned to this TMDB season → subtract offset; if result < 1 → miss.
 *   3. Exactly ONE candidate → pass the TMDB episode straight through.
 *   4. Multiple unaligned candidates → HARD MISS. Never guess.
 */
export function resolveShow(
  tmdbShowId: string | number,
  season: number,
  episode: number,
): ShowResolution | ShowMiss {
  const candidates = shows[String(tmdbShowId)];
  if (!candidates || candidates.length === 0) {
    return { ok: false, miss: true, reason: "no-candidates", candidates: 0 };
  }

  const seasonMatches = candidates.filter((c) => c.s != null && c.s === season);
  if (seasonMatches.length > 0) {
    const c = pickLowestMal(seasonMatches)!;
    const malEpisode = episode - (c.o ?? 0);
    if (!Number.isFinite(malEpisode) || malEpisode < 1) {
      return {
        ok: false,
        miss: true,
        reason: "episode-below-offset",
        candidates: candidates.length,
      };
    }
    return {
      ok: true,
      malId: c.m,
      anilistId: c.a ?? m2a[String(c.m)] ?? null,
      episode: malEpisode,
      matchedSeason: season,
      via: "season-match",
    };
  }

  if (candidates.length === 1) {
    const c = candidates[0];
    return {
      ok: true,
      malId: c.m,
      anilistId: c.a ?? m2a[String(c.m)] ?? null,
      episode,
      matchedSeason: null,
      via: "single-candidate",
    };
  }

  return {
    ok: false,
    miss: true,
    reason: "no-season-match",
    candidates: candidates.length,
  };
}

/** TMDB movie id → MAL/AniList pair (anime films only). Null when unmapped. */
export function resolveMovie(
  tmdbMovieId: string | number,
): { malId: number; anilistId: number | null } | null {
  const hit = movies[String(tmdbMovieId)];
  if (!hit) return null;
  return { malId: hit.m, anilistId: hit.a ?? m2a[String(hit.m)] ?? null };
}

/**
 * Lightweight show→MAL/AniList pair for *opening* a title (detail-page Watch
 * press, history re-open). Unlike resolveShow it does NOT require an exact
 * episode-offset match (that strictness belongs to per-episode playback
 * cour-math). It just needs the MAL id so the player can talk to MegaPlay; if a
 * season-aligned candidate exists we use it, otherwise the single/lowest-MAL
 * candidate. Null when the show has no map entry at all.
 */
export function resolveShowIds(
  tmdbShowId: string | number,
  season?: number,
): { malId: number; anilistId: number | null } | null {
  const cands = shows[String(tmdbShowId)];
  if (!cands || cands.length === 0) return null;
  const seasonMatch =
    season != null ? cands.filter((c) => c.s != null && c.s === season) : [];
  const pick = seasonMatch[0] ?? pickLowestMal(cands);
  if (!pick) return null;
  return {
    malId: pick.m,
    anilistId: pick.a ?? m2a[String(pick.m)] ?? null,
  };
}

/** MAL id → AniList id conversion (fallback chain step 1). */
export function malToAni(malId: string | number): number | null {
  return m2a[String(malId)] ?? null;
}

// ── Reverse index: MAL id → TMDB twin (search click-through) ────────

interface MalLookup {
  anilistId: number | null;
  tmdbShowId?: number;
  tmdbMovieId?: number;
}

let reverseIndex: Map<number, MalLookup> | null = null;

function getReverseIndex(): Map<number, MalLookup> {
  if (reverseIndex) return reverseIndex;
  const idx = new Map<number, MalLookup>();
  const upsert = (malId: number, patch: Partial<MalLookup>) => {
    const cur = idx.get(malId) ?? { anilistId: m2a[String(malId)] ?? null };
    idx.set(malId, { ...cur, ...patch });
  };
  for (const [showId, cands] of Object.entries(shows)) {
    for (const c of cands) upsert(c.m, { tmdbShowId: Number(showId) });
  }
  for (const [movieId, mv] of Object.entries(movies)) {
    upsert(mv.m, { tmdbMovieId: Number(movieId) });
  }
  reverseIndex = idx;
  return idx;
}

/**
 * Everything known about a MAL id — used by the search route to attach the
 * TMDB twin to AniList results (titles without one are hidden in v1, Q1).
 */
export function lookupMal(malId: string | number): MalLookup | null {
  return getReverseIndex().get(Number(malId)) ?? null;
}

/**
 * Resolve the anime-native ids (MAL + AniList) for a TMDB twin so a history /
 * CW press can re-open the anime session WITHOUT the user re-tapping the feed.
 * TV is cour-aware (resolveShow); movie uses resolveMovie. Returns null when the
 * twin has no anime map entry (not an anime title, or unmapped).
 */
export function tmdbToAnimeIds(
  tmdbId: string | number,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): { malId: number; anilistId: number | null } | null {
  if (mediaType === "tv") {
    // Opening a title only needs the MAL id, not strict per-episode cour math.
    return resolveShowIds(tmdbId, season);
  }
  return resolveMovie(tmdbId);
}
