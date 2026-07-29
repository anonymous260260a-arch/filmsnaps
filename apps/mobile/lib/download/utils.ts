/**
 * Download System — Shared Utilities
 *
 * Single source of truth for:
 * - toSafeNumber() — RNFB bridge value coercion (Android sends strings)
 * - sanitizeResumeData() — corrupted byte-offset prevention
 * - Path construction — consistent across all modules
 * - Byte formatting — human-readable file sizes
 *
 * IMPORTANT: Import from here instead of defining duplicates in manager.ts.
 * These are the canonical implementations.
 */

let _RNFB: any = null;
function getRNFB(): any {
  if (_RNFB) return _RNFB;
  try {
    const mod = require("react-native-blob-util");
    _RNFB = mod?.default ?? mod;
  } catch {}
  return _RNFB;
}

// ── Number Coercion ──

/**
 * Safely coerce RNFB bridge values to numbers.
 * On Android, react-native-blob-util passes ALL numeric values as strings
 * through the native-to-JS bridge. Without this:
 *   - "+" concatenates: 100 + "200" → "100200"
 *   - "<" compares lexicographically: "9" < "10" → false
 *   - Accumulated errors cause NaN propagation → crash
 */
export function toSafeNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return fallback;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

// ── Resume Data ──

/**
 * Validate and normalize resumeData to prevent corrupted values.
 * Always returns a clean numeric string or null.
 *
 * Guards against:
 *   - String concatenation artifacts ("95236469603970")
 *   - Negative values
 *   - Values > 50GB (sanity cap)
 *   - Non-numeric garbage
 */
export function sanitizeResumeData(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value);
  if (!/^\d+$/.test(str)) return null;
  const num = parseInt(str, 10);
  if (!Number.isFinite(num) || num <= 0) return null;
  if (num > 50 * 1024 * 1024 * 1024) return null; // 50GB sanity cap
  return String(num);
}

// ── File Path Construction ──

/**
 * Get the base downloads directory.
 * Returns: {DownloadDir}/Filmsnaps (no trailing slash — consistent everywhere)
 */
export function getDownloadsDir(): string {
  const rnfb = getRNFB();
  if (!rnfb?.fs?.dirs) {
    throw new Error(
      "react-native-blob-util not available for path construction",
    );
  }
  const base =
    rnfb.fs.dirs.DownloadDir ??
    rnfb.fs.dirs.DocumentDir ??
    rnfb.fs.dirs.CacheDir;
  return `${base}/Filmsnaps`;
}

/**
 * Sanitize a file name by removing illegal path characters.
 */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 200);
}

/**
 * Build a full file path for a download task.
 * Returns: {DownloadsDir}/Filmsnaps/{safeName}.{ext}
 */
export function buildFilePath(task: {
  fileName: string;
  extension?: string;
}): string {
  const dir = getDownloadsDir();
  let name = task.fileName || "download";
  const ext = (task.extension ?? "mp4").replace(/^\./, "");

  if (!name.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
    name = `${name}.${ext}`;
  }

  const safeName = sanitizeFileName(name);
  return `${dir}/${safeName}`;
}

// ── Byte Formatting ──

/**
 * Format bytes to a human-readable string.
 * Examples: "0 B", "1.5 KB", "23 MB", "1.2 GB"
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}
