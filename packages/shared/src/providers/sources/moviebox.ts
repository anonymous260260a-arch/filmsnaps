/**
 * MovieBox (PenguPlay) stream source adapter.
 *
 * Upstream: `https://pengu.uk/{auth-token-json}/stream/{movie|series}/…`
 * Stremio-shaped answer:
 *
 *   { "streams": [
 *       { "externalUrl": "https://pengu.uk/donate" },          ← donate row, no url
 *       { "name": "🐧 PenguPlay 🧊 1080p • MovieBox",
 *         "description": "📡 Attack on Titan • S01E01
 *                         🎞️ 1080p • H.265 • DASH • Hindi dub audio • ~2.3 Mbps
 *                         🛰️ Source: MovieBox
 *                         💾 420 MB
 *                         🎧 Audio: Hindi",
 *         "url": "https://sacdn.hakunaymatata.com/dash/…/index_web.mpd",
 *         "subtitles": [{ "lang", "label", "url" }],
 *         "behaviorHints": { "filename", "videoSize", "proxyHeaders": { "request": {…} } } } ] }
 *
 * Server quirks verified against the live API (movie + series):
 *   - The first stream is a donate row (externalUrl only, no `url`) — dropped.
 *   - `behaviorHints.filename` is `release-name.ext|^|release-name.ext.pad-<Server>`
 *     (sometimes just `1080pHLS1080phls.pad-Anikoto`). ONLY the first segment
 *     becomes `name`: it carries the quality + language tokens the ranker
 *     parses, and it keeps "MovieBox"/"Sunny" out of the name — rankStreams'
 *     promotional filter rejects any 360p link whose NAME mentions those words
 *     (it was written against fake "360p | MovieBox/Sunny" scraper promos).
 *   - Cookie-gated media (sacdn…hakunaymatata.com DASH/HLS) answers 403 unless
 *     `behaviorHints.proxyHeaders.request` is sent, and it must ride on EVERY
 *     request (manifest + segments). Verified: with the Cookie → 206, without →
 *     403. Mapped onto StreamLink.headers, which the probe and ExoPlayer merge
 *     over the per-host defaults.
 *   - `.mpd` manifests are ~2.5 KB, so the size/container heuristics in
 *     streamValidator would condemn them "File too small" — it needs a DASH
 *     branch (apps/mobile/lib/streamValidator.ts).
 *   - Sizes are honest, but episode-length encodes sit under the shared
 *     MIN_SIZE_MB floors (a 420 MB 1080p episode is normal) — TV links carry
 *     `skipMinSizeFloor` so the ranker's movie-calibrated floor stays on for
 *     movies and off for episodes.
 */
import { parseLinkLanguages } from "../streamSelector";
import type { StreamLink, StreamSourceAdapter } from "./types";

type PenguSubtitle = {
  lang?: string;
  label?: string;
  url?: string;
};

type PenguStream = {
  name?: string;
  description?: string;
  url?: string;
  externalUrl?: string;
  subtitles?: PenguSubtitle[];
  behaviorHints?: {
    filename?: string;
    bingingroup?: string;
    videoSize?: number;
    proxyHeaders?: { request?: Record<string, string> };
  };
};

type PenguResponse = { streams?: PenguStream[] };

/** URL path/query extension: .mpd / .m3u8 / .mp4 / .mkv … */
const MEDIA_EXT_RE = /\.(mpd|m3u8|mp4|mkv|webm|ts)(\?|$)/i;
/** Quality tokens Pengu prints in the 🎞️ line and in release names. */
const QUALITY_RE = /\b(2160p|1080p|720p|480p|360p)\b/i;
/** `Hindi dub audio` / `Arabic sub audio` / `Original Audio` (🎞️ line). */
const AUDIO_MODE_RE = /\b[\w.]+\s+(sub|dub)\s+audio\b/i;

/** First code point of a line — the description lines all lead with an emoji. */
function firstCodePoint(line: string): string {
  return [...line][0] ?? "";
}

/** Drop the leading emoji + variation selector, keep the rest of the line. */
function stripEmoji(line: string): string {
  return [...line]
    .slice(1)
    .join("")
    .replace(/^\u{FE0F}\s*/u, "")
    .trim();
}

