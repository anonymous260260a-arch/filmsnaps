/**
 * Way2Movies stream source adapter.
 *
 * Parses the scraper API response into StreamLink[].
 * Each request returns media URLs for ONE language from ONE server.
 * The source id encodes server+language (e.g. "w2m-s39-hindi").
 *
 * Response shape:
 *   {
 *     "media_urls": ["https://cdn…/index.m3u8?auth_key=…", …],
 *     "language": "Hindi",
 *     "languages": ["Hindi", "English", …],
 *     "subtitles": [{language, label, url}],
 *   }
 *
 * API headers: Referer + Origin must be https://beta.way2movies.live/
 * Server 31's hakunaymatata.com CDN requires Referer: https://netfilm.world/
 * on the media request — wired via StreamLink.headers.
 */
import type { StreamLink, StreamSourceAdapter } from "./types";

interface Way2MoviesSubtitle {
  language?: string;
  label?: string;
  url?: string;
}

interface Way2MoviesResponse {
  media_urls?: string[];
  language?: string;
  languages?: string[];
  subtitles?: Way2MoviesSubtitle[];
  error?: string;
  error_code?: string;
}

/** Infer container from the URL path. */
function containerFor(url: string): string {
  if (/\.m3u8(\?|$)/i.test(url)) return "hls";
  if (/\.mp4(\?|$)/i.test(url)) return "mp4";
  if (/\.mkv(\?|$)/i.test(url)) return "mkv";
  return "hls";
}

/** Infer quality from URL path (/720/, /480/, /1080/). No quality = "Original". */
function qualityFromUrl(url: string): string {
  const m = url.match(/\/(\d{3,4})\//);
  if (m) return `${m[1]}p`;
  return "Original";
}

/** Detect the CDN host and apply the correct Referer if needed. */
function headersForUrl(url: string): Record<string, string> | undefined {
  if (url.includes("hakunaymatata.com")) {
    return { Referer: "https://netfilm.world/" };
  }
  return undefined;
}

/** Extract server name from source id (e.g. "w2m-s39-hindi" → "s39"). */
function serverFromSourceId(sourceId: string): string {
  const m = sourceId.match(/w2m-(s\d+)/);
  return m ? m[1] : "unknown";
}

/**
 * Parse one server+language response into StreamLink[].
 * Each URL becomes one StreamLink with quality + language in the name.
 * e.g. "720p · Hindi" or "Original · English"
 */
export function parseWay2MoviesResponse(
  response: unknown,
  sourceId: string,
): StreamLink[] {
  const data = response as Way2MoviesResponse | null;
  if (!data || typeof data !== "object") return [];
  if (!data.media_urls || data.media_urls.length === 0) return [];

  const language = data.language || "Unknown";
  const subtitles = Array.isArray(data.subtitles) ? data.subtitles : [];
  const server = serverFromSourceId(sourceId);

  return data.media_urls.map((url, idx) => {
    const container = containerFor(url);
    const quality = qualityFromUrl(url);
    const streamHeaders = headersForUrl(url);

    // Clean display: "720p · Hindi" or "Original · English"
    const displayName = `${quality} · ${language}`;

    return {
      id: `${sourceId}-${idx}`,
      quality,
      name: displayName,
      url,
      type: container,
      headers: streamHeaders,
      _meta: {
        codec: container === "hls" ? "hls" : "unknown",
        audio: language,
        isDownloadOnly: false,
        isWebReady: true,
        // Subtitles on the first link only
        ...(idx === 0 && subtitles.length > 0
          ? {
              subtitles: subtitles
                .filter((s) => s.url)
                .map((s) => ({
                  lang: s.language ?? s.label ?? "Unknown",
                  url: s.url!,
                })),
            }
          : {}),
      },
    } as StreamLink & {
      _meta: StreamLink["_meta"] & {
        subtitles?: { lang: string; url: string }[];
      };
    };
  });
}

export function createWay2MoviesAdapter(): StreamSourceAdapter {
  return {
    id: "way2movies",
    parseResponse: (response, params) =>
      parseWay2MoviesResponse(response, params.sourceId ?? "unknown"),
  };
}

export const way2moviesAdapter: StreamSourceAdapter = createWay2MoviesAdapter();
