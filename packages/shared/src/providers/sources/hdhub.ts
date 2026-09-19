/**
 * HDHub stream source adapter.
 *
 * Parses Stremio-style stream objects from the HDHub API
 * into the canonical StreamLink format.
 *
 * Extracted from apps/mobile/lib/directStreams.ts and apps/web/app/api/player/direct/route.ts
 * to eliminate the duplicated parsing logic across platforms.
 */
import type { StreamLink, StreamSourceAdapter } from "./types";

// ── Constants ──────────────────────────────────────────────────────

/** Files >= 20GB (or "10Gbps"/"Download Only" entries) are download-only. */
const DOWNLOAD_ONLY_SIZE_THRESHOLD = 20000000000;

// ── Parsing helpers ────────────────────────────────────────────────

/** Shape of a single stream entry in the HDHub (Stremio-style) response. */
interface HdHubStreamEntry {
  name?: string;
  description?: string;
  url?: string;
  behaviorHints?: { videoSize?: number };
}

/** Result of parsing one HDHub stream entry into selection metadata. */
export interface HdHubParsedEntry {
  quality: string;
  codec: string;
  audio: string;
  isDownloadOnly: boolean;
  isWebReady: boolean;
  size?: number;
  source: string;
}

/**
 * Strip params that force download instead of inline playback. Presigned
 * S3/R2 URLs are left untouched — deleting any query param breaks the SigV4
 * signature (HTTP 403 SignatureDoesNotMatch).
 */
export function cleanStreamUrl(url: string): string {
  try {
    if (url.includes("X-Amz-Algorithm") || url.includes("X-Amz-Signature"))
      return url;
    const urlObj = new URL(url);
    urlObj.searchParams.delete("response-content-disposition");
    urlObj.searchParams.delete("response-content-type");
    return urlObj.toString();
  } catch {
    return url;
  }
}

/** Extract source name from the stream name (e.g. "HdHub 1080p" → "HdHub"). */
export function extractSource(name: string): string {
  const firstLine = name.split("\n")[0] || "";
  const match = firstLine.match(/^(HdHub|4KHDHub|HdHub VM|VS Sunny)/i);
  return match ? match[1] : "Unknown";
}

export function parseStreamEntry(stream: HdHubStreamEntry): HdHubParsedEntry {
  const name = stream.name || "";
  const desc = stream.description || "";

  let quality = "Unknown";
  if (/2160[pP]|4K|UHD/i.test(desc + name)) quality = "2160p";
  else if (/1080[pP]/i.test(desc + name)) quality = "1080p";
  else if (/720[pP]/i.test(desc + name)) quality = "720p";
  else if (/480[pP]/i.test(desc + name)) quality = "480p";
  else if (/360[pP]/i.test(desc + name)) quality = "360p";

  let codec = "x264"; // default
  if (/HEVC|x265|H\.265/i.test(desc)) codec = "hevc";
  else if (/AV1|av01/i.test(desc)) codec = "av1";
  else if (/VP9|vp09/i.test(desc)) codec = "vp9";
  else if (/H\.264|avc1|x264/i.test(desc)) codec = "h264";

  let audio = "Unknown";
  if (/DTS-HD/i.test(desc)) audio = "DTS-HD";
  else if (/DTS/i.test(desc)) audio = "DTS";
  else if (/DDP5\.1|DDP 5\.1|AAC5\.1/i.test(desc)) audio = "Dolby Digital 5.1";
  else if (/AAC/i.test(desc)) audio = "AAC";

  const isDownloadOnly =
    /10Gbps|Download Only/i.test(name) ||
    (stream.behaviorHints?.videoSize ?? 0) >= DOWNLOAD_ONLY_SIZE_THRESHOLD;

  // Direct MP4s without download/redirect params stream inline; PixelDrain
  // URLs with ?download= and huge remuxes do not.
  const isWebReady =
    !!stream.url &&
    !isDownloadOnly &&
    /\.mp4(\?.*)?$/i.test(stream.url) &&
    !/[?&]download=/.test(stream.url);

  return {
    quality,
    codec,
    audio,
    isDownloadOnly,
    isWebReady,
    size: stream.behaviorHints?.videoSize,
    source: extractSource(name),
  };
}

/**
 * Compute playback priority (lower = tried first).
 *
 * On mobile: no Windows HEVC penalty — Android hardware-decodes HEVC.
 * When the native MKV extractor is absent, MKV files with complex seek
 * patterns get a heavy penalty so MP4/WebM alternatives are tried first.
 *
 * @param hasCustomMkvExtractor - whether the platform has the native MKV extractor
 */
export function computePriority(
  p: HdHubParsedEntry,
  rawDesc: string,
  hasCustomMkvExtractor = true,
): number {
  if (p.isDownloadOnly) return 100 + (p.size ?? 0) / 1000000000;
  // MKV without the native extractor: files with complex seek patterns will
  // fail to seek. Push below download-only so MP4/WebM alternatives win.
  if (!hasCustomMkvExtractor && /\.mkv\b/i.test(rawDesc)) return 200;
  if (p.isWebReady && p.codec === "h264") return 0;
  if (p.codec === "h264") return 10;
  if (p.codec === "hevc") return 20;
  if (p.codec === "av1" || p.codec === "vp9") return 30;
  return 40;
}

export function createHdHubAdapter(
  opts: {
    hasCustomMkvExtractor?: boolean;
  } = {},
): StreamSourceAdapter {
  const hasCustomMkvExtractor = opts.hasCustomMkvExtractor ?? true;

  return {
    id: "hdhub",
    parseResponse(response) {
      const raw = response as { streams?: HdHubStreamEntry[] } | null;
      const streams = Array.isArray(raw?.streams) ? raw.streams : [];

      const parsed = streams
        .filter((s) => !!s.url)
        .map((s) => ({ raw: s, parsed: parseStreamEntry(s) }));

      parsed.sort(
        (a, b) =>
          computePriority(
            a.parsed,
            a.raw.description || "",
            hasCustomMkvExtractor,
          ) -
          computePriority(
            b.parsed,
            b.raw.description || "",
            hasCustomMkvExtractor,
          ),
      );

      return parsed.map((s, idx): StreamLink => {
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
            ? `${(s.raw.behaviorHints.videoSize / 1000000000).toFixed(2)}GB`
            : undefined,
          url: cleanStreamUrl(s.raw.url || ""),
          type: desc.includes(".mkv") ? "mkv" : "mp4",
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
    },
    cleanUrl: cleanStreamUrl,
  };
}

/** Default HDHub adapter (assumes platform has MKV extractor). */
export const hdhubAdapter: StreamSourceAdapter = createHdHubAdapter();
