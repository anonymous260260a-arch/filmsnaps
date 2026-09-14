/**
 * probeStream — lightweight stream health check for desktop.
 *
 * Uses fetch with Range header to check if a URL returns valid video bytes.
 * Much simpler than mobile's ExpoVideo.probeStream — just classifies URLs
 * as valid/dead/unknown based on HTTP response.
 */

export type ProbeOutcome = "valid" | "dead" | "unknown";

const PROBE_TIMEOUT_MS = 7000;
const MAX_CONCURRENCY = 5;

/**
 * Probe a single URL. Returns "valid" if it serves video bytes,
 * "dead" if blocked/expired, "unknown" on timeout/error.
 */
export async function probeStream(
  url: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<ProbeOutcome> {
  if (!url) return "unknown";

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Range: "bytes=0-8191",
        Accept: "*/*",
        "Accept-Encoding": "identity",
        Referer: "https://google.com/",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    // Non-retryable failures
    if (res.status === 403 || res.status === 404 || res.status === 410) {
      return "dead";
    }

    // 429 rate limit — not dead, just temporarily blocked
    if (res.status === 429) return "unknown";

    // 200/206 with body = likely valid
    if (res.status === 200 || res.status === 206) {
      const contentLength = Number(res.headers.get("content-length") ?? 0);
      // Read a small chunk to verify it's video, not an error page
      const reader = res.body?.getReader();
      if (reader) {
        const { value } = await reader.read();
        reader.cancel();
        if (value && value.length > 0) {
          // Check for HTML error pages
          const text = new TextDecoder().decode(value.slice(0, 256));
          if (
            text.includes("<!doctype") ||
            text.includes("<html") ||
            text.includes("<error")
          ) {
            return "dead";
          }
          return "valid";
        }
      }
      // No body reader but got 200/206 — treat as valid
      if (contentLength === 0) return "valid";
      return "valid";
    }

    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Probe all links in parallel with concurrency limit.
 * Calls onProgress for each completed probe.
 */
export async function probeAllLinks(
  urls: string[],
  onProgress: (index: number, outcome: ProbeOutcome) => void,
): Promise<void> {
  const queue = urls.map((url, i) => ({ url, index: i }));
  const running: Promise<void>[] = [];

  async function runNext(): Promise<void> {
    const item = queue.shift();
    if (!item) return;
    const outcome = await probeStream(item.url);
    onProgress(item.index, outcome);
    await runNext();
  }

  // Start up to MAX_CONCURRENCY probes
  for (let i = 0; i < Math.min(MAX_CONCURRENCY, queue.length); i++) {
    running.push(runNext());
  }

  await Promise.allSettled(running);
}

/**
 * Parse language tags from a stream filename/name.
 * Matches common patterns: HIN, HINDI, ENG, ENGLISH, MULTI, DUAL, etc.
 */
export type LinkLanguage = "hindi" | "english" | "multi" | "unknown";

export function parseLinkLanguage(name: string): LinkLanguage {
  const lower = name.toLowerCase();
  if (/multi|dual[\s\-]?audio|multi[\s\-]?audio/i.test(lower)) return "multi";
  if (/\bhin\b|hindi/i.test(lower)) return "hindi";
  if (/\beng\b|english/i.test(lower)) return "english";
  return "unknown";
}

/**
 * Get display label for a link's language.
 */
export function languageLabel(lang: LinkLanguage): string {
  switch (lang) {
    case "hindi":
      return "Hindi";
    case "english":
      return "English";
    case "multi":
      return "Multi";
    default:
      return "";
  }
}

/**
 * Compact language label for the source pill (e.g. "Hindi · Multi").
 */
export function compactLanguageLabel(name: string): string {
  const langs = new Set<LinkLanguage>();
  // Split on common separators and check each part
  const parts = name.split(/[\s\.\-\|\/]+/);
  for (const part of parts) {
    const lang = parseLinkLanguage(part);
    if (lang !== "unknown") langs.add(lang);
  }
  const ordered = ["hindi", "english", "multi"] as const;
  const present = ordered.filter((l) => langs.has(l));
  return present.map(languageLabel).join(" · ") || "Default";
}

/**
 * Format bytes to human-readable size.
 */
export function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/**
 * Humanize error messages for the error card.
 */
export function humanizeError(error?: string | null): string {
  if (!error) return "Stream failed to load";
  const lower = error.toLowerCase();
  if (lower.includes("403") || lower.includes("refusing"))
    return "This source is refusing connections";
  if (lower.includes("404") || lower.includes("not found"))
    return "This file is gone";
  if (lower.includes("410") || lower.includes("expired"))
    return "This source expired";
  if (lower.includes("timeout") || lower.includes("slow"))
    return "This source is too slow";
  if (lower.includes("network") || lower.includes("connect"))
    return "Connection failed";
  if (lower.includes("format") || lower.includes("codec"))
    return "This format isn't supported";
  // Player-engine failures (mpv dead / IPC not connected) — the SOURCE is not
  // at fault, so don't tell the user it was.
  if (
    lower.includes("not started") ||
    lower.includes("not connected") ||
    lower.includes("process exited") ||
    lower.includes("exited before") ||
    lower.includes("could not be cloned")
  )
    return "The video engine hiccupped — try again";
  return "Stream failed to load";
}
