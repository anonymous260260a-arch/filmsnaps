/**
 * Download ranking + file details — the download-page counterpart of
 * `streamSelector.ts`.
 *
 * `rankStreams` answers "which link starts fast, plays in my language and
 * seeks without buffering?" Several of its rungs are wrong for a download:
 *
 *   - bandwidth cap, cellular ceiling, "lightest first": size no longer trades
 *     against rebuffering, so within a quality tier a bigger file is simply a
 *     higher-bitrate encode and ranks first.
 *   - hard-filtering download-only links: that filter would delete exactly
 *     what a download page exists to offer.
 *   - demoted hosts (signed googleusercontent URLs stall when streamed but
 *     download fine) and the web-playable-container ordering.
 *
 * What carries over is the taste — language first, then quality, then clean
 * prints — plus one rung the player never needed because the player assumes a
 * two-speaker sink: audio format (Atmos / TrueHD / DTS-HD ahead of DDP ahead
 * of AAC). Nothing is filtered except genuine samples.
 */
import type { StreamLink } from "./sources/types";
import {
  effectiveQuality,
  isCamPrint,
  isDownloadOnlyLink,
  linkContainerLabel,
  sizeOf,
  QUALITY_ORDER,
} from "./streamSelector";
import { extractLanguages } from "../utils/falix";

export type DownloadPreferredLanguage = "auto" | "multi" | "hindi" | "english";

export interface DownloadRankOptions {
  /** User's `preferredAudioLanguage` setting — the "Your language" bucket. */
  preferredLanguage?: DownloadPreferredLanguage;
}

// ── Language ──────────────────────────────────────────────────────

/**
 * Language bucket rank — lower wins. `extractLanguages` is the exhaustive
 * tag list (every language the release advertises), so anything labelled but
 * not Hindi/English still beats a file that says nothing about its audio.
 */
function languageBucketRank(langs: string[]): number {
  const lower = langs.map((l) => l.toLowerCase());
  if (lower.length === 0) return 5;
  if (lower.some((l) => l.startsWith("multi") || l.startsWith("dual")))
    return 1;
  if (lower.includes("hindi")) return 2;
  if (lower.includes("english")) return 3;
  return 4;
}

// ── Audio ─────────────────────────────────────────────────────────

const AUDIO_PATTERNS: Array<[RegExp, string, number]> = [
  [/\batmos\b/i, "Dolby Atmos", 0],
  [/\btruehd\b/i, "Dolby TrueHD", 1],
  [/dts[ -]?hd|dts[ -]?ma/i, "DTS-HD MA", 2],
  [/dts[ :-]?x\b/i, "DTS:X", 2],
  [/\bdts\b/i, "DTS", 3],
  [/ddp|dd\+|e-?ac-?3|dolby digital\+/i, "Dolby Digital Plus", 4],
  [/dd\s?5\.1|ac-?3\b/i, "Dolby Digital 5.1", 5],
  [/\baac\b/i, "AAC", 6],
];

/** Audio format label + rank (0 = best). */
function detectAudio(
  text: string,
  fallback?: string,
): { label: string; rank: number } {
  for (const [pattern, label, rank] of AUDIO_PATTERNS) {
    if (!pattern.test(text)) continue;
    // "Dolby Atmos 5.1" reads better than "Dolby Atmos" + a stray channel.
    const ch = text.match(/\b(5\.1|7\.1|2\.0)\b/)?.[1];
    return {
      label: ch && !label.includes(ch) ? `${label} ${ch}` : label,
      rank,
    };
  }
  if (fallback && fallback !== "Unknown") return { label: fallback, rank: 7 };
  return { label: "", rank: 99 };
}

// ── Codec / quality ───────────────────────────────────────────────

function detectCodec(text: string, meta?: string): string {
  const lower = text.toLowerCase();
  if (meta === "hevc" || /hevc|x265|h\.265/.test(lower)) return "HEVC";
  if (meta === "av1" || /\bav1\b|av01/.test(lower)) return "AV1";
  if (meta === "vp9" || /\bvp9\b|vp09/.test(lower)) return "VP9";
  if (meta === "h264" || /x264|h\.264|avc/.test(lower)) return "H.264";
  return "";
}

