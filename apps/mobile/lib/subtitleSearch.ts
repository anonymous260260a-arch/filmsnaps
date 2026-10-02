/**
 * Subtitle search — Subdl + Wyzie through our server proxy.
 *
 * Search by TMDB ID (the app already has it for every title). The server
 * (apps/web /api/subtitles) tries Subdl first; when Subdl rate-limits,
 * errors, or finds nothing it falls back to Wyzie. If both providers are
 * rate-limited the proxy answers 429 and we surface plain "not found".
 * Subtitle FILE downloads (the URLs in the response) go straight to the
 * provider CDN — no key involved.
 *
 * Both API keys are ours, server-side only — users are never asked for a key
 * and none ships in the binary. Fallback for dev/un-deployed proxies: direct
 * Subdl with the bundled EXPO_PUBLIC_SUBL_API_KEY.
 */

import { File, Directory, Paths } from "expo-file-system";
import { getApiBaseUrl } from "./api";

const API_URL = "https://api.subdl.com/api/v1/subtitles";
const DL_BASE = "https://dl.subdl.com";

export interface OnlineSubtitle {
  /** Stable id for list keys: subs url + file id. */
  id: string;
  releaseName: string;
  /** Language display name as returned by Subdl ("English", "Farsi/Persian", …). */
  language: string;
  url: string;
  /** "srt" | "ass" | "ssa" | "vtt" (lowercased). */
  format: string;
  size?: number;
  /** Hearing-impaired flag. */
  hi?: boolean;
}

export interface SubtitleSearchQuery {
  tmdbId: number;
  mediaType: "movie" | "tv";
  season?: number;
  episode?: number;
}

/** Dev-only fallback: bundled key from env (never required in production). */
export function getBundledSubdlKey(): string | null {
  const fromEnv = process.env.EXPO_PUBLIC_SUBL_API_KEY;
  return fromEnv && fromEnv.trim().length > 0 ? fromEnv.trim() : null;
}

const SUPPORTED_FORMATS = new Set(["srt", "ass", "ssa", "vtt", "sub"]);

function absoluteUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${DL_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Map the response to flat per-file subtitle entries, media3-decodable only. */
function toOnlineSubtitles(payload: any): OnlineSubtitle[] {
  const out: OnlineSubtitle[] = [];
  const seen = new Set<string>();
  for (const sub of payload?.subtitles ?? []) {
    const packUrl: string | undefined = sub?.url;
    const files: any[] = Array.isArray(sub?.unpack_files)
      ? sub.unpack_files
      : [];

    if (files.length > 0) {
      for (const file of files) {
        const format = String(file?.format ?? "").toLowerCase();
        if (!SUPPORTED_FORMATS.has(format)) continue;
        const url = file?.url ? absoluteUrl(String(file.url)) : null;
        if (!url) continue;
        const id = url;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          id,
          releaseName: String(
            file?.release_name || sub?.release_name || sub?.name || "Subtitle",
          ),
          language: String(file?.language || "Unknown"),
          url,
          format,
          size: typeof file?.size === "number" ? file.size : undefined,
          hi: !!file?.hi,
        });
      }
      continue;
    }

    // Legacy entries without unpack data: only take direct subtitle files,
    // skip zip packs (we deliberately avoid an unzip dependency).
    if (!packUrl) continue;
    const match = packUrl
      .split("?")[0]
      .toLowerCase()
      .match(/\.([a-z0-9]+)$/);
    const format = match?.[1] ?? "";
    if (!SUPPORTED_FORMATS.has(format)) continue;
    const url = absoluteUrl(packUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      id: url,
      releaseName: String(sub?.release_name || sub?.name || "Subtitle"),
      language: String(sub?.language || "Unknown"),
      url,
      format,
    });
  }
  return sortSubtitles(out);
}

function sortSubtitles(list: OnlineSubtitle[]): OnlineSubtitle[] {
  const deviceLang = Intl.DateTimeFormat()
    .resolvedOptions()
    .locale.slice(0, 2)
    .toLowerCase();
  const rank = (s: OnlineSubtitle): number => {
    const lang = s.language.toLowerCase();
    if (lang.startsWith(deviceLang)) return 0;
    if (lang.startsWith("english")) return 1;
    return 2;
  };
  return [...list].sort(
    (a, b) => rank(a) - rank(b) || a.language.localeCompare(b.language),
  );
}