function parseDescription(desc: string): {
  specs: string;
  source: string;
  sizeText: string;
  audio: string;
} {
  const out = { specs: "", source: "", sizeText: "", audio: "" };
  for (const raw of desc.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    switch (firstCodePoint(line)) {
      case "\u{1F39E}": // 🎞️ quality · codec · container · audio
        out.specs = stripEmoji(line);
        break;
      case "\u{1F6F0}": // 🛰️ Source: …
        out.source = stripEmoji(line)
          .replace(/^Source:\s*/i, "")
          .trim();
        break;
      case "\u{1F4BE}": // 💾 size
        out.sizeText = stripEmoji(line);
        break;
      case "\u{1F3A7}": // 🎧 Audio: …
        out.audio = stripEmoji(line)
          .replace(/^Audio:\s*/i, "")
          .trim();
        break;
      default:
        break; // 📡/🍿 title line, 📝 subtitle list, 🙊 warnings
    }
  }
  return out;
}

/** Container from the URL first, then the 🎞️ line, then the filename. */
function containerType(url: string, specs: string, filename: string): string {
  const ext = url.split("?")[0].match(MEDIA_EXT_RE)?.[1]?.toLowerCase();
  if (ext === "mpd") return "mpd";
  if (ext === "m3u8") return "hls";
  if (ext) return ext === "mkv" ? "mkv" : "mp4";
  // Extension-less pengu.uk proxies still expose the flavour in the path.
  if (/\/dash\//i.test(url)) return "mpd";
  if (/\/hls\//i.test(url)) return "hls";
  if (/\bDASH\b/i.test(specs)) return "mpd";
  if (/\bHLS\b/i.test(specs)) return "hls";
  if (/\bMKV\b/i.test(filename)) return "mkv";
  if (/\bMP4\b/i.test(specs) || /\.mp4/i.test(filename)) return "mp4";
  return "mp4";
}

function codecOf(specs: string, filename: string): string {
  const text = `${specs} ${filename}`;
  if (/\b(H\.?265|HEVC|x265)\b/i.test(text)) return "hevc";
  if (/\b(H\.?264|x264)\b/i.test(text)) return "h264";
  if (/\bAV1\b/i.test(text)) return "av1";
  return "unknown";
}

/**
 * Ranker-facing audio tag: "sub" / "dub" when the upstream says so, else the
 * spoken language, else "original"/"unknown". The player's sub/dub counters
 * and the anime ranker read these values.
 */
function audioTagOf(specs: string, source: string, audio: string): string {
  const mode =
    source.match(/·\s*(Sub|Dub)\b/i)?.[1] ?? specs.match(AUDIO_MODE_RE)?.[1];
  if (mode) return mode.toLowerCase();
  if (audio) return audio;
  if (/\bOriginal Audio\b/i.test(specs)) return "original";
  return "unknown";
}

/** Spoken language worth appending to `name` for the picker's language chips. */
function spokenLanguage(specs: string, audio: string): string {
  if (audio) return audio;
  return specs.match(/([A-Za-z]{3,})\s+(?:sub|dub)\s+audio\b/i)?.[1] ?? "";
}

/** `1080p • …` — a label, not a release name: keep quality, drop the string. */
const GENERATED_LABEL_RE =
  /\b(2160p|1080p|720p|480p|360p)\b|\.(mpd|m3u8|mp4|mkv|webm)\b/i;

/**
 * Release name for the ranker/picker: the first `|^|` segment of the
 * upstream filename, minus its generated `.pad-<Server>` label.
 */
function releaseName(
  filename: string,
  quality: string,
  language: string,
): string {
  const segment = filename
    .split("|^|")[0]
    .replace(/\s*\bpad-[A-Za-z0-9]+$/i, "")
    .trim();
  // Generated labels (`1080pHLS1080phls`, `360pMP4360pmp4`) carry no
  // language and read as garbage in the picker's reason line.
  let name = segment && GENERATED_LABEL_RE.test(segment) ? segment : "";

  // parseLinkLanguages() only understands hindi/english(/multi): append the
  // spoken language when the release name carries none, so an English-dub
  // row lands in the English section instead of "Other".
  if (!name && /^(hindi|english)$/i.test(language)) {
    name = `${quality} • ${language[0].toUpperCase()}${language.slice(1).toLowerCase()}`;
  } else if (
    name &&
    parseLinkLanguages(name).length === 0 &&
    /^(hindi|english)$/i.test(language)
  ) {
    name += ` • ${language[0].toUpperCase()}${language.slice(1).toLowerCase()}`;
  }
  if (!name) name = `${quality} • PenguPlay`;

  // Defensive: rankStreams drops 360p links whose NAME mentions MovieBox or
  // Sunny (a promo filter written against fake scraper rows). The real source
  // travels in _meta.source, so the name can lose the words and keep the link.
  if (quality === "360p" && /\b(MovieBox|Sunny)\b/i.test(name)) {
    name = `${quality} • PenguPlay`;
  }
  return name;
}

/** Parse a full PenguPlay response into StreamLink[]. */
export function parseMovieBoxResponse(
  response: unknown,
  sourceId: string,
  mediaType: "movie" | "tv",
): StreamLink[] {
  const data = response as PenguResponse | PenguStream[] | null;
  if (!data || typeof data !== "object") return [];
  const streams = Array.isArray(data)
    ? data
    : Array.isArray(data.streams)
      ? data.streams
      : [];

  const links: StreamLink[] = [];
  for (let i = 0; i < streams.length; i++) {
    const s = streams[i];
    // The donate row (`externalUrl`, no playable url) and malformed entries.
    if (!s || typeof s.url !== "string" || !s.url) continue;

    const desc = parseDescription(s.description ?? "");
    const filename = (s.behaviorHints?.filename ?? "").trim();
    const specs = desc.specs;
    const source = desc.source || s.behaviorHints?.bingingroup || "PenguPlay";

    const quality =
      specs.match(QUALITY_RE)?.[1]?.toLowerCase() ??
      (s.name ?? "").match(QUALITY_RE)?.[1]?.toLowerCase() ??
      filename.match(QUALITY_RE)?.[1]?.toLowerCase() ??
      "unknown";
    const type = containerType(s.url, specs, filename);
    const language = spokenLanguage(specs, desc.audio);

    const headers = s.behaviorHints?.proxyHeaders?.request;
    const sizeBytes = s.behaviorHints?.videoSize;
    const subtitles = Array.isArray(s.subtitles)
      ? s.subtitles
          .filter((t) => t && typeof t.url === "string" && t.url)
          .map((t) => ({
            lang: (t.label || t.lang || "Unknown").replace(/^\.+/, "").trim(),
            url: t.url as string,
          }))
      : undefined;

    links.push({
      id: `${sourceId}-${i}`,
      quality,
      name: releaseName(filename, quality, language),
      url: s.url,
      type,
      ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
      ...(desc.sizeText ? { size: desc.sizeText } : {}),
      _meta: {
        codec: codecOf(specs, filename),
        audio: audioTagOf(specs, source, desc.audio),
        // Spoken language for display ("Arabic", "French", "Hindi" …) —
        // `audio` above stays the sub/dub/original/unknown ranker tag.
        ...(language ? { audioLanguage: language } : {}),
        source,
        isDownloadOnly: false,
        isWebReady: type === "mp4",
        // Honest sizes, but episodes are shorter than the floors assume —
        // see the module docstring.
        ...(mediaType === "tv" ? { skipMinSizeFloor: true } : {}),
        ...(typeof sizeBytes === "number" && sizeBytes > 0
          ? { sizeBytes }
          : {}),
        ...(subtitles && subtitles.length > 0 ? { subtitles } : {}),
      },
    });
  }
  return links;
}

export function createMovieBoxAdapter(): StreamSourceAdapter {
  return {
    id: "moviebox",
    parseResponse: (response, params) =>
      parseMovieBoxResponse(
        response,
        params.sourceId ?? "moviebox",
        params.mediaType,
      ),
  };
}

export const movieboxAdapter: StreamSourceAdapter = createMovieBoxAdapter();
