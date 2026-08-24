/**
 * Anime ID resolution — fail-safe mapper over the derived slim map
 * (verdict §9 Q7: never guess a cour; return `miss` instead).
 *
 * Server-side only: imports the 591 KB anime-map.json directly into the
 * Worker bundle (verdict Q2 — no KV, no asset fetch). The client NEVER
 * imports this module; it talks to /api/anime/resolve.
 *
 * Map provenance: scripts/derive-anime-map.mjs ← Fribb/anime-lists.
 *   shows  : tmdbShowId → candidates [{ s (TMDB season|null), o (tvdb-keyed
 *            episode offset|null), m (MAL id), a (AniList id|null) }]
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
 *
 * Verdict algorithm, adapted to Fribb fields (`s` is TMDB-keyed season when
 * upstream provides it, else null):
 *   1. No candidates → miss ("no-candidates").
 *   2. Any candidate aligned to exactly this TMDB season → subtract its
 *      offset; if the result drops below 1 → miss (the requested episode
 *      lives in the preceding cour/season entry — refusing beats off-by-one).
 *   3. Exactly ONE candidate for the whole show → pass the TMDB episode
 *      straight through (MegaPlay/MAL generally handle absolute numbering).
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

/** MAL id → AniList id conversion (fallback chain step 1). */
export function malToAni(malId: string | number): number | null {
  return m2a[String(malId)] ?? null;
}

// ── Reverse index: MAL id → TMDB twin (search click-through) ────────
// Built lazily on first use so route cold starts that never touch it
// pay nothing.

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
