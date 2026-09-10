import { NextRequest, NextResponse } from "next/server";
import { desktopSkip } from "../../desktop-skip";

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
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
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

// File size threshold (bytes) above which we consider a stream "download-only"
// 4K remux files (60GB, 34GB) and 10Gbps-only entries are too large for streaming
const DOWNLOAD_ONLY_SIZE_THRESHOLD = 20_000_000_000; // 20GB

interface ApiStream {
  name: string;
  description: string;
  url?: string;
  externalUrl?: string;
  behaviorHints?: {
    notWebReady?: boolean;
    videoSize?: number;
  };
}

interface ApiStreamsResponse {
  streams: ApiStream[];
  cacheMaxAge: number;
}

/**
 * Strip parameters that force download instead of inline playback.
 * R2 signed URLs include `response-content-disposition=attachment` which
 * prevents the browser from streaming the video inline.
 */
function cleanStreamUrl(url: string): string {
  try {
    // Presigned S3/R2 URLs (containing X-Amz-Algorithm or X-Amz-Signature) include
    // query parameters in their SigV4 signature hash. Deleting any parameter breaks
    // signature verification and causes HTTP 403 SignatureDoesNotMatch.
    if (url.includes("X-Amz-Algorithm") || url.includes("X-Amz-Signature")) {
      return url;
    }
    const urlObj = new URL(url);
    urlObj.searchParams.delete("response-content-disposition");
    urlObj.searchParams.delete("response-content-type");
    return urlObj.toString();
  } catch {
    return url;
  }
}

/** Extract quality + codec info from the stream's name/description. */
function parseStreamEntry(stream: ApiStream) {
  const name = stream.name || "";
  const desc = stream.description || "";

  // Extract quality from name (e.g., "HdHub 1080p", "4KHDHub 4K", "VS Sunny 360p")
  let quality = "Unknown";
  const q1080 = /1080[pP]/i.test(desc + name);
  const q720 = /720[pP]/i.test(desc + name);
  const q480 = /480[pP]/i.test(desc + name);
  const q360 = /360[pP]/i.test(desc + name);
  const q2160 = /2160[pP]|4K|UHD/i.test(desc + name);

  if (q2160) quality = "2160p";
  else if (q1080) quality = "1080p";
  else if (q720) quality = "720p";
  else if (q480) quality = "480p";
  else if (q360) quality = "360p";

  // Extract codec from description
  // Patterns: x264, HEVC, x265, H.264, H.265, AV1, VP9
  let codec = "x264"; // default
  if (/HEVC|x265|H\.265/i.test(desc)) codec = "hevc";
  else if (/AV1|av01/i.test(desc)) codec = "av1";
  else if (/VP9|vp09/i.test(desc)) codec = "vp9";
  else if (/H\.264|avc1|x264/i.test(desc)) codec = "h264";

  // Extract audio info
  let audio = "Unknown";
  if (/DTS-HD/i.test(desc)) audio = "DTS-HD";
  else if (/DTS/i.test(desc)) audio = "DTS";
  else if (/DDP5\.1|DDP 5\.1|AAC5\.1/i.test(desc)) audio = "Dolby Digital 5.1";
  else if (/AAC/i.test(desc)) audio = "AAC";

  // Check if download-only (10Gbps, huge files, or explicitly marked)
  const isDownloadOnly =
    /10Gbps|Download Only/i.test(name) ||
    (stream.behaviorHints?.videoSize ?? 0) >= DOWNLOAD_ONLY_SIZE_THRESHOLD;

  // Check if web-ready (streamable in browser)
  // The API marks all entries notWebReady, but the `VS Sunny` entries are
  // direct MP4s without download/redirect params — these are web-ready.
  // PixelDrain URLs with ?download= are not.
  const isWebReady =
    !!stream.url &&
    !isDownloadOnly &&
    /\.mp4(\?.*)?$/i.test(stream.url) &&
    !/[?&]download=/.test(stream.url);

  // Check if it's a playable video URL (not a donation/discord link)
  const isPlayable = !!stream.url;

  return {
    quality,
    codec,
    audio,
    isDownloadOnly,
    isWebReady: isWebReady || false,
    isPlayable,
    size: stream.behaviorHints?.videoSize,
    source: extractSource(name),
  };
}

/** Extract source name from stream name (e.g., "HdHub 1080p" → "HdHub"). */
function extractSource(name: string): string {
  const parts = name.split(/\n| /);
  if (parts.length === 0) return "Unknown";
  // First line / first word is the source
  const firstLine = name.split("\n")[0] || "";
  const sourceMatch = firstLine.match(/^(HdHub|4KHDHub|HdHub VM|VS Sunny)/i);
  return sourceMatch ? sourceMatch[1] : "Unknown";
}

/**
 * Compute streaming priority for a parsed stream entry.
 * Lower number = higher priority (played first).
 *
 * Priority rules (from user requirements):
 * 1. Web-ready files (.mp4 without notWebReady) — highest
 * 2. Streamable MKV in H.264 — high
 * 3. HEVC content — lower on Windows (browser can't play x265 natively)
 * 4. Download-only (huge files, 10Gbps) — lowest
 */
function computePriority(
  parsed: ReturnType<typeof parseStreamEntry>,
  isWindows: boolean,
): number {
  // Download-only entries are last priority
  if (parsed.isDownloadOnly) return 100 + (parsed.size ?? 0) / 1_000_000_000;

  // Non-playable entries filtered out before this
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

    const rawData: ApiStreamsResponse = await response.json();

    // Filter + parse streams
    const parsed = rawData.streams
      .filter((stream) => stream.url || stream.externalUrl) // has SOMETHING
      .map((stream) => ({ raw: stream, parsed: parseStreamEntry(stream) }))
      // Filter: exclude external links (donation/discord)
      .filter((s) => s.parsed.isPlayable)
      // Filter: exclude empty
      .filter((s) => s.raw.url);

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
    const links = parsed.map((s, idx) => {
      const isHevc = s.parsed.codec === "hevc";
      const desc = s.raw.description || "";

      return {
        // Quality label for the dropdown
        quality: s.parsed.isDownloadOnly
          ? `${s.parsed.quality} [Download Only]`
          : s.parsed.isWebReady
            ? `${s.parsed.quality} [Web]`
            : s.parsed.quality,
        // Entry name (used for codec detection by DirectVideoPlayer)
        name: desc,
        id: idx.toString(),
        size: s.raw.behaviorHints?.videoSize
          ? `${(s.raw.behaviorHints.videoSize / 1_000_000_000).toFixed(2)}GB`
          : undefined,
        url: cleanStreamUrl(s.raw.url || ""),
        type: desc.includes(".mkv")
          ? "mkv"
          : desc.includes(".mp4")
            ? "mp4"
            : "mp4",
        // Extra metadata for the dropdown UI
        _meta: {
          codec: s.parsed.codec,
          audio: s.parsed.audio,
          source: s.parsed.source,
          isDownloadOnly: s.parsed.isDownloadOnly,
          isWebReady: s.parsed.isWebReady,
          sizeBytes: s.raw.behaviorHints?.videoSize,
        },
      };
    });

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
