/**
 * Download error classification — permanent vs transient.
 *
 * The native service reports errors as plain strings ("HTTP 403",
 * "Download interrupted: …", "No space left on device"). Retrying every
 * failure three times was wrong for two classes:
 *
 *   - Expired / dead upstream links (403/404/410/451): retrying cannot help,
 *     and the user must go back and pick another stream. Fail immediately.
 *   - Disk full (ENOSPC): retrying into a full disk just burns the retry
 *     budget. Fail immediately with a "free up space" message.
 *
 * Everything else (timeouts, interrupted streams, 5xx, 408/429) stays
 * transient and keeps the existing exponential backoff.
 *
 * Pure module — no React, no native imports — so it is unit-testable.
 */

export type DownloadErrorKind =
  | "expired" // link dead/expired — pick another stream
  | "storage" // disk full / storage unavailable
  | "http" // other HTTP status
  | "network" // timeouts, interrupted streams, DNS
  | "incomplete" // stream ended early
  | "unknown";

export interface ClassifiedDownloadError {
  kind: DownloadErrorKind;
  /** True → fail immediately, never auto-retry. */
  permanent: boolean;
  /** Human-facing, actionable message shown in toasts + notifications. */
  userMessage: string;
}

const PERMANENT_HTTP_STATUSES = new Set([403, 404, 410, 451]);

/** Pull an embedded HTTP status out of an error string ("HTTP 403", "status 502"). */
export function extractHttpStatus(message: string): number | null {
  const m = message.match(/\b(?:HTTP|status)\s*:?\s*(\d{3})\b/i);
  if (!m) return null;
  const code = Number(m[1]);
  return code >= 400 && code <= 599 ? code : null;
}

export function classifyDownloadError(raw: unknown): ClassifiedDownloadError {
  const message =
    raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";
  const lower = message.toLowerCase();

  // ── Disk full / storage unavailable ──
  // Android throws IOException("write failed: ENOSPC …") or
  // "No space left on device"; wording varies, so match broadly.
  if (
    /\benospc\b/.test(lower) ||
    /no space left/.test(lower) ||
    /out of (storage|space|disk)/.test(lower) ||
    /disk (full|quota)/.test(lower) ||
    /insufficient (storage|free) space/.test(lower)
  ) {
    return {
      kind: "storage",
      permanent: true,
      userMessage:
        "Your device ran out of storage during the download. Free up some space, then retry.",
    };
  }

  // ── Expired / dead upstream link ──
  const status = extractHttpStatus(message);
  if (status !== null) {
    if (PERMANENT_HTTP_STATUSES.has(status)) {
      return {
        kind: "expired",
        permanent: true,
        userMessage:
          "This download link has expired or is no longer available. Go back and pick another stream.",
      };
    }
    if (status >= 500 || status === 408 || status === 429) {
      return {
        kind: "http",
        permanent: false,
        userMessage: `Download server error (HTTP ${status}). We'll retry automatically.`,
      };
    }
    return {
      kind: "http",
      permanent: true,
      userMessage: `Download rejected by the server (HTTP ${status}). Go back and pick another stream.`,
    };
  }

  // ── Incomplete transfer (native F10 reports "Incomplete download: n/m bytes") ──
  if (/incomplete/.test(lower)) {
    return {
      kind: "incomplete",
      permanent: false,
      userMessage: "The download was cut off. We'll resume it automatically.",
    };
  }

  // ── Network-level failures ──
  if (
    /timed?\s?out|timeout/.test(lower) ||
    /network|connect|resolve|unreachable|interrupted|socket|ssl|econn/.test(
      lower,
    )
  ) {
    return {
      kind: "network",
      permanent: false,
      userMessage: "Network problem — we'll retry automatically.",
    };
  }

  return {
    kind: "unknown",
    permanent: false,
    userMessage:
      message || "Download failed. Try again or pick another stream.",
  };
}

/** Typed error thrown when the pre-enqueue space check (incl. queued bytes) fails. */
export class InsufficientSpaceError extends Error {
  readonly freeBytes: number;
  readonly neededBytes: number;

  constructor(freeBytes: number, neededBytes: number) {
    super("Insufficient storage space for this download.");
    this.name = "InsufficientSpaceError";
    this.freeBytes = freeBytes;
    this.neededBytes = neededBytes;
  }
}
