/**
 * Falix stream source adapter.
 *
 * Parses the Falix Telegram file catalog into canonical StreamLink[].
 * Handles both direct API responses and worker-proxied responses.
 *
 * Extracted from apps/mobile/lib/directStreams.ts to eliminate
 * duplicated Falix parsing logic across platforms.
 */
import { FALIX_API_BASE, parseSizeToBytes } from "../../utils/falix";
import type { StreamLink, StreamSourceAdapter } from "./types";

// ── Parsing helpers ────────────────────────────────────────────────

/** Shape of a Falix telegram file entry. */
export interface FalixFile {
  id?: string;
  name?: string;
  size?: string;
  quality?: string;
}

/** New-style file entry: `sources[].encoded_id` is the /dl id. */
export interface FalixFileEntry {
  id?: string;
  quality?: string;
  filename?: string;
  size?: string;
  season?: number;
  episode?: number;
  sources?: Array<{
    id?: string;
    type?: string;
    encoded_id?: string;
    is_primary?: boolean;
  }>;
}

interface FalixEpisode {
  episode_number?: number;
  telegram?: FalixFile[];
  files?: FalixFileEntry[];
}

/** Shape of the Falix API response (movie or TV). */
export interface FalixData {
  title?: string;
  telegram?: FalixFile[];
  files?: FalixFileEntry[];
  seasons?: Array<{
    season_number?: number;
    episodes?: FalixEpisode[];
  }>;
  /** Season-scoped response (?season_number=): episodes at the top level. */
  episodes?: FalixEpisode[];
  /** Caller-injected base for building /dl URLs (worker proxy or direct host). */
  _dlBase?: string;
}

/** New `files[]` entries → FalixFile (one per source; encoded_id = /dl id). */
function filesToFalixFiles(files?: FalixFileEntry[]): FalixFile[] {
  if (!Array.isArray(files)) return [];
  const out: FalixFile[] = [];
  for (const f of files) {
    if (!f?.filename) continue;
    for (const s of f.sources ?? []) {
      if (s?.encoded_id) {
        out.push({
          id: s.encoded_id,
          name: f.filename,
          size: f.size,
          quality: f.quality,
        });
      }
    }
  }
  return out;
}

/** Parse human-readable size string to bytes. E.g. "8.2 GB" → 8804682957 */
export function parseFalixSize(sizeStr: string | undefined): number {
  return Math.round(parseSizeToBytes(sizeStr));
}

/** Detect video codec from release name. */
export function parseFalixCodec(name: string): string {
  if (/x265|HEVC|H\.265|x266/i.test(name)) return "hevc";
  if (/AV1|av01/i.test(name)) return "av1";
  if (/x264|H\.264|AVC/i.test(name)) return "h264";
  return "h264";
}

/** Detect audio codec from release name. */
export function parseFalixAudio(name: string): string {
  if (/DTS-HD/i.test(name)) return "DTS-HD";
  if (/DTS/i.test(name)) return "DTS";
  if (/DDP|E-?AC-?3|Dolby Digital Plus/i.test(name)) return "Dolby Digital 5.1";
  if (/DD\b|AC-?3/i.test(name)) return "Dolby Digital 5.1";
  if (/AAC/i.test(name)) return "AAC";
  return "Unknown";
}

/** Map Falix Telegram files to StreamLink[]. */
export function mapFalixFiles(
  files: FalixFile[],
  title: string,
  dlBase: string,
): StreamLink[] {
  return files
    .filter((f) => !!f.id && !!f.name)
    .map((f, i): StreamLink => {
      const sizeBytes = parseFalixSize(f.size);
      const ext = f.name?.split(".").pop()?.toLowerCase() ?? "mp4";
      return {
        quality: f.quality || "Unknown",
        name: `[Falix] ${title} — ${f.name}`,
        id: `falix-${i}`,
        size: f.size || undefined,
        // dlBase is either the falix host itself or the worker stream proxy
        // (see fetchFalixLinks) — both end in /dl.
        url: `${dlBase}/${f.id}/${encodeURIComponent(f.name!)}`,
        type: ext === "mkv" ? "mkv" : "mp4",
        _meta: {
          codec: parseFalixCodec(f.name!),
          audio: parseFalixAudio(f.name!),
          source: "Falix",
          isDownloadOnly: false,
          isWebReady: false,
          sizeBytes,
        },
      };
    });
}

/**
 * Extract the files for a specific episode/title from a Falix response.
 *
 * Handles every shape the API serves:
 *  - full TV response:      seasons[] → episodes[] (telegram[] + files[])
 *  - season-scoped response: episodes[] at the top level (?season_number=)
 *  - movie:                  top-level telegram[] / files[]
 *
 * `telegram[]` (legacy entries) and `files[]` (sources[].encoded_id) hold the
 * same /dl ids — merged and deduped so either (or both) work. Returns [] when
 * the season/episode is not found.
 */
export function extractEpisodeFiles(
  data: FalixData,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): FalixFile[] {
  const collect = (src?: FalixEpisode): FalixFile[] => {
    if (!src) return [];
    const merged = [...(src.telegram ?? []), ...filesToFalixFiles(src.files)];
    const seen = new Set<string>();
    return merged.filter(
      (f) => !!f.id && !!f.name && !seen.has(f.id) && (seen.add(f.id), true),
    );
  };

  if (mediaType === "tv" && season != null && episode != null) {
    const episodes =
      data.seasons?.find((s) => s.season_number === season)?.episodes ??
      data.episodes;
    return collect(episodes?.find((e) => e.episode_number === episode));
  }
  return collect(data);
}

export function createFalixAdapter(
  opts: {
    fallbackUrlBuilder?: (id: string) => string;
  } = {},
): StreamSourceAdapter {
  return {
    id: "falix",
    parseResponse(response, params) {
      const data = response as FalixData | null;
      if (!data) return [];

      const title = data.title || "Unknown";
      const files = extractEpisodeFiles(
        data,
        params.mediaType,
        params.season,
        params.episode,
      );
      if (files.length === 0) return [];

      // dlBase is provided by the caller via the adapter's context,
      // or falls back to the default falix host.
      // In practice, the resolveStreams pipeline provides this.
      return mapFalixFiles(
        files,
        title,
        `${data._dlBase || FALIX_API_BASE}/dl`,
      );
    },
    fallbackUrl: opts.fallbackUrlBuilder,
  };
}

/** Default Falix adapter. */
export const falixAdapter: StreamSourceAdapter = createFalixAdapter();