/** "4K" for 4K/2160p, otherwise the tier as-is ("1080p"). */
export function qualityLabel(link: StreamLink, scanText = ""): string {
  let q = effectiveQuality(link);
  if (!(QUALITY_ORDER as readonly string[]).includes(q)) {
    // The API's quality field can be empty/unlabelled — fall back to a scan.
    const m = `${scanText} ${link.quality}`.match(
      /\b(2160[pP]|1080[pP]|720[pP]|480[pP]|360[pP]|[48][Kk])\b/,
    );
    q = m ? m[1].toLowerCase() : q;
  }
  if (q === "4k" || q === "4K") return "4K";
  if (q === "8k" || q === "8K") return "8K";
  return q.toUpperCase() === "2160P" ? "4K" : q;
}

/** Index into QUALITY_ORDER (0 = best); unknown tiers rank last. */
function qualityRankOf(label: string): number {
  const idx = (QUALITY_ORDER as readonly string[]).indexOf(label.toLowerCase());
  return idx >= 0 ? idx : QUALITY_ORDER.length;
}

// ── Size ──────────────────────────────────────────────────────────

/** "8.5 GB" — empty string when the size is unknown. */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** i;
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

// ── Display-name cleaning ─────────────────────────────────────────

/**
 * Context the cleaner cannot get from the file name itself.
 *
 * Built from TMDB (already fetched by both download screens): the title
 * anchors where the name really starts, and the episode name is the one
 * fact that no list of tokens could ever guess — "pilot" is only knowable
 * by asking which episode S01E01 is.
 */
