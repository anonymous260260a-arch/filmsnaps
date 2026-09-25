import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders, handleOptions } from "@/lib/cors";
import { desktopSkip } from "../../desktop-skip";

// ponytail: force-static removed — it cached the handler at build time so web
// search never ran the handler at runtime (got stale/empty response). The
// desktop export build is handled by generateStaticParams + desktopSkip().
// Add back `export const dynamic = "force-static"` only if export build fails
// without it — and pair it with a runtime check in desktopSkip().

// Catch-all routes need generateStaticParams for output: 'export'.
// Desktop never calls this route — return one dummy segment so it compiles.
export function generateStaticParams() {
  return [{ tmdb: ["_placeholder"] }];
}

const BASE_URL = "https://api.themoviedb.org/3";

const cacheHeaders = {
  "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
};

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

function corsResponse(
  data: unknown,
  requestOrigin: string | null,
  init?: ResponseInit,
) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      ...cacheHeaders,
      ...init?.headers,
      ...getCorsHeaders(requestOrigin),
    },
  });
}

/**
 * Phase 2 FIX 2 — opt-in detail payload trim (`trim=1`).
 * Mobile appends &trim=1; web RSC does not (untouched).
 * Distinct cache entry from the full payload — fine.
 */
function trimDetailPayload(data: any, isTv: boolean): any {
  if (!data || typeof data !== "object") return data;

  const pick = (
    src: any,
    keys: string[],
  ): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (!src || typeof src !== "object") return out;
    for (const k of keys) {
      if (src[k] !== undefined) out[k] = src[k];
    }
    return out;
  };

  const topKeys = isTv
    ? [
        "id",
        "name",
        "original_name",
        "overview",
        "poster_path",
        "backdrop_path",
        "vote_average",
        "vote_count",
        "first_air_date",
        "genres",
        "episode_run_time",
        "status",
        "number_of_seasons",
        "number_of_episodes",
        "tagline",
        "popularity",
        "original_language",
      ]
    : [
        "id",
        "title",
        "original_title",
        "overview",
        "poster_path",
        "backdrop_path",
        "vote_average",
        "vote_count",
        "release_date",
        "runtime",
        "genres",
        "status",
        "tagline",
        "popularity",
        "original_language",
        "budget",
        "revenue",
      ];

  const out = pick(data, topKeys);

  if (Array.isArray(data.genres)) {
    out.genres = data.genres.map((g: any) => pick(g, ["id", "name"]));
  }

  if (data.credits) {
    const cast = Array.isArray(data.credits.cast) ? data.credits.cast : [];
    const creditsOut: Record<string, unknown> = {
      cast: cast.slice(0, 15).map((c: any) =>
        pick(c, ["id", "name", "character", "profile_path", "order", "cast_id"]),
      ),
    };
    if (Array.isArray(data.credits.crew) && data.credits.crew.length) {
      // Director only — commonly used; tiny.
      const directors = data.credits.crew
        .filter((c: any) => c.job === "Director")
        .slice(0, 3)
        .map((c: any) => pick(c, ["id", "name", "job", "profile_path"]));
      if (directors.length) creditsOut.crew = directors;
    }
    out.credits = creditsOut;
  }

  if (data.videos) {
    const results = Array.isArray(data.videos.results)
      ? data.videos.results
      : [];
    out.videos = {
      results: results
        .filter(
          (v: any) =>
            v.site === "YouTube" &&
            (v.type === "Trailer" || v.type === "Teaser"),
        )
        .slice(0, 6)
        .map((v: any) => pick(v, ["key", "name", "type", "site", "size"])),
    };
  }

  if (data.similar) {
    const results = Array.isArray(data.similar.results)
      ? data.similar.results
      : [];
    out.similar = {
      ...pick(data.similar, ["page", "total_pages", "total_results"]),
      results: results.slice(0, 20).map((m: any) =>
        pick(m, [
          "id",
          "title",
          "name",
          "poster_path",
          "backdrop_path",
          "vote_average",
          "release_date",
          "first_air_date",
          "media_type",
          "overview",
        ]),
      ),
    };
  }

  if (isTv && Array.isArray(data.seasons)) {
    out.seasons = data.seasons.map((s: any) =>
      pick(s, ["id", "season_number", "episode_count", "name", "air_date", "poster_path"]),
    );
  }

  if (isTv && Array.isArray(data.episode_run_time)) {
    out.episode_run_time = data.episode_run_time;
  }

  return out;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tmdb: string[] }> },
) {
  const skip = desktopSkip();
  if (skip) return skip;
  const { tmdb } = await params;
  const searchParams = req.nextUrl.searchParams;
  const wantsTrim = searchParams.get("trim") === "1";
  // Forward everything except our own trim flag to TMDB.
  const forwarded = new URLSearchParams(searchParams.toString());
  forwarded.delete("trim");
  const query = forwarded.toString();
  const origin = req.headers.get("origin");

  const API_KEY = process.env.TMDB_API_KEY;
  if (!API_KEY) {
    return corsResponse(
      { error: "TMDB_API_KEY not configured on this server" },
      origin,
      { status: 500 },
    );
  }

  const endpoint = `/${tmdb.join("/")}${query ? "?" + query : ""}`;

  const res = await fetch(
    `${BASE_URL}${endpoint}${query ? "&" : "?"}api_key=${API_KEY}`,
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return corsResponse(
      { error: `TMDB request failed (${res.status}): ${body.slice(0, 200)}` },
      origin,
      { status: res.status },
    );
  }

  let data = await res.json();

  if (wantsTrim && tmdb[0] === "movie" && tmdb[1] && /^\d+$/.test(tmdb[1])) {
    data = trimDetailPayload(data, false);
  } else if (wantsTrim && tmdb[0] === "tv" && tmdb[1] && /^\d+$/.test(tmdb[1])) {
    data = trimDetailPayload(data, true);
  }

  return corsResponse(data, origin);
}
