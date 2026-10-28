/**
 * JustAnime subtitle sidecar downloads.
 *
 * JustAnime's vtt files are Referer-gated (verified 403 without one), but the
 * player's addExternalSubtitle only takes a file:// uri — no headers. So the
 * vtt is fetched here WITH its link headers and written into the app cache
 * (expo-file-system File.write — the subtitle-sync pattern), then converted
 * to srt and handed to the player as a local file.
 *
 * The vtt→srt conversion is load-bearing (see vttToSrt): media3 stamps every
 * auto-positioned WebVTT cue with a concrete line, which disables the
 * SubtitleView bottom padding the subtitle-position setting rides on. SRT
 * cues keep line unset, so anime obeys the setting exactly like movies.
 */
import { File, Directory, Paths } from "expo-file-system";
import { fetchWithTimeout } from "./streams";
import { parseSubtitles } from "../subtitleSync/parseSubtitles";
import { rewriteCues, mimeTypeForFormat } from "../subtitleSync/applySync";

export interface AnimeSubtitleFile {
  uri: string;
  mimeType: string;
  language: string;
  label: string;
}

const cacheBase = Paths.cache?.uri ?? Paths.document?.uri ?? "";
const animeSubDirUri = `${cacheBase}${cacheBase.endsWith("/") ? "" : "/"}subtitles-anime/`;

function hashName(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = (Math.imul(h, 31) + url.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * Convert a WebVTT sidecar to srt. Needed because media3's WebVttSubtitle
 * assigns every cue with an unset line a concrete snap-to-lines value
 * (-1 - i, steps 4-10 of the WebVTT spec), and SubtitleView's
 * setBottomPaddingFraction only applies when Cue.line is DIMEN_UNSET — so a
 * vtt sidecar ignores the subtitle-position setting while an srt sidecar
 * (the movie path) obeys it. Parsing + rewrite also drops every cue
 * positioning setting (line/position/vertical) and re-serializes with the
 * BOM + CRLF shape the native srt reader requires.
 */
function vttToSrt(text: string): { srt: string; cues: number } | null {
  const cues = parseSubtitles(text, "vtt");
  if (cues.length === 0) return null;
  const cleaned = cues.map((c) => ({ ...c, text: stripVttMarkup(c.text) }));
  return { srt: rewriteCues(cleaned, 1, 0, "srt"), cues: cues.length };
}

/** VTT-only markup the srt path shouldn't see (voice/class/lang/timestamp tags). */
function stripVttMarkup(text: string): string {
  return text
    .replace(/<v[^>]*>/gi, "")
    .replace(/<\/v>/gi, "")
    .replace(/<c[^>]*>/gi, "")
    .replace(/<\/c>/gi, "")
    .replace(/<lang[^>]*>/gi, "")
    .replace(/<\/lang>/gi, "")
    .replace(/<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lrm;|&rlm;/gi, "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Download a JustAnime vtt (with Referer headers), convert it to srt, and
 * cache both under the URL hash. Reuses an existing download for the same
 * URL. Throws on network/HTTP errors; an error-page body (the vtt hosts
 * reply with HTML on bad signatures) is rejected so the player never
 * attaches garbage.
 */
export async function downloadAnimeSubtitle(
  url: string,
  headers: Record<string, string> | undefined,
  label: string,
): Promise<AnimeSubtitleFile> {
  const safeLabel = label
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .slice(0, 24);
  const dir = new Directory(animeSubDirUri);
  if (!dir.exists) dir.create({ intermediates: true });
  const vttFile = new File(dir, `ja-${hashName(url)}.vtt`);
  const srtFile = new File(dir, `ja-${hashName(url)}.srt`);
  if (srtFile.exists && srtFile.size > 0) return toResult(srtFile, safeLabel);

  let raw = vttFile.exists && vttFile.size > 0 ? vttFile.textSync() : "";
  if (!raw) {
    const res = await fetchWithTimeout(url, 10_000, {
      headers: { Accept: "text/vtt,*/*;q=0.8", ...(headers ?? {}) },
    });
    if (!res.ok) throw new Error(`subtitle HTTP ${res.status}`);
    raw = await res.text();
    if (
      raw.length === 0 ||
      raw.length < 20 ||
      raw.slice(0, 200).toLowerCase().includes("<!doctype html")
    ) {
      throw new Error("subtitle body looks like an error page");
    }
    if (vttFile.exists) vttFile.delete();
    vttFile.create();
    vttFile.write(raw);
  }

  const converted = vttToSrt(raw);
  if (converted) {
    console.log(
      `[SubPos] vtt→srt: ${converted.cues} cues (sidecar attaches as application/x-subrip)`,
    );
    if (srtFile.exists) srtFile.delete();
    srtFile.create();
    srtFile.write(converted.srt);
    return toResult(srtFile, safeLabel);
  }
  console.warn(
    `[SubPos] vtt→srt: 0 cues parsed — attaching raw vtt (position setting stays inert)`,
  );
  return toResult(vttFile, safeLabel);
}

function toResult(file: File, label: string): AnimeSubtitleFile {
  const format = file.uri.endsWith(".srt") ? "srt" : "vtt";
  return {
    uri: file.uri,
    mimeType: mimeTypeForFormat(format),
    language: label || "English",
    label: label || "English",
  };
}

/** Drop all downloaded JustAnime sidecars (media change / cache clear). */
export async function clearAnimeSubtitles(): Promise<void> {
  try {
    const dir = new Directory(animeSubDirUri);
    if (dir.exists) dir.delete();
  } catch {}
}