export interface DownloadNameContext {
  /** Series/movie title as the app shows it. */
  title?: string;
  /** Episode title for the episode being listed (TV only). */
  episodeName?: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Separator run allowed between two words matched in a name. */
const NAME_SEP = `[.\\s_&'-]*`;

/**
 * Words that never belong in a cleaned name, measured against 458 real HDHub
 * files (8 movies, 6 shows): quality tiers, codec, picture tags, host/site
 * labels, audio formats and size units.
 *
 * Language words are deliberately absent — Hindi/English/Dual stay in the
 * name even though the meta line repeats them.
 */
const JUNK_TOKENS = [
  // quality tiers
  "2160p",
  "1080p",
  "720p",
  "480p",
  "360p",
  "240p",
  "4k",
  "8k",
  "uhd",
  "fhd",
  // codec
  "x264",
  "x265",
  "x263",
  "x262",
  "h264",
  "h265",
  "avc",
  "av1",
  "av01",
  "vp9",
  "vp09",
  "hevc",
  // picture tags
  "hdr",
  "hdr10",
  "dv",
  "dovi",
  "sdr",
  "imax",
  "hlg",
  // hosts / sites / packaging flags
  "vegamovies",
  "hdhub",
  "hdhub4u",
  "4khdhub",
  "pixeldrain",
  "emby",
  "fsl",
  "fslv2",
  "10gbps",
  "gbps",
  "vsunny",
  "download",
  "only",
  // audio leftovers
  "ddp",
  "dd",
  "aac",
  "truehd",
  "atmos",
  "dts",
  "eac3",
  "ac3",
  "org",
  "kbps",
  "mbps",
  "bps",
  // size units (standalone — "9.45 GB" is removed as a phrase)
  "gb",
  "mb",
  "tb",
  "kb",
  // misc
  "fps",
  "60fps",
  "30fps",
  "audio",
].join("|");

const JUNK_TOKEN_RE = new RegExp(
  `(^|[.\\s_-])(?:${JUNK_TOKENS})(?=[.\\s_-]|$)`,
  "gi",
);

/** "9.45 GB", "1008.31 MB" — the size the meta line shows separately. */
const SIZE_PHRASE_RE = /\b\d+(?:[.,]\d+)?\s*(?:TB|GB|MB|KB)\b/gi;
/** "10bit", "10-bit", "8 bit". */
const BIT_DEPTH_RE = /\b\d{1,2}[\s._-]?bits?\b/gi;
const VC1_RE = /\bVC[\s._-]?1\b/gi;
const X26N_RE = /\bx26\d\b/gi;
const CODEC_PHRASE_RE = /\bH[\s._-]?26[45]\b/gi;

/**
 * Audio formats, longest first so DTS-HD.MA never degrades into DTS.
 * Channel counts only match when they really are a channel count, so
 * `DD.2024` never loses the first two digits of the year.
 */
const AUDIO_PHRASES: RegExp[] = [
  /DTS[\s._-]?HD[\s._-]?MA(?:[\s._-]?5[\s._-]?1)?\b/gi,
  /DTS[\s._-]?HD\b/gi,
  /DTS[\s._-]?MA\b/gi,
  /DTS[\s._-]?X\b/gi,
  /\bDTS\b/gi,
  /True[\s._-]?HD\b/gi,
  /EAC[\s._-]?3\b/gi,
  /AC[\s._-]?3\b/gi,
  /\bAtmos\b/gi,
  /\bORG[\s._-]*(?:\d[\s._-]?\d)?\b/gi,
  /\b(?:DDPA|DDP|DD\+|DD)(?:[\s._-]*(?:5[\s._-]?1|7[\s._-]?1|2[\s._-]?0|51|20))?(?![A-Za-z])/gi,
  /\bAAC(?:[\s._-]*(?:5[\s._-]?1|2[\s._-]?0))?(?![A-Za-z])/gi,
  /\b\d{3,4}[\s._-]?Kbps\b/gi,
  /\b\d{1,2}[\s._-]?CH\b/gi,
  /\b(?:5[\s._-]?1|7[\s._-]?1|2[\s._-]?0)\b/gi,
];

/**
 * Hosts and release sites, absorbing the group name in front of them:
 * `x264-HDHub4u.Tv`, `CJ-4kHdHub.com`, `H.265-4kHdHub.Com`, `Vegamovies.NL`.
 */
const SITE_PHRASE_RE =
  /(?:\b[A-Za-z0-9]{1,16}[\s._-])?(?:4[Kk])?[Hh][Dd][Hh][Uu][Bb]\w*(?:\.[A-Za-z]{2,4})?|\b[Vv]ega[mM]ovies\w*(?:\.[A-Za-z]{2,4})?|\b[Pp]ixel[Dd]rain\b|\b[Ff][Ss][Ll]v?\d?\b|\b10[Gg][Bb]ps\b|\bEMBY\b/gi;

/** A bracket/brace is always metadata: `[FSL]`, `[💾 9.45 GB]`, `{Hindi-English}`. */
function unwrapBrackets(s: string): string {
  return s
    .replace(/\[([^\[\]]*)\]/g, (_m, inner: string) => ` ${inner} `)
    .replace(/\{([^{}]*)\}/g, (_m, inner: string) => ` ${inner} `);
}

const PAREN_YEAR_RE = /^(?:19|20)\d{2}$/;
const PAREN_LANGUAGE_RE =
  /\b(?:hindi|english|dual|multi|spanish|french|german|tamil|telugu|malayalam|kannada|bengali|marathi|punjabi|urdu|eng|hin|tam|tel|mal|kan|ben|mar|pun|urd|spa|fre|ger|jpn|kor|chi|ara|dut|por|rus|ita|vie|thai|ind|may|fil)\b/i;
const PAREN_GROUP_RE = /[A-Za-z0-9]+-[A-Za-z0-9]/;

/**
 * `(2008)` is part of the name; `(Hin-Eng)` and `(Hindi DD 2.0 + English …)`
 * keep their words; `(CJ-4kHdHub.com)`, `(FraMeSToR-4k)` and `(SA89-LUMiX)`
 * are release groups and go.
 */
function stripParens(s: string): string {
  return s.replace(/\(([^()]*)\)/g, (whole, inner: string) => {
    const content = inner.trim();
    if (!content) return " ";
    if (PAREN_YEAR_RE.test(content)) return whole;
    if (PAREN_LANGUAGE_RE.test(content)) return ` ${content} `;
    if (PAREN_GROUP_RE.test(content)) return " ";
    return ` ${content} `;
  });
}

/**
 * Anchor the name at the TMDB title — everything before it is prefix junk
 * (`Copy of`, `2_`, `[60FPS]`). No match means the file uses a different
 * name, so the string is left alone rather than guessed at.
 */
function anchorAtTitle(s: string, title?: string): string {
  if (!title) return s;
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return s;
  const pattern = words.map(escapeRegExp).join(NAME_SEP);
  const re = new RegExp(`(^|[.\\s_&'-])(${pattern})(?=[.\\s_&'(-]|$)`, "i");
  const m = re.exec(s);
  if (!m) return s;
  return s.slice(m.index + m[1].length);
}

/** Drop the TMDB episode title ("pilot", "Cat's in the Bag…") from a name. */
function dropEpisodeName(
  s: string,
  episodeName?: string,
): { text: string; dropped: boolean } {
  if (!episodeName || !/\bS\d{1,2}[.\s_-]*E\d{1,3}\b/i.test(s))
    return { text: s, dropped: false };
  const words = episodeName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return { text: s, dropped: false };
  const pattern = words.map(escapeRegExp).join(NAME_SEP);
  const re = new RegExp(`(^|[.\\s_&'-])(${pattern})(?=[.\\s_&'(-]|$)`, "i");
  if (!re.test(s)) return { text: s, dropped: false };
  return { text: s.replace(re, "$1"), dropped: true };
}

/**
 * Fallback when TMDB has no name for the episode (or the file spells it
 * differently): delete whatever sits between `S01E01` and the next thing a
 * release name always has after an episode title — quality, format, service,
 * codec or a language. Nothing is touched when no such anchor follows.
 */
const EPISODE_RUN_ANCHOR =
  "2160[pP]|1080[pP]|720[pP]|480[pP]|360[pP]|4[kK]|UHD|AMZN|NF|DSNP|HULU|ATVP|MAX|ZEE5|SONY|WEB[\\s._-]?DL|WEBRip|BluRay|BDRip|HDRip|HDTV|REMUX|WEB|H\\.26[45]|x26[45]|HEVC|AV1|HDR10?\\+?|DV|SDR|IMAX|10[Bb]it|ESubs?|Hindi|English|Dual|Multi|Spanish|Hin[\\s._-]?Eng|ENG|HIN|TV[\\s._-]?DL|DDP|DD|AAC|Atmos|DTS|TrueHD";

function dropEpisodeRun(s: string): string {
  if (!/\bS\d{1,2}[.\s_-]*E\d{1,3}\b/i.test(s)) return s;
  const re = new RegExp(
    `(\\bS\\d{1,2}[.\\s_-]*E\\d{1,3}\\b)([.\\s_-]+)(.*?)(?=[.\\s_-]+(?:${EPISODE_RUN_ANCHOR})\\b)`,
    "i",
  );
  return s.replace(re, "$1");
}

function tidyName(s: string): string {
  let out = s
    // emoji (and the mojibake HDHub's CDN emits for them)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")
    .replace(/ðŸ../g, " ")
    .replace(/[~|]/g, " ")
    .replace(/\s+/g, " ")
    // "Hindi+English" → "Hindi.English"
    .replace(/([A-Za-z0-9])\+([A-Za-z0-9])/g, "$1.$2")
    // separator runs left by a deletion: "2014..BluRay", "Hindi. English"
    .replace(/[.\s_+]{2,}/g, ".")
    .replace(/([.\s_])-/g, "$1")
    .replace(/-([.\s_])/g, "$1");

  // Truncated descriptions leave an unpaired paren behind: "(FraMeSToR-".
  out = out.replace(/\(([^()]*)\)/g, "\u0000$1\u0001").replace(/[()]/g, " ");

  return out
    .replace(/\u0000/g, "(")
    .replace(/\u0001/g, ")")
    .replace(/\s+/g, " ")
    .replace(/[.\s_+]{2,}/g, ".")
    .replace(/^[.\s_-]+/, "")
    .replace(/[.\s_-]+$/, "")
    .trim();
}

/**
 * Shorten a raw HDHub release name to what a download row should show.
 *
 * `Laterns.S01.E01.pilot.2160p.AMZN.WEB-DL.MULTI.DDP.51.Atmos.H.265-4KHDHub.com.mkv`
 * becomes `Laterns.S01.E01.AMZN.WEB-DL.MULTI.mkv`: host tags, size, quality,
 * audio format, codec, picture tags and site/group suffixes go — title,
 * episode numbers, languages, source format, service and extension stay.
 *
 * Returns the input unchanged when cleaning would leave nothing usable.
 */
export function simplifyDownloadName(
  raw: string,
  ctx: DownloadNameContext = {},
): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length < 8) return trimmed;

  const extMatch = trimmed.match(MEDIA_EXT);
  const ext = extMatch ? extMatch[0] : "";
  let s = ext ? trimmed.slice(0, -ext.length) : trimmed;

  // HDHub descriptions are multi-line: release name first, then host metadata.
  s = s.split(/\r?\n/)[0] ?? "";
  s = s.split(" | ")[0];

  s = unwrapBrackets(s);
  s = stripParens(s);
  s = s.replace(SIZE_PHRASE_RE, " ");
  s = s.replace(/^(?:\s*copy\s+of\s+|[0-9]{1,2}_)/i, "");

  s = anchorAtTitle(s, ctx.title);

  const episode = dropEpisodeName(s, ctx.episodeName);
  s = episode.text;
  if (!episode.dropped) s = dropEpisodeRun(s);

  for (const phrase of AUDIO_PHRASES) s = s.replace(phrase, " ");
  s = s.replace(BIT_DEPTH_RE, " ");
  s = s.replace(VC1_RE, " ");
  s = s.replace(X26N_RE, " ");
  s = s.replace(CODEC_PHRASE_RE, " ");
  s = s.replace(SITE_PHRASE_RE, " ");

  // Two passes: the first can expose a token the second now recognises.
  s = s.replace(JUNK_TOKEN_RE, "$1");
  s = s.replace(JUNK_TOKEN_RE, "$1");

  s = tidyName(s);

  const stem = s.replace(MEDIA_EXT, "").trim();
  if (stem.length < 10) return trimmed;
  return ext ? `${s}${ext}` : s;
}

