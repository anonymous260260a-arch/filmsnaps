/**
 * HEVC detection utilities for video format identification.
 */

/**
 * Check if a URL points to an HEVC-encoded video file.
 * Detects from filename patterns like x265, HEVC, h265, 10bit.
 */
export function isHevcUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const lower = url.toLowerCase();
  return /x265|h\.?265|hevc|10bit/i.test(lower);
}

/**
 * Check if a URL is a direct video file (not HLS/DASH stream).
 * Direct files: .mp4, .mkv, .webm, .avi, .mov
 * Streams: .m3u8 (HLS), .mpd (DASH)
 */
export function isDirectVideoUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const lower = url.toLowerCase();

  // Exclude streaming formats
  if (lower.includes(".m3u8") || lower.includes(".mpd")) return false;

  // Check for direct video extensions
  return /\.(mp4|mkv|webm|avi|mov|m4v|flv|wmv)(\?|$)/i.test(lower);
}

/**
 * Get the video format from a URL.
 */
export function getVideoFormat(
  url: string,
): "hevc" | "h264" | "hls" | "dash" | "unknown" {
  if (!url || typeof url !== "string") return "unknown";
  const lower = url.toLowerCase();

  if (lower.includes(".m3u8")) return "hls";
  if (lower.includes(".mpd")) return "dash";
  if (/x265|h\.?265|hevc|10bit/i.test(lower)) return "hevc";
  if (/x264|h\.?264|avc/i.test(lower)) return "h264";

  // Check by extension
  if (/\.(mp4|mkv|webm|avi|mov)(\?|$)/i.test(lower)) return "h264"; // default to h264 for direct files

  return "unknown";
}

/**
 * Get a human-readable format label for display.
 */
export function getFormatLabel(url: string): string {
  const format = getVideoFormat(url);
  switch (format) {
    case "hevc":
      return "HEVC (H.265)";
    case "h264":
      return "H.264";
    case "hls":
      return "HLS Stream";
    case "dash":
      return "DASH Stream";
    default:
      return "Video";
  }
}

/**
 * Check if a URL is from the Falix provider.
 */
export function isFalixUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  return url.includes("falix") || url.includes("falixmovies");
}
