/**
 * Subtitles API — server-side proxy with provider fallback.
 *
 * GET /api/subtitles?tmdb_id=123&type=movie|tv&season_number=1&episode_number=2
 *
 * Provider chain (per product decision):
 *   1. Subdl — used until it rate-limits us.
 *   2. Wyzie — tried when Subdl is rate-limited, errors, or finds nothing.
 *   3. Both unavailable/rate-limited → HTTP 429; the client then shows
 *      "no subtitles found" to the user.
 *
 * Both provider keys live ONLY on this server (SUBDL_API_KEY / WYZIE_API_KEY
 * env secrets, set like TMDB_API_KEY) — the mobile app never asks users for a
 * key and never ships one in the binary. Subtitle FILE downloads (the URLs in
 * the response) are public and fetched by the client directly.
 *
 * Response: `{ provider: "subdl" | "wyzie" | "none", subtitles: Entry[] }`
 * where Entry = { releaseName, language, url, format, hi } — normalized to
 * media3-decodable formats (srt/ass/ssa/vtt/sub) with absolute URLs.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders, handleOptions } from "@/lib/cors";
import { desktopSkip } from "../desktop-skip";

const SUBDL_API_URL = "https://api.subdl.com/api/v1/subtitles";
const SUBDL_DL_BASE = "https://dl.subdl.com";
const WYZIE_API_URL = "https://sub.wyzie.io/search";

const SUPPORTED_FORMATS = new Set(["srt", "ass", "ssa", "vtt", "sub"]);

const cacheHeaders = {
  "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
};

interface SubtitleEntry {
  releaseName: string;
  language: string;
  url: string;
  format: string;
  hi: boolean;
}

class ProviderError extends Error {
  constructor(
    public kind: "rate_limited" | "http",
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

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

function absoluteUrl(url: string, base: string): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

function toEntry(
  rawUrl: unknown,
  format: unknown,
  releaseName: unknown,
  language: unknown,
  hi: unknown,
  base: string,
): SubtitleEntry | null {
  const f = String(format ?? "").toLowerCase();
  if (!SUPPORTED_FORMATS.has(f)) return null;
  const url = absoluteUrl(String(rawUrl ?? ""), base);
  if (!url) return null;
  return {
    releaseName: String(releaseName || "Subtitle").slice(0, 200),
    language: String(language || "Unknown"),
    url,
    format: f,
    hi: !!hi,
  };
}

function dedupe(entries: SubtitleEntry[]): SubtitleEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) =>
    seen.has(e.url) ? false : (seen.add(e.url), true),
  );
}

/** Subdl v1: `unpack=1` returns per-file entries inside `subtitles[].unpack_files`. */
async function fetchFromSubdl(
  tmdbId: string,
  type: "movie" | "tv",
  season: string | null,
  episode: string | null,
): Promise<SubtitleEntry[]> {
  const q = new URLSearchParams({
    api_key: process.env.SUBDL_API_KEY as string,
    tmdb_id: tmdbId,
    type,
    unpack: "1",
    subs_per_page: "30",
  });
  if (type === "tv") {
    if (season) q.set("season_number", season);
    if (episode) q.set("episode_number", episode);
  }

  const res = await fetch(`${SUBDL_API_URL}?${q.toString()}`);
  if (res.status === 429)
    throw new ProviderError("rate_limited", 429, "Subdl rate limited");
  if (!res.ok)
    throw new ProviderError("http", res.status, `Subdl HTTP ${res.status}`);

  const payload = await res.json();
  if (payload?.status === false) {
    const msg = String(payload?.error ?? payload?.message ?? "");
    if (/rate limit|too many/i.test(msg)) {
      throw new ProviderError("rate_limited", 429, `Subdl: ${msg}`);
    }
    if (/authoriz|api_key|not_authorized/i.test(msg)) {
      throw new ProviderError("http", 401, `Subdl: ${msg}`);
    }
    return []; // "query not found" and friends = genuinely no results
  }

  const entries: SubtitleEntry[] = [];
  for (const sub of payload?.subtitles ?? []) {
    const files: any[] = Array.isArray(sub?.unpack_files)
      ? sub.unpack_files
      : [];
    if (files.length > 0) {
      for (const file of files) {
        const entry = toEntry(
          file?.url,
          file?.format,
          file?.release_name || sub?.release_name || sub?.name,
          file?.language,
          file?.hi,
          SUBDL_DL_BASE,
        );
        if (entry) entries.push(entry);
      }
      continue;
    }
    // Legacy entries without unpack data: direct subtitle files only.
    const entry = toEntry(
      sub?.url,
      String(sub?.url ?? "")
        .split("?")[0]
        .toLowerCase()
        .match(/\.([a-z0-9]+)$/)?.[1],
      sub?.release_name || sub?.name,
      sub?.language,
      false,
      SUBDL_DL_BASE,
    );
    if (entry) entries.push(entry);
  }
  return dedupe(entries);
}