// ── Display name ──────────────────────────────────────────────────

const MEDIA_EXT = /\.(mkv|mp4|m4v|avi|ts|m2ts|webm|mov|wmv|flv|zip|rar|7z)$/i;

/** Container labels that are safe to write as a file extension. */
const KNOWN_EXT_RE = /^(mkv|mp4|m4v|avi|ts|m2ts|webm|mov|wmv|flv|zip|rar|7z)$/i;

function urlBaseName(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] ?? "");
  } catch {
    return "";
  }
}

/**
 * How much a candidate string looks like a release/file name rather than a
 * label ("HdHub 1080p"). Year and quality are the strongest signals — real
 * release names carry both.
 */
function releaseScore(candidate: string): number {
  if (!candidate || candidate.length < 8) return -1;
  let score = 0;
  if (/(?:^|[^\d])(?:19|20)\d{2}(?:[^\d]|$)/.test(candidate)) score += 2;
  if (/\b(?:2160|1080|720|480|360)p\b|\b4k\b/i.test(candidate)) score += 2;
  if (MEDIA_EXT.test(candidate)) score += 1;
  if (candidate.split(/[.\s_\-]/).filter(Boolean).length >= 4) score += 1;
  return score;
}

/**
 * The file name the row leads with.
 *
 * Two raw candidates exist for every link — the description line and the URL
 * basename (374 vs 82 of 458 real files) — and both are full release names,
 * so both are cleaned and the longest result that still carries an extension
 * wins. Falls back to the raw-name selection when cleaning leaves nothing
 * readable, which keeps HLS/label entries (`720p.m3u8`) intact.
 */
