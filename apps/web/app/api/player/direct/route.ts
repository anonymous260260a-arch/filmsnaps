import { NextRequest, NextResponse } from "next/server";
import { desktopSkip } from "../../desktop-skip";
import {
  buildStreamSourceUrl,
  cleanStreamUrl,
  extractSource,
  getProvider,
  parseStreamEntry,
  extractEpisodeFiles,
  mapFalixFiles,
  resolveStreams,
  getStreamSelector,
  FALIX_API_BASE,
} from "@filmsnaps/shared";
import type { StreamLink } from "@filmsnaps/shared";

export const revalidate = 1;

/**
 * Server-side proxy for the HDHub direct-stream API.
 *
 * HDHub API uses IMDB IDs (tt format), not TMDB IDs.
 *
 * API format:
 *   Movies: https://hdhub.thevolecitor.qzz.io/stream/movie/{imdbId}.json
 *   TV:     https://hdhub.thevolecitor.qzz.io/stream/series/{imdbId}:{season}:{episode}.json
 *
 * Response: { streams: [...], cacheMaxAge: 14400 }
 * Each stream: { name, description, url, behaviorHints: { notWebReady, videoSize } }
 *
 * This proxy:
 * 1. Avoids CORS issues from browser to the HDHub API
 * 2. Accepts a TMDB ID and converts to IMDB ID via TMDB API (client sends tmdbId)
 * 3. Sorts/weights streams for web playback (smaller files, H.264 preferred)
 * 4. Filters out donation/Discord entries (externalUrl) and download-only entries
 *
 * Parsing lives in the shared HDHub/Falix adapters
 * (packages/shared/src/providers/sources/) — this route only adds the
 * platform-specific bits: TMDB→IMDB resolution, CORS-free fetching, and the
 * Windows HEVC penalty (browsers can't hardware-decode x265).
 */

const HDHUB_API_BASE = "https://hdhub.thevolecitor.qzz.io";

/**
 * Convert TMDB ID → IMDB ID by querying the local TMDB proxy route
 * (/api/tmdb/[...tmdb]/route.ts), which adds the API key server-side.
 * HDHub API requires IMDB IDs (e.g., "tt0137523") for lookups.
 */
async function resolveImdbId(
  mediaType: "movie" | "tv",
  tmdbId: string | number,
): Promise<string | null> {
  // If the input already looks like an IMDB ID (starts with "tt"), return it directly
  const idStr = String(tmdbId);
  if (/^tt\d+$/i.test(idStr)) return idStr;

  try {
    // Use the internal TMDB proxy route — avoids exposing API key to client
    // and uses the same base the rest of the app uses.
    // Use relative path when running server-side (worker/Vercel) so the
    // request stays same-origin. NEXT_PUBLIC_SITE_URL is only needed for
    // client-side calls; on the server, relative paths resolve to the same
    // host. Falls back to localhost for local dev.
    const baseUrl =
      typeof window === "undefined"
        ? process.env.NEXT_PUBLIC_SITE_URL || ""
        : process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const res = await fetch(
      `${baseUrl}/api/tmdb/${mediaType}/${tmdbId}/external_ids`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!res.ok) return null;

    const data = (await res.json()) as { imdb_id?: string | null };
    return data.imdb_id || null;
  } catch {
    return null;
  }
}

/**
 * Compute streaming priority for a parsed stream entry (lower = first).
 * Uses the shared parser's metadata; the Windows HEVC penalty is web-only —
 * mobile/desktop decode HEVC in hardware, browsers don't.
 */
