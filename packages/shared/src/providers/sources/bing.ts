/**
 * Bing adapter — api.bingr.one scraper cluster.
 *
 * Four upstream routes, ONE response shape:
 *
 *   GET  /api/stream/aphelion-tv/{tmdbId}/{season}/{episode}   (DarkMatter,
 *        TV-only — movie ids answer empty; slug allowlist is aphelion-tv)
 *   POST /api/stream  {srv:"s70"|"s62"|"s61", t, id, query}
 *        s70 = Polaris, s62 = Bastion, s61 = Corvus
 *
 * All four answer:
 *   {
 *     "scraperName": "Bastion",
 *     "sources": [{
 *       "url": "https://…/index.m3u8?auth_key=…&expire=…",
 *       "quality": "720p" | "720p | English",
 *       "language": "Hindi" | "Original" | …,
 *       "type": "application/x-mpegurl" | "video/mp4",
 *       "label": "Hindi — 720p", "name": "…", "isMP4": false,
 *       "headers": {}                     // DarkMatter only, always empty
 *     }],
 *     "subtitles": [{ url, lang, label }] // often []
 *   }
 *
 * Notes that shape the mapping below:
 *  - `headers` arrives as an empty object on DarkMatter links. The web
 *    proxy drops header-gated links (`linkFilter: !link.headers`), so an
 *    empty {} MUST be omitted, not forwarded — `{}` is truthy.
 *  - Language words live in `label`/`quality`, not a stable field — the
 *    ranker parses `link.name` (parseLinkLanguages), so `name` carries the
 *    full label. `quality` is normalised to "720p"-style for display.
 *  - Signed URLs (`expire=…`) — never cached downstream for long.
 */
import type { StreamLink, StreamSourceAdapter } from "./types";

interface BingSubtitle {
  url?: string;
  lang?: string;
  language?: string;
  label?: string;
}

interface BingSource {
  url?: string;
  quality?: string;
  language?: string;
  type?: string;
  label?: string;
  name?: string;
  isMP4?: boolean;
  headers?: Record<string, string>;
}

interface BingResponse {
  scraperName?: string;
  sources?: BingSource[];
  subtitles?: BingSubtitle[];
}

/** Container from the MIME type / URL extension / isMP4 flag. */
function containerFor(url: string, type?: string, isMP4?: boolean): string {
  if (type === "application/x-mpegurl" || /\.m3u8(\?|$)/i.test(url))
    return "hls";
  if (type === "video/mp4" || isMP4) return "mp4";
  const m = /\.(mp4|mkv|webm)(\?|$)/i.exec(url);
  return m ? m[1].toLowerCase() : "mp4";
}

/**
 * Codec sniff from the URL. Bastion/Polaris mark HEVC renditions in the
 * path (…/1080_h265/…); everything else is the default H.264 family.
 * HLS stays "hls" unless the path says otherwise — mirrors spacedom, whose
 * codec value is what the web HEVC penalty keys on.
 */
function codecFor(url: string, container: string): string {
  // Test the path only — a signed query (auth_key=…265…) must not trip it.
  const path = url.split("?")[0];
  if (/[_/.-]h?265([_/.-]|$)|hevc/i.test(path)) return "hevc";
  return container === "hls" ? "hls" : "h264";
}

/** "720p | English" / "Hindi — 720p" → "720p"; no digits → the raw label. */
function qualityFor(source: BingSource): string {
  const m = /\b(2160p|1080p|720p|480p|360p|240p)\b/i.exec(
    `${source.quality ?? ""} ${source.label ?? ""} ${source.name ?? ""}`,
  );
  if (m) return m[1].toLowerCase();
  return (
    source.quality?.trim() ||
    (/\.m3u8(\?|$)/i.test(source.url ?? "") ? "Auto" : "Original")
  );
}

/** Display/ranker name — must carry the language word for parseLinkLanguages. */
function nameFor(source: BingSource, fallback: string): string {
  const label = source.label?.trim();
  if (label) return label;
  const parts = [
    source.language && source.language !== "Original" ? source.language : null,
    source.quality ?? null,
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(" — ");
  return source.name?.trim() || fallback;
}

export function parseBingResponse(
  response: unknown,
  sourceId?: string,
): StreamLink[] {
  const data = response as BingResponse | null;
  if (!data || typeof data !== "object" || !Array.isArray(data.sources)) {
    return [];
  }

  const scraper = data.scraperName || sourceId || "bing";
  const subtitles = (Array.isArray(data.subtitles) ? data.subtitles : [])
    .filter((s) => typeof s?.url === "string" && s.url.length > 0)
    .map((s) => ({
      lang: (s.lang || s.language || s.label || "en").trim(),
      url: s.url as string,
    }));

  const seen = new Set<string>();
  const links: StreamLink[] = [];

  for (const source of data.sources) {
    if (!source?.url) continue;
    // Same URL can repeat across scrapers (cache rows) — keep one.
    if (seen.has(source.url)) continue;
    seen.add(source.url);

    const container = containerFor(source.url, source.type, source.isMP4);
    const hasHeaders = source.headers && Object.keys(source.headers).length > 0;
    const language =
      source.language && source.language.length > 0
        ? source.language
        : undefined;

    links.push({
      id: `${sourceId ?? "bing"}-${links.length}`,
      quality: qualityFor(source),
      name: nameFor(source, `${scraper} — ${qualityFor(source)}`),
      url: source.url,
      type: container,
      // Omit empty {} (truthy would trip the web proxy's linkFilter) —
      // browsers cannot attach custom headers to media requests anyway.
      headers: hasHeaders ? { ...source.headers } : undefined,
      _meta: {
        codec: codecFor(source.url, container),
        audio: language ?? "unknown",
        audioLanguage:
          language && language !== "Original" ? language : undefined,
        source: scraper,
        isDownloadOnly: false,
        isWebReady: true,
        ...(subtitles.length > 0 ? { subtitles } : {}),
      },
    });
  }

  return links;
}

export function createBingAdapter(): StreamSourceAdapter {
  return {
    id: "bing",
    parseResponse: (response, params) =>
      parseBingResponse(response, params?.sourceId),
  };
}

export const bingAdapter: StreamSourceAdapter = createBingAdapter();
