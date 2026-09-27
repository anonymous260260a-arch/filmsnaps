/**
 * JustAnime subtitle sidecar downloads.
 *
 * JustAnime's vtt files are Referer-gated (verified 403 without one), but the
 * player's addExternalSubtitle only takes a file:// uri — no headers. So the
 * vtt is fetched here WITH its link headers and written into the app cache
 * (expo-file-system File.write — the subtitle-sync pattern), then handed to
 * the player as a local file.
 */
import { File, Directory, Paths } from "expo-file-system";
import { fetchWithTimeout } from "./streams";

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
 * Download a JustAnime vtt (with Referer headers) to a local file. Reuses an
 * existing download for the same URL. Throws on network/HTPP errors; an
 * error-page body (the vtt hosts reply with HTML on bad signatures) is
 * rejected so the player never attaches garbage.
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
  const dest = new File(dir, `ja-${hashName(url)}.vtt`);
  if (dest.exists && dest.size > 0) return toResult(dest, safeLabel);

  const res = await fetchWithTimeout(url, 10_000, {
    headers: { Accept: "text/vtt,*/*;q=0.8", ...(headers ?? {}) },
  });
  if (!res.ok) throw new Error(`subtitle HTTP ${res.status}`);
  const text = await res.text();
  if (
    text.length === 0 ||
    text.length < 20 ||
    text.slice(0, 200).toLowerCase().includes("<!doctype html")
  ) {
    throw new Error("subtitle body looks like an error page");
  }
  if (dest.exists) dest.delete();
  dest.create();
  dest.write(text);
  return toResult(dest, safeLabel);
}

function toResult(file: File, label: string): AnimeSubtitleFile {
  return {
    uri: file.uri,
    mimeType: "text/vtt",
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