/** Wyzie: searches by TMDB id directly (`id=`), returns a JSON array. */
async function fetchFromWyzie(
  tmdbId: string,
  type: "movie" | "tv",
  season: string | null,
  episode: string | null,
): Promise<SubtitleEntry[]> {
  const q = new URLSearchParams({
    id: tmdbId,
    key: process.env.WYZIE_API_KEY as string,
  });
  if (type === "tv") {
    // Wyzie requires season and episode together.
    if (season) q.set("season", season);
    if (episode) q.set("episode", episode);
  }

  const res = await fetch(`${WYZIE_API_URL}?${q.toString()}`);
  if (res.status === 429)
    throw new ProviderError("rate_limited", 429, "Wyzie rate limited");
  if (!res.ok)
    throw new ProviderError("http", res.status, `Wyzie HTTP ${res.status}`);

  const data = await res.json();
  const list: any[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.results)
      ? data.results
      : [];
  const entries: SubtitleEntry[] = [];
  for (const sub of list) {
    const entry = toEntry(
      sub?.url,
      sub?.format,
      sub?.release || sub?.fileName || sub?.media,
      sub?.display || sub?.language,
      sub?.isHearingImpaired,
      "https://sub.wyzie.io",
    );
    if (entry) entries.push(entry);
  }
  return dedupe(entries);
}

export async function GET(req: NextRequest) {
  const skip = desktopSkip();
  if (skip) return skip;
  const origin = req.headers.get("origin");

  const sp = req.nextUrl.searchParams;
  const tmdbId = sp.get("tmdb_id");
  const type = sp.get("type");
  if (!tmdbId || !/^\d+$/.test(tmdbId)) {
    return corsResponse({ error: "tmdb_id (numeric) is required" }, origin, {
      status: 400,
    });
  }
  if (type !== "movie" && type !== "tv") {
    return corsResponse({ error: "type must be movie or tv" }, origin, {
      status: 400,
    });
  }
  const season = sp.get("season_number");
  const episode = sp.get("episode_number");
  if (season && !/^\d+$/.test(season)) {
    return corsResponse({ error: "season_number must be numeric" }, origin, {
      status: 400,
    });
  }
  if (episode && !/^\d+$/.test(episode)) {
    return corsResponse({ error: "episode_number must be numeric" }, origin, {
      status: 400,
    });
  }

  const providers = [
    { name: "subdl", key: process.env.SUBDL_API_KEY, fetch: fetchFromSubdl },
    { name: "wyzie", key: process.env.WYZIE_API_KEY, fetch: fetchFromWyzie },
  ].filter((p) => !!p.key);

  if (providers.length === 0) {
    return corsResponse(
      { error: "SUBDL_API_KEY / WYZIE_API_KEY not configured on this server" },
      origin,
      { status: 500 },
    );
  }

  let sawRateLimit = false;
  for (const provider of providers) {
    try {
      const subtitles = await provider.fetch(tmdbId, type, season, episode);
      if (subtitles.length > 0) {
        return corsResponse({ provider: provider.name, subtitles }, origin);
      }
      // Provider reachable but empty — fall through to the next one.
    } catch (e) {
      if (e instanceof ProviderError && e.kind === "rate_limited")
        sawRateLimit = true;
      // Other provider errors — fall through to the next one.
    }
  }

  if (sawRateLimit) {
    return corsResponse(
      { error: "Subtitle providers are rate limited" },
      origin,
      { status: 429 },
    );
  }
  return corsResponse({ provider: "none", subtitles: [] }, origin);
}