function buildQuery(query: SubtitleSearchQuery): URLSearchParams {
  const q = new URLSearchParams({
    tmdb_id: String(query.tmdbId),
    type: query.mediaType,
  });
  if (query.mediaType === "tv") {
    if (query.season != null) q.set("season_number", String(query.season));
    if (query.episode != null) q.set("episode_number", String(query.episode));
  }
  return q;
}

/** Map the proxy's normalized entries to OnlineSubtitle (server deduped/sorted later here). */
function fromProxyEntries(payload: any): OnlineSubtitle[] {
  const out: OnlineSubtitle[] = [];
  const seen = new Set<string>();
  for (const e of payload?.subtitles ?? []) {
    const url = typeof e?.url === "string" ? e.url : "";
    const format = String(e?.format ?? "").toLowerCase();
    if (!url || !SUPPORTED_FORMATS.has(format) || seen.has(url)) continue;
    seen.add(url);
    out.push({
      id: url,
      releaseName: String(e?.releaseName || "Subtitle"),
      language: String(e?.language || "Unknown"),
      url,
      format,
      hi: !!e?.hi,
    });
  }
  return sortSubtitles(out);
}

/**
 * Primary path: our server proxy (apps/web /api/subtitles) holds both
 * provider keys and runs the Subdl→Wyzie fallback chain. Returns null when
 * the proxy is unavailable (route not deployed yet, dev server, or server
 * missing its keys) so the caller can fall back; returns [] when the chain
 * was exhausted (rate limits, nothing found) — shown as "not found".
 */
