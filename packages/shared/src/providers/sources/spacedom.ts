/**
 * SpaceDom adapter — api.spacedom.fun multi-server direct API.
 *
 * Five upstream servers (heron, raven, kite, falcon, condor) share ONE
 * response shape — a single JSON object per (server, title, episode):
 *
 *   {
 *     "server": "heron",
 *     "status": "ready" | "unavailable",
 *     "streamType": "file" | "hls",
 *     "url": "https://…/video.mp4?sign=…&t=…" | "https://…/index.m3u8?auth_key=…",
 *     "relay": "media",
 *     "playbackHeaders": { "Referer": "https://netfilm.world/" },   // optional
 *     "quality": 720,                                               // optional (hls)
 *     "languages": ["Original Audio", "…"], "language": "Original Audio",
 *     "subtitles": [{ id, path, language, label, origin }],         // optional
 *     "message": "…"                                                // when unavailable
 *   }
 *
 * Keys titles by TMDB id (not IMDB), so lookups use the urlTemplate on the
 * StreamSourceConfig, not a catalog path.
 *
 * A ready response yields exactly 0 or 1 StreamLink — these servers are
 * single-stream per title. "unavailable" ("this server doesn't have this
 * title") is a normal, expected outcome and yields an empty array, not an
 * error.
 */
import type { StreamLink } from "./types";
import type { StreamSourceAdapter } from "./types";

interface SpacedomSubtitle {
  id?: string;
  path?: string;
  language?: string;
  label?: string;
}

interface SpacedomResponse {
  server?: string;
  status?: string;
  streamType?: string;
  url?: string;
  relay?: string;
  playbackHeaders?: Record<string, string>;
  quality?: number;
  languages?: string[];
  language?: string;
  subtitles?: SpacedomSubtitle[];
  message?: string;
}

/** Container label for a stream URL — file URLs end in an extension, HLS don't. */
function containerFor(url: string, streamType?: string): string {
  if (streamType === "hls" || /\.m3u8(\?|$)/i.test(url)) return "hls";
  const m = /\.(mp4|mkv|webm)(\?|$)/i.exec(url);
  return m ? m[1].toLowerCase() : "mp4";
}

export function parseSpacedomResponse(response: unknown): StreamLink[] {
  const data = response as SpacedomResponse | null;
  if (!data || typeof data !== "object") return [];
  if (data.status !== "ready" || !data.url) {
    // Expected for servers that don't carry the title — not an error.
    return [];
  }

  const server = data.server || "spacedom";
  const container = containerFor(data.url, data.streamType);
  const languages = Array.isArray(data.languages)
    ? data.languages.filter((l) => typeof l === "string" && l.length > 0)
    : [];

  return [
    {
      // Ranker-unique id; several spacedom servers can serve the same title.
      id: `spacedom-${server}`,
      quality:
        data.quality && data.quality > 0
          ? `${data.quality}p`
          : container === "hls"
            ? "Auto"
            : "Original",
      name: languages.length > 0 ? languages.slice(0, 2).join(" / ") : server,
      url: data.url,
      type: container,
      headers:
        data.playbackHeaders && typeof data.playbackHeaders === "object"
          ? { ...data.playbackHeaders }
          : undefined,
      _meta: {
        codec: container === "hls" ? "hls" : "unknown",
        audio: data.language || languages[0] || "unknown",
        source: server,
        isDownloadOnly: false,
        // Both mp4 files and HLS manifests play directly in the native player.
        isWebReady: true,
      },
    },
  ];
}

export function createSpacedomAdapter(): StreamSourceAdapter {
  return {
    id: "spacedom",
    parseResponse: (response) => parseSpacedomResponse(response),
  };
}

export const spacedomAdapter: StreamSourceAdapter = createSpacedomAdapter();