export function downloadDisplayName(
  link: StreamLink,
  ctx: DownloadNameContext = {},
): string {
  const lines = (link.name ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const base = urlBaseName(link.url);
  const candidates = [
    ...(MEDIA_EXT.test(base) ? [base] : []),
    ...lines.filter((l) => l.length >= 8),
    base,
  ].filter(Boolean);

  let cleaned = "";
  let cleanedScore = -1;
  for (const candidate of candidates) {
    const next = simplifyDownloadName(candidate, ctx);
    const stem = next.replace(MEDIA_EXT, "").trim();
    if (stem.length < 10) continue;
    const score = (MEDIA_EXT.test(next) ? 1000 : 0) + stem.length;
    if (score > cleanedScore) {
      cleaned = next;
      cleanedScore = score;
    }
  }
  if (cleaned) return cleaned;

  let best = "";
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = releaseScore(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
    if (bestScore >= 5) break; // year + quality + structure — no better match
  }

  if (best) return best;
  if (lines.length > 0) return lines.join(" · ");
  if (base) return base;
  return "File";
}

// ── Details ───────────────────────────────────────────────────────

/**
 * `extractLanguages` builds its ~150 tag regexes per call, and every row
 * describes its link twice (once to rank, once to render) — so cache the
 * scan per payload. Bounded: a page holds dozens of links, not thousands.
 */
const languageCache = new Map<string, string[]>();
function scanLanguages(text: string): string[] {
  const hit = languageCache.get(text);
  if (hit) return hit;
  const found = extractLanguages(text);
  if (languageCache.size > 500) languageCache.clear();
  languageCache.set(text, found);
  return found;
}

export interface DownloadFileDetails {
  /** Full file name — render it wrapped, never truncated. */
  name: string;
  /** Language chips in provider order (empty when the name says nothing). */
  languages: string[];
  quality: string;
  qualityRank: number;
  sizeBytes: number;
  sizeLabel: string;
  container: string;
  codec: string;
  audio: string;
  audioRank: number;
  source: string;
  isDownloadOnly: boolean;
  isCamPrint: boolean;
}

/** Everything the row shows, derived once per link. */
export function describeDownloadFile(
  link: StreamLink,
  ctx: DownloadNameContext = {},
): DownloadFileDetails {
  const name = downloadDisplayName(link, ctx);
  const sizeBytes = sizeOf(link);
  const container = linkContainerLabel(link);
  // Scan the whole payload: the display name is often just one line of a
  // multi-line description, and languages/audio frequently live on another.
  const text = `${link.name ?? ""} ${link.url}`;
  const audio = detectAudio(text, link._meta?.audio);
  const quality = qualityLabel(link, text);
  const source =
    link._meta?.source && link._meta.source !== "Unknown"
      ? link._meta.source
      : "";

  return {
    name,
    languages: scanLanguages(text),
    quality,
    qualityRank: qualityRankOf(quality),
    sizeBytes,
    sizeLabel: formatFileSize(sizeBytes),
    container,
    codec: detectCodec(text, link._meta?.codec),
    audio: audio.label,
    audioRank: audio.rank,
    source,
    isDownloadOnly: isDownloadOnlyLink(link),
    isCamPrint: isCamPrint(link),
  };
}

// ── The one metadata line ─────────────────────────────────────────

export type MetaTone =
  | "quality"
  | "size"
  | "language"
  | "info"
  | "cam"
  | "warn";

export interface MetaSegment {
  label: string;
  tone: MetaTone;
}

/**
 * The single metadata line under the file name.
 *
 * Deliberately short: the release name already spells out codec, container
 * and source, so repeating them in a second line only made the row noisy.
 * What is left is what a name rarely carries cleanly — quality, size,
 * languages, audio format — plus the two flags worth shouting about.
 */
export function downloadMetaSegments(
  details: DownloadFileDetails,
): MetaSegment[] {
  const segments: MetaSegment[] = [];
  if (details.quality)
    segments.push({ label: details.quality, tone: "quality" });
  if (details.sizeLabel)
    segments.push({ label: details.sizeLabel, tone: "size" });
  if (details.languages.length > 0)
    segments.push({ label: details.languages.join(", "), tone: "language" });
  if (details.audio) segments.push({ label: details.audio, tone: "info" });
  if (details.isCamPrint) segments.push({ label: "CAM", tone: "cam" });
  if (details.isDownloadOnly)
    segments.push({ label: "Download Only", tone: "warn" });
  return segments;
}

// ── Ranking ───────────────────────────────────────────────────────

/**
 * Order a HDHub file list best-first. Total order:
 *   1. "Your language" bucket (the user's preferredAudioLanguage, plus Multi
 *      which carries every language) when a preference is set.
 *   2. language bucket — multi → hindi → english → labelled → unlabelled.
 *   3. clean prints before cam/telesync — a CAM 1080p looks worse than a
 *      clean 720p, so this outranks the quality tier (it is only reached
 *      within the same language bucket, so language still decides first).
 *   4. quality tier — 4K first, then 1080p, 720p, 480p.
 *   5. audio format — Atmos → TrueHD → DTS-HD → DTS → DD+ → DD → AAC.
 *   6. bigger file first (higher-bitrate encode), unknown size last.
 *   7. HEVC before H.264 on a full tie — same bytes, better picture.
 *
 * Only genuine samples are removed; download-only and oversized files stay,
 * because they are the point of the page.
 */
export function rankDownloadLinks(
  links: StreamLink[],
  options: DownloadRankOptions = {},
): StreamLink[] {
  const preferred = options.preferredLanguage ?? "auto";
  const isMulti = (langs: string[]) =>
    langs.some((l) => {
      const lower = l.toLowerCase();
      return lower.startsWith("multi") || lower.startsWith("dual");
    });

  // Everything expensive (language scan, size parse, audio/codec detect) is
  // computed ONCE per link here — the comparator only reads numbers, because
  // extractLanguages rebuilds ~150 regexes on every call.
  const entries = links
    .filter((link) => !/\bsample\b/i.test(link.name ?? ""))
    .map((link) => {
      const details = describeDownloadFile(link);
      const langs = details.languages;
      const wantsPreferred =
        preferred !== "auto" &&
        (langs.some((l) => l.toLowerCase() === preferred) || isMulti(langs));
      return {
        link,
        details,
        bucket: languageBucketRank(langs),
        wantsPreferred,
      };
    });

  return entries
    .sort((a, b) => {
      if (preferred !== "auto" && a.wantsPreferred !== b.wantsPreferred)
        return a.wantsPreferred ? -1 : 1;
      if (a.bucket !== b.bucket) return a.bucket - b.bucket;
      if (a.details.isCamPrint !== b.details.isCamPrint)
        return a.details.isCamPrint ? 1 : -1;
      if (a.details.qualityRank !== b.details.qualityRank)
        return a.details.qualityRank - b.details.qualityRank;
      if (a.details.audioRank !== b.details.audioRank)
        return a.details.audioRank - b.details.audioRank;
      // Unknown size (0) ranks last — never above a known file.
      const sa = a.details.sizeBytes || Number.NEGATIVE_INFINITY;
      const sb = b.details.sizeBytes || Number.NEGATIVE_INFINITY;
      if (sa !== sb) return sb - sa;
      const ha = a.details.codec === "HEVC" ? 0 : 1;
      const hb = b.details.codec === "HEVC" ? 0 : 1;
      return ha - hb;
    })
    .map((entry) => entry.link);
}

// ── File name ─────────────────────────────────────────────────────

export interface DownloadFileNameInput {
  details: DownloadFileDetails;
  /** Movie/series title as shown in the app. */
  title: string;
  mediaType: "movie" | "tv";
  season?: number;
  episode?: number;
}

/**
 * Name the downloader saves as: the (cleaned) release name when it carries an
 * extension, the cleaned name plus the known container when cleaning removed
 * the extension, otherwise a compact `Title-S01E01-1080p.mkv` scheme.
 */
export function buildDownloadFileName(input: DownloadFileNameInput): string {
  const { details, title, mediaType, season, episode } = input;

  const sanitize = (s: string) =>
    s
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const stem = details.name.replace(MEDIA_EXT, "").trim();
  if (MEDIA_EXT.test(details.name)) {
    const cleaned = sanitize(stem);
    if (cleaned) return `${cleaned}${details.name.match(MEDIA_EXT)?.[0]}`;
  }

  const ext =
    details.container.toLowerCase() ||
    (details.name.match(MEDIA_EXT)?.[1] ?? "mp4").toLowerCase();
  const quality = details.quality || "HD";

  // A cleaned name that never had an extension (`… BluRay REMUX`) still makes
  // a better filename than the compact scheme — as long as no extension of
  // its own is being re-appended (.m3u8 and friends go the compact route).
  if (
    !/\.[A-Za-z0-9]{2,5}$/.test(stem) &&
    stem.length >= 6 &&
    stem !== "File"
  ) {
    const cleaned = sanitize(stem);
    if (cleaned) return `${cleaned}.${KNOWN_EXT_RE.test(ext) ? ext : "mp4"}`;
  }

  if (mediaType === "tv") {
    const ss = String(season ?? 1).padStart(2, "0");
    const ee = String(episode ?? 1).padStart(2, "0");
    return `${sanitize(title) || "episode"}-S${ss}E${ee}-${quality}.${KNOWN_EXT_RE.test(ext) ? ext : "mp4"}`;
  }
  return `${sanitize(title) || "title"}-${quality}.${KNOWN_EXT_RE.test(ext) ? ext : "mp4"}`;
}