function computePriority(
  parsed: ReturnType<typeof parseStreamEntry>,
  isWindows: boolean,
): number {
  // Download-only entries are last priority
  if (parsed.isDownloadOnly) return 100 + (parsed.size ?? 0) / 1_000_000_000;

  // Web-ready MP4 = highest priority
  if (parsed.isWebReady && parsed.codec === "h264") return 0;

  // HEVC on Windows = lower priority (browser can't play x265 natively)
  if (parsed.codec === "hevc" && isWindows) return 50;

  // H.264 MKV
  if (parsed.codec === "h264") return 10;

  // HEVC on Android/macOS = medium priority
  if (parsed.codec === "hevc") return 20;

  // AV1/VP9 = fallback
  if (parsed.codec === "av1" || parsed.codec === "vp9") return 30;

  // Everything else
  return 40;
}

// ── Falix fallback ─────────────────────────────────────────────────

async function fetchFalixLinks(
  tmdbId: string,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): Promise<StreamLink[]> {
  const res = await fetch(`${FALIX_API_BASE}/api/id/${tmdbId}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const data = await res.json();

  const files = extractEpisodeFiles(data, mediaType, season, episode);
  if (files.length === 0) return [];

  const title = (data as { title?: string }).title || "Unknown";
  return mapFalixFiles(files, title, `${FALIX_API_BASE}/dl`);
}

export async function GET(request: NextRequest) {
  const skip = desktopSkip();
  if (skip) return skip;

  const { searchParams } = new URL(request.url);
  const tmdbId = searchParams.get("id");

  if (!tmdbId) {
    return NextResponse.json(
      { error: "Missing required query parameter: id" },
      { status: 400 },
    );
  }

  // Determine if TV or movie based on query params
  const season = searchParams.get("season");
  const episode = searchParams.get("episode");
  const isTv = season && episode;

  // ── Registry-driven direct providers (e.g. spacedom) ────────────────
  // Any provider whose registry entry declares streamSources[] resolves
  // through the shared tiered pipeline — no IMDB conversion needed when the
  // upstream keys titles by TMDB id (spacedom does).
  const providerId = searchParams.get("provider");
  if (providerId && providerId !== "direct") {
    const def = getProvider(providerId);
    if (def?.streamSources && def.streamSources.length > 0) {
      const result = await resolveStreams(
        {
          streamSources: def.streamSources,
          imdbId: "",
          tmdbId: Number(tmdbId),
          mediaType: isTv ? "tv" : "movie",
          season: isTv ? Number(season) : undefined,
          episode: isTv ? Number(episode) : undefined,
          // Browsers cannot attach custom headers (Referer…) to media
          // requests — header-gated links (e.g. heron's file CDN) would
          // 403, so they don't count as playable and are dropped.
          linkFilter: (link) => !link.headers,
        },
        async (source, ctx) => {
          const url = buildStreamSourceUrl(source, ctx);
          if (!url) throw new Error(`source ${source.id} has no urlTemplate`);
          const res = await fetch(url, {
            headers: { Accept: "application/json", ...(source.headers ?? {}) },
            signal: AbortSignal.timeout(source.timeoutMs ?? 8000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        },
      );
      let orderedLinks = result.links;
      try {
        // Provider-specific ordering (e.g. spacedom: heron first). Falls
        // back to pool order when the selector can't rank.
        const sel = await getStreamSelector(def.selection).select(
          result.links,
          { cellularMaxMB: 0, maxQuality: null, preferredLanguage: "auto" },
        );
        orderedLinks = sel.sortedLinks;
      } catch {}
      return NextResponse.json({
        tmdb_id: Number(tmdbId),
        imdb_id: "",
        media_type: isTv ? "tv" : "movie",
        links: orderedLinks.map((l, idx) => ({
          ...l,
          id: String(idx),
          headers: undefined,
        })),
      });
    }
  }

  // HDHub API requires IMDB IDs (tt format), so resolve from TMDB ID
  const imdbId = await resolveImdbId(isTv ? "tv" : "movie", tmdbId);

  if (!imdbId) {
    return NextResponse.json(
      { error: `Could not resolve IMDB ID for TMDB ID ${tmdbId}` },
      { status: 404 },
    );
  }

  // Build HDHub API URL using IMDB ID
  let apiUrl: string;
  if (isTv) {
    apiUrl = `${HDHUB_API_BASE}/stream/series/${imdbId}:${season}:${episode}.json`;
  } else {
    apiUrl = `${HDHUB_API_BASE}/stream/movie/${imdbId}.json`;
  }

  // Detect platform from user-agent for HEVC preference
  const userAgent = request.headers.get("user-agent") || "";
  const isWindows = /Windows/.test(userAgent);

  try {
    const response = await fetch(apiUrl, {
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `HDHub API returned ${response.status}: ${response.statusText}`,
        },
        { status: response.status },
      );
    }

    const rawData: {
      streams: Array<{
        name: string;
        description: string;
        url?: string;
        externalUrl?: string;
        behaviorHints?: { notWebReady?: boolean; videoSize?: number };
      }>;
      cacheMaxAge: number;
    } = await response.json();

    // Filter + parse streams via the shared HDHub parser
    const parsed = rawData.streams
      .filter((stream) => stream.url || stream.externalUrl) // has SOMETHING
      .map((stream) => ({ raw: stream, parsed: parseStreamEntry(stream) }))
      // Filter: exclude external links (donation/discord)
      .filter((s) => !!s.raw.url);

    // Sort by priority — but keep both streaming-friendly and download-only
    // The client will show all in a dropdown, but auto-select the highest-priority
    // for initial playback.
    parsed.sort((a, b) => {
      return (
        computePriority(a.parsed, isWindows) -
        computePriority(b.parsed, isWindows)
      );
    });

    // Map to our internal format
    const links: StreamLink[] = parsed.map((s, idx) => {
      const desc = s.raw.description || "";

      return {
        quality: s.parsed.isDownloadOnly
          ? `${s.parsed.quality} [Download Only]`
          : s.parsed.isWebReady
            ? `${s.parsed.quality} [Web]`
            : s.parsed.quality,
        name: desc,
        id: idx.toString(),
        size: s.raw.behaviorHints?.videoSize
          ? `${(s.raw.behaviorHints.videoSize / 1_000_000_000).toFixed(2)}GB`
          : undefined,
        url: cleanStreamUrl(s.raw.url || ""),
        type: desc.includes(".mkv") ? "mkv" : "mp4",
        _meta: {
          codec: s.parsed.codec,
          audio: s.parsed.audio,
          source: extractSource(desc),
          isDownloadOnly: s.parsed.isDownloadOnly,
          isWebReady: s.parsed.isWebReady,
          sizeBytes: s.raw.behaviorHints?.videoSize,
        },
      };
    });

    // ── Falix fallback: when HDHub gives ≤3 playable links, supplement from falix ──
    const playableCount = links.filter((l) => !l._meta?.isDownloadOnly).length;
    if (playableCount <= 3) {
      try {
        const falixLinks = await fetchFalixLinks(
          tmdbId,
          isTv ? "tv" : "movie",
          isTv ? parseInt(season!, 10) : undefined,
          isTv ? parseInt(episode!, 10) : undefined,
        );
        if (falixLinks.length > 0) {
          links.push(...falixLinks);
        }
      } catch {
        // Falix failure is non-fatal — HDHub links are still returned
      }
    }

    const data = isTv
      ? {
          tmdb_id: parseInt(tmdbId, 10),
          imdb_id: imdbId,
          media_type: "tv",
          links,
        }
      : {
          tmdb_id: parseInt(tmdbId, 10),
          imdb_id: imdbId,
          media_type: "movie",
          links,
        };

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": `public, max-age=${rawData.cacheMaxAge || 300}, s-maxage=${rawData.cacheMaxAge || 300}`,
      },
    });
  } catch (error: any) {
    if (error?.name === "TimeoutError") {
      return NextResponse.json(
        { error: "HDHub API timed out. The server may be under load." },
        { status: 504 },
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch from HDHub API" },
      { status: 502 },
    );
  }
}