async function searchViaProxy(
  q: URLSearchParams,
): Promise<OnlineSubtitle[] | null> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/subtitles?${q.toString()}`);
    if (res.status === 404 || res.status === 410) return null;
    if (res.status === 429) return []; // both providers rate-limited → "not found"
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (/not configured/i.test(body)) return null;
      throw new Error(`SUBDL_HTTP_${res.status}`);
    }
    const body = await res.text();
    if (/not configured/i.test(body)) return null;
    return fromProxyEntries(JSON.parse(body));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("SUBDL_")) throw e;
    // Network failure / bad JSON — proxy unreachable, allow fallback.
    return null;
  }
}

export async function searchSubtitles(
  query: SubtitleSearchQuery,
): Promise<OnlineSubtitle[]> {
  const q = buildQuery(query);

  const viaProxy = await searchViaProxy(q);
  if (viaProxy) return viaProxy;

  // Fallback: direct Subdl with the bundled dev key.
  const key = getBundledSubdlKey();
  if (!key) throw new Error("NO_API_KEY");
  const direct = new URLSearchParams(q);
  direct.set("api_key", key);
  direct.set("unpack", "1");
  direct.set("subs_per_page", "30");
  const res = await fetch(`${API_URL}?${direct.toString()}`);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403)
      throw new Error("NOT_AUTHORIZED");
    throw new Error(`SUBDL_HTTP_${res.status}`);
  }
  const payload = await res.json();
  if (payload?.status === false) {
    const msg = String(payload?.error ?? payload?.message ?? "");
    if (msg.includes("authoriz") || msg.includes("api_key"))
      throw new Error("NOT_AUTHORIZED");
    throw new Error(`SUBDL_${msg || "ERROR"}`);
  }
  return toOnlineSubtitles(payload);
}

function mimeTypeFor(format: string): string {
  switch (format) {
    case "ass":
    case "ssa":
      return "text/x-ssa";
    case "vtt":
      return "text/vtt";
    default:
      return "application/x-subrip";
  }
}

export interface DownloadedSubtitle {
  uri: string;
  mimeType: string;
  language: string;
  label: string;
}

// Mirrors lib/download/fsCompat: Paths.cache can be null on some Android
// configs — fall back to the document dir rather than a relative "subtitles/".
const cacheBase = Paths.cache?.uri ?? Paths.document?.uri ?? "";
const subtitleDirUri = `${cacheBase}${cacheBase.endsWith("/") ? "" : "/"}subtitles/`;

/**
 * Validate a subtitle file on disk. Returns a reason when the file is
 * unusable (error page, binary junk, empty), null when it looks like a
 * real subtitle.
 *
 * Checks BOTH ends of the file: error pages are sniffed at the head, and
 * truncation (a cut-off download, e.g. the network dying mid-transfer)
 * is caught by inspecting the tail — SRT/VTT cues always end with text;
 * a file ending in "00:0" or a lone "-->" line was truncated.
 */
export function validateSubtitleFile(
  headText: string,
  tailText: string,
): string | null {
  const head = headText.slice(0, 200).toLowerCase();
  if (
    head.includes("<!doctype html") ||
    head.includes("<html") ||
    head.includes('{"error"') ||
    head.includes('{"status":false')
  ) {
    return "DOWNLOAD_NOT_SUBTITLE";
  }
  // HTML pages with a late doctype, XML error responses, zip/binary payloads.
  if (
    headText.trimStart().startsWith("<?xml") ||
    head.startsWith("pk\u0003\u0004") ||
    head.startsWith("\u0000\u0000")
  ) {
    return "DOWNLOAD_NOT_SUBTITLE";
  }
  // SRT/VTT structure sanity: cues are numbered or carry a timestamp line.
  const looksLikeSub =
    /(^|\n)\d+\s*\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(headText) ||
    (head.startsWith("webvtt") && headText.includes("-->")) ||
    /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(headText);
  if (!looksLikeSub) return "DOWNLOAD_NOT_SUBTITLE";
  // Truncation: a complete SRT/VTT ends with subtitle text, never with a
  // dangling index/timestamp line. (Order matters: run BEFORE serving cache.)
  const tail = tailText.replace(/\s+$/, "");
  if (
    tail.length > 0 &&
    (/^\d+$/.test(tail.split("\n").pop() ?? "") ||
      /-->\s*$/.test(tail) ||
      /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*$/.test(tail))
  ) {
    return "DOWNLOAD_TRUNCATED";
  }
  return null;
}

/** Download an online subtitle into the app cache, with validation. */
export async function downloadSubtitle(
  sub: OnlineSubtitle,
  cacheKey: string,
): Promise<DownloadedSubtitle> {
  const safeKey = cacheKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(-80);
  const dir = new Directory(subtitleDirUri);
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `${safeKey}.${sub.format}`);
  const label = sub.language.replace(/^./, (c) => c.toUpperCase());
  const result: DownloadedSubtitle = {
    uri: dest.uri,
    mimeType: mimeTypeFor(sub.format),
    language: label,
    // Shown as the track's secondary line in the subtitle sheet — the release
    // name is what tells two online files apart.
    label: `Online · ${sub.releaseName.slice(0, 48)}`,
  };
  // Cache hit — but a hit is only trusted after validation. The previous
  // "exists && size > 0 → reuse" logic poisoned the cache for good when a
  // provider returned an HTML error page or the download was cut off
  // (reported as "some subtitle downloads throw" / "retry same file works":
  // the poisoned file kept failing until another provider attempt overwrote
  // it, while a different key downloaded fine).
  if (dest.exists && dest.size > 0) {
    const bad = await validateSubtitleOnDisk(dest);
    if (bad === null) return result;
    // Poisoned cache entry: delete and fall through to a fresh download.
    try {
      dest.delete();
    } catch {}
  }
  // idempotent: re-tapping the same subtitle must overwrite, not throw
  // (SDK 55 downloadFileAsync throws "file exists" by default).
  const downloaded = await File.downloadFileAsync(sub.url, dest, {
    idempotent: true,
  });
  if (!downloaded.exists || downloaded.size === 0) {
    throw new Error("DOWNLOAD_EMPTY");
  }
  // Validate head + tail (error-page sniff + truncation catch).
  const bad = await validateSubtitleOnDisk(dest);
  if (bad !== null) {
    // Delete the bad file so the poisoned-cache bug can never recur.
    try {
      dest.delete();
    } catch {}
    throw new Error(bad);
  }
  return result;
}

/**
 * Validate a downloaded subtitle file on disk. Subtitle files are small text
 * payloads (< 1 MB in practice) so one full read covers both the error-page
 * head sniff and the truncation tail sniff.
 */
async function validateSubtitleOnDisk(file: File): Promise<string | null> {
  try {
    const text = await file.text();
    return validateSubtitleFile(text.slice(0, 2000), text.slice(-300));
  } catch {
    // Unreadable file (binary junk, deleted mid-read) — unusable.
    return "DOWNLOAD_NOT_SUBTITLE";
  }
}

export async function clearDownloadedSubtitles(): Promise<void> {
  try {
    const dir = new Directory(subtitleDirUri);
    if (dir.exists) dir.delete();
  } catch {}
}
