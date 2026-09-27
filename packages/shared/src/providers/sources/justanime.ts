/**
 * JustAnime stream source adapter.
 *
 * Parses the core.justanime.to /api/watch/{malId}/episode/{ep}/<server>
 * response into StreamLink[]. ONE request per audio track (sub/dub):
 *
 *   {
 *     "sub": { "sources": [{ "url", "quality", "isM3U8", "sig" }],
 *              "subtitles": [{ "file", "label", "kind", "default", "sig" }],
 *              "intro": [s,e], "outro": [s,e],
 *              "headers": { "Referer": "https://megaplay.buzz/" } },
 *     "dub": { … },
 *     "exp": false
 *   }
 *
 * Server quirks verified:
 *   - megaplay: one "auto" HLS per track + vtt subtitle sidecars; the master
 *     playlist has NO embedded EXT-X-MEDIA tracks, so captions must be
 *     attached as external .vtt (the player downloads them via link.headers).
 *   - zokoanime: HLS + vtt, headers Referer https://zokoanime.video/.
 *   - animegg: 4 direct mp4s (360p-1080p), per-source Referer
 *     https://www.animegg.org/, no subtitles.
 * The API request itself requires Referer/Origin https://justanime.to
 * (configured on the provider's streamSources entries, not here).
 */
import type { StreamLink, StreamSourceAdapter } from "./types";

type JustAnimeSource = {
  url: string;
  quality?: string;
  isM3U8?: boolean;
  sig?: string;
  /** Per-source request headers (animegg puts its Referer on each source). */
  headers?: Record<string, string>;
};

type JustAnimeSubtitle = {
  file: string;
  label?: string;
  kind?: string;
  default?: boolean;
  sig?: string;
};

type JustAnimeTrack = {
  sources?: JustAnimeSource[];
  subtitles?: JustAnimeSubtitle[];
  headers?: Record<string, string>;
  // intro/outro come back as [start, end] tuples on the megaplay track.
  intro?: [number, number];
  outro?: [number, number];
};

interface JustAnimeResponse {
  sub?: JustAnimeTrack;
  dub?: JustAnimeTrack;
  exp?: boolean;
}

/** Server name from the source id (e.g. "justanime-megaplay" → "megaplay"). */
function serverFromSourceId(sourceId: string): string {
  const m = sourceId.match(/justanime-([a-z0-9]+)/);
  return m ? m[1] : "unknown";
}

/** Normalize an upstream quality token to a display label. */
function qualityLabel(q: string | undefined): string {
  const norm = (q ?? "").trim().toLowerCase();
  if (!norm || norm === "auto") return "auto";
  return norm.includes("p") ? norm : `${norm}p`;
}

/** Container from the manifest flag / URL — hls wins (m3u8 list of parts). */
function containerFor(source: JustAnimeSource): string {
  if (source.isM3U8) return "hls";
  return /\.(mp4|mkv|webm)(\?|$)/i.test(source.url) ? "mp4" : "hls";
}

/**
 * Parse one track (sub or dub) into StreamLink[]. Every link of the set
 * carries the set's subtitle sidecars so the player can auto-attach the
 * `default`-flagged captions regardless of which quality is picked.
 */
function parseTrack(
  track: JustAnimeTrack | undefined,
  audio: "sub" | "dub",
  sourceId: string,
): StreamLink[] {
  if (!track || !Array.isArray(track.sources) || track.sources.length === 0) {
    return [];
  }
  const audioLabel = audio === "dub" ? "Dubbed" : "Subbed";
  const subtitles =
    Array.isArray(track.subtitles) && track.subtitles.length > 0
      ? track.subtitles
          .filter((s) => s && s.file)
          .map((s) => ({
            lang: s.label || (s.kind === "captions" ? "English" : "Unknown"),
            url: s.file,
            ...(s.default === true ? { default: true as const } : {}),
          }))
      : undefined;

  return track.sources.map((source, idx) => {
    const container = containerFor(source);
    const quality = qualityLabel(source.quality);
    return {
      id: `${sourceId}-${audio}-${idx}`,
      quality,
      name: `${quality} · ${audioLabel}`,
      url: source.url,
      type: container === "hls" ? "hls" : "mp4",
      // Per-source headers win over the track-level headers (animegg puts
      // its Referer on each source; megaplay/zokoanime on the whole track).
      headers: { ...(track.headers ?? {}), ...(source.headers ?? {}) },
      _meta: {
        codec: container === "hls" ? "hls" : "unknown",
        audio,
        source: sourceId,
        isDownloadOnly: false,
        isWebReady: true,
        // Upstream intro/outro are per-episode, not per-source — every link of
        // the set carries them so the native skip button works regardless of
        // which quality is picked.
        ...(track.intro ? { intro: track.intro } : {}),
        ...(track.outro ? { outro: track.outro } : {}),
        ...(subtitles ? { subtitles } : {}),
      },
    } as StreamLink & {
      _meta: StreamLink["_meta"] & {
        subtitles?: { lang: string; url: string; default?: boolean }[];
      };
    };
  });
}

/** Parse a full JustAnime response (sub + dub tracks) into StreamLink[]. */
export function parseJustAnimeResponse(
  response: unknown,
  sourceId: string,
): StreamLink[] {
  const data = response as JustAnimeResponse | null;
  if (!data || typeof data !== "object") return [];
  // Sub tracks lead the pool; dub follows. The mobile anime ranker re-orders
  // by the session's audio preference anyway.
  return [
    ...parseTrack(data.sub, "sub", sourceId),
    ...parseTrack(data.dub, "dub", sourceId),
  ];
}

export function createJustAnimeAdapter(): StreamSourceAdapter {
  return {
    id: "justanime",
    parseResponse: (response, params) =>
      parseJustAnimeResponse(response, params.sourceId ?? "justanime"),
  };
}

export const justanimeAdapter: StreamSourceAdapter = createJustAnimeAdapter();
