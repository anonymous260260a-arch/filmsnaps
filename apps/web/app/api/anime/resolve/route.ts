/**
 * /api/anime/resolve — ID-space translation over the derived anime map.
 *
 * GET params:
 *   from=tmdb_show&id=&season=&episode=  → fail-safe cour/episode mapper (Q7)
 *   from=tmdb_movie&id=                  → { malId, anilistId } | null-miss
 *   from=mal&id=                         → { anilistId, tmdbShowId?, tmdbMovieId? }
 *
 * The map is static build-time data → responses are identical for a given
 * key set; edge-cache for 24h like the TMDB proxy.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders, handleOptions } from "@/lib/cors";
import { resolveShow, resolveMovie, lookupMal } from "@/lib/anime/resolve";
import { desktopSkip } from "../../desktop-skip";

export const dynamic = "force-static";

const cacheHeaders = {
  "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
};

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

function corsResponse(data: unknown, requestOrigin: string | null) {
  return NextResponse.json(data, {
    headers: { ...cacheHeaders, ...getCorsHeaders(requestOrigin) },
  });
}

function toInt(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export async function GET(req: NextRequest) {
  const skip = desktopSkip();
  if (skip) return skip;
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const id = toInt(sp.get("id"));
  const origin = req.headers.get("origin");

  if (id == null) {
    return corsResponse({ error: "missing id" }, origin);
  }

  switch (from) {
    case "tmdb_show": {
      const season = toInt(sp.get("season")) ?? 1;
      const episode = toInt(sp.get("episode")) ?? 1;
      return corsResponse(resolveShow(id, season, episode), origin);
    }
    case "tmdb_movie": {
      const hit = resolveMovie(id);
      // Uniform miss shape — callers treat falsy malId as "not in the map".
      return corsResponse(
        hit ? { ok: true, ...hit } : { ok: false, miss: true },
        origin,
      );
    }
    case "mal": {
      const hit = lookupMal(id);
      return corsResponse(hit ?? { ok: false, miss: true }, origin);
    }
    default:
      return corsResponse({ error: "unknown from" }, origin);
  }
}
