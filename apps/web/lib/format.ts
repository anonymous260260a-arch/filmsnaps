/**
 * Format helpers shared by the Download Manager + progress UI.
 * Ported from mobile's apps/mobile/lib/download/format.ts.
 */

/** Human-readable byte count (B / KB / MB / GB). */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / Math.pow(1024, i);
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** Transfer speed (bytes/sec) → "X MB/s". */
export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return "—";
  return `${formatBytes(bytesPerSec)}/s`;
}

/** Seconds → "1h 02m" / "03m 04s" / "12s". */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Epoch ms → locale date string (short). */
export function formatDate(ts: number): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

/** Estimated time remaining for a download, given bytes + speed. */
export function formatEta(remainingBytes: number, bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return "—";
  return formatDuration(Math.round(remainingBytes / bytesPerSec));
}
