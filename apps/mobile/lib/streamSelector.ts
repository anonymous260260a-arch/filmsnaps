/**
 * Stream Selector — picks the best stream by what the user actually needs.
 *
 * The ranking question this answers: "of these 40 links, which one starts
 * fast, plays in my language, and seeks without buffering?"
 *
 * Algorithm (in order):
 *   1. Hard filters: sample rips, DOWNLOAD-ONLY links, min size per quality.
 *   2. Network ceiling: 8K hidden, user maxQuality cap, cellular data cap.
 *   3. Language bucket: links carrying the user's preferred language first
 *      (a "Multi" link carries every language, so it belongs to the
 *      preferred bucket too). For "auto": Multi > Hindi > English.
 *   4. Quality tier: the highest tier whose LIGHTEST file fits the
 *      connection's streamability cap:
 *         capBytes = speedMbps × 0.35 ÷ 8 × runtimeMinutes × 60
 *      The 0.35 headroom leaves 65% of bandwidth for seek bursts — a file
 *      whose bitrate equals the bandwidth plays but seeks terribly.
 *      File size is parsed from _meta.sizeBytes, then from the human-readable
 *      `size` field (e.g. "8.2 GB"), then from the filename. Links with
 *      truly unknown size are deprioritized (never preferred over known fits).
 *      No speed test yet → assume 10 Mbps. 480p is never auto-played while
 *      anything larger fits.
 *   5. Champion within the tier: LIGHTEST file wins, unless a faster CDN
 *      hosts a file within +25% size (a 15% size difference is invisible;
 *      a faster CDN is not). Cam prints (HDTC/HDTS/CAM) lose to clean
 *      prints in the same tier. HEVC wins size ties (same bytes, better
 *      picture).
 *
 * Quality is parsed from the FILENAME first — the API's `quality` field is
 * unreliable (it labels 1080p WEB-DL files as 2160p).
 */

import NetInfo from "@react-native-community/netinfo";
import type { StreamLink } from "../components/player/streamTypes";
import { getCachedSpeed } from "./networkSpeedTest";

const QUALITY_ORDER = ["8k", "4k", "1080p", "720p", "480p"] as const;

export type LinkLanguage = "multi" | "hindi" | "english";
type LanguageTier = LinkLanguage | "unknown";

const LANGUAGE_ORDER: LanguageTier[] = ["multi", "hindi", "english", "unknown"];

export type PreferredLanguage = "auto" | "multi" | "hindi" | "english";

export const CDN_RANK: Record<string, number> = {
  fslv2: 1,
  r2: 1,
  fsl: 2,
  "10gbps": 3,
  pixeldrain: 4,
  hubcloud: 5,
  bunker: 6,
  lenin: 7,
  unknown: 99,
};

/** Honest size floors — a 100 MB "1080p" is a broken encode, not a lightweight one. */
const MIN_SIZE_MB: Record<string, number> = {
  "480p": 80,
  "720p": 200,
  "1080p": 500,
  "4k": 1500,
  "8k": 4000,
};

/**
 * Use at most 35% of measured bandwidth for the stream's average bitrate.
 * This leaves 65% headroom for seek bursts and TCP overhead.
 * At 10 Mbps → target max bitrate ≈ 3.5 Mbps → ~1.9 GB for a 2h movie.
 * Previously 0.7 (70%), which allowed 5.85 GB on 10 Mbps — far too high.
 */
const SEEK_HEADROOM = 0.35;
const DEFAULT_SPEED_MBPS = 10; // assumed when no speed test has run yet
const CDN_SIZE_TOLERANCE = 1.25; // lighter must be ≥25% lighter to beat a faster CDN
const DEFAULT_RUNTIME_MINUTES = 120;
const TV_RUNTIME_MINUTES = 45;

const LANGUAGE_PATTERNS = {
  hindi: [
    /\bhin(di)?[\s._-]/i,
    /\bhindi\b/i,
    /\bhin\.\b/i,
    /\bhin-/i,
    /\bhindi[-_]?(cleaned|ce|esub)?/i,
    /\bhc\b/i, // Hindi-Cleaned
  ],
  multi: [
    /\bmulti[\s._-]?line\b/i,
    /\bmulti\b/i,
    /\bmls\b/i,
    /\bdual[\s._-]?line\b/i,
    /\bdl\b/i,
    /\bdual\b/i,
    /\bhin\.eng\b/i,
    /\bhindi.*english/i,
    /\beng.*hin/i,
  ],
  english: [
    /\beng(lish)?[\s._-]/i,
    /\benglish\b/i,
    /\beng\.\b/i,
    /\beng-/i,
    /\beng\.proper\b/i,
  ],
};

/** Parse the languages advertised in a release name. */
export function parseLinkLanguages(name: string): LinkLanguage[] {
  const langs: LinkLanguage[] = [];
  const lower = name.toLowerCase();
  if (LANGUAGE_PATTERNS.multi.some((p) => p.test(lower))) langs.push("multi");
  if (LANGUAGE_PATTERNS.hindi.some((p) => p.test(lower))) langs.push("hindi");
  if (LANGUAGE_PATTERNS.english.some((p) => p.test(lower)))
    langs.push("english");
  return langs;
}

/** Legacy badge helper (uppercase labels) kept for existing callers. */
export function parseLanguages(name: string): string[] {
  return parseLinkLanguages(name).map((l) => l.toUpperCase());
}

function detectLanguage(name: string): LanguageTier {
  if (LANGUAGE_PATTERNS.multi.some((p) => p.test(name.toLowerCase())))
    return "multi";
  if (LANGUAGE_PATTERNS.hindi.some((p) => p.test(name.toLowerCase())))
    return "hindi";
  if (LANGUAGE_PATTERNS.english.some((p) => p.test(name.toLowerCase())))
    return "english";
  return "unknown";
}

export function extractCDN(name: string, url: string = ""): string {
  const lowerName = name.toLowerCase();
  const lowerUrl = url.toLowerCase();

  if (
    lowerName.includes("fslv2") ||
    lowerUrl.includes("r2.dev") ||
    lowerUrl.includes("r2.cloudflarestorage") ||
    lowerName.includes("r2")
  )
    return "r2";
  if (lowerName.includes("fsl") || lowerUrl.includes("fsl")) return "fsl";
  if (lowerName.includes("10gbps") || lowerUrl.includes("10gbps"))
    return "10gbps";
  if (lowerName.includes("pixeldrain") || lowerUrl.includes("pixeldrain"))
    return "pixeldrain";
  if (
    lowerName.includes("hubcloud") ||
    lowerUrl.includes("hubcloud") ||
    lowerUrl.includes("gpdl")
  )
    return "hubcloud";
  if (lowerName.includes("bunker") || lowerUrl.includes("bunker"))
    return "bunker";
  if (lowerUrl.includes("lenin.buzz") || lowerName.includes("lenin"))
    return "lenin";

  const match = name.match(/^\[(FSLv2|FSL|PixelDrain|10Gbps|HubCloud|Bunker)/i);
  return match ? match[1].toLowerCase() : "unknown";
}

/**
 * Quality from the FILENAME first, API field as fallback.
 * The API labels 1080p WEB-DL files "2160p" — trust the release name.
 */
function effectiveQuality(link: StreamLink): string {
  const nameMatch =
    link.name.match(/\b(2160p|1080p|720p|480p|360p)\b/i) ??
    link.name.match(/\b4k\b/i);
  if (nameMatch) {
    const raw = nameMatch[1] ?? nameMatch[0];
    const mapped = raw.toLowerCase() === "2160p" ? "4k" : raw.toLowerCase();
    if ((QUALITY_ORDER as readonly string[]).includes(mapped)) return mapped;
  }
  const lower = link.quality.toLowerCase();
  for (const q of QUALITY_ORDER) {
    if (lower.includes(q)) return q;
  }
  return lower.replace(/\s.*/, "");
}

function qualityIndex(link: StreamLink): number {
  const q = effectiveQuality(link);
  const idx = (QUALITY_ORDER as readonly string[]).indexOf(q);
  return idx >= 0 ? idx : QUALITY_ORDER.length;
}

/**
 * Download-only detection — the server's flag misses "[10Gbps Download Only]"
 * (its regex expects a literal pipe), so detect from the name/URL too.
 */
export function isDownloadOnlyLink(link: StreamLink): boolean {
  if (link._meta?.isDownloadOnly) return true;
  if (/download[\s._-]*only/i.test(link.name)) return true;
  if (/download[\s._-]*only/i.test(link.quality)) return true;
  if (/gpdl|\/download\b/i.test(link.url)) return true;
  return false;
}

/** Cam/telesync prints — noticeably worse than WEB-DL/BluRay at the same size. */
export function isCamPrint(link: StreamLink): boolean {
  return /\b(hdtc|hdts|camrip|telesync|screener)\b|\bcam\b/i.test(link.name);
}

/**
 * Promotional / fake links — short clips disguised as full episodes.
 * Pattern: "360p | MovieBox/Sunny\nNative App Stream (MP4)" or similar.
 * These never contain real content; filter them unconditionally.
 */
function isPromotionalLink(link: StreamLink): boolean {
  const name = link.name || "";
  if (/Native App Stream/i.test(name)) return true;
  if (/MovieBox|Sunny/i.test(name) && /360[pP]/i.test(link.quality))
    return true;
  return false;
}

/** true when the link plays without the custom MKV extractor (mp4/webm/ts). */
function isWebPlayable(link: StreamLink): boolean {
  if (link.type === "mkv") return false;
  const nameUrl = `${link.name} ${link.url}`.toLowerCase();
  if (/\.mkv\b|matroska/i.test(nameUrl)) return false;
  return true;
}

/** Short container label for UI badges ("MP4" | "MKV" | "WEBM" | "TS"). */
export function linkContainerLabel(link: StreamLink): string {
  const nameUrl = `${link.name} ${link.url}`.toLowerCase();
  if (link.type === "mkv" || /\.mkv\b|matroska/i.test(nameUrl)) return "MKV";
  if (link.type === "webm" || /\.webm\b/i.test(nameUrl)) return "WEBM";
  if (/\.ts\b|mpegts|\.m2ts\b/i.test(nameUrl)) return "TS";
  return "MP4";
}

export interface SelectOptions {
  maxQuality?: string | null;
  cellularMaxMB?: number;
  preferredLanguage?: PreferredLanguage;
  /** Assumed duration for bitrate math. Defaults: 45 min for TV, 120 for movies. */
  runtimeMinutes?: number;
}

export interface StreamSelection {
  bestLink: StreamLink | null;
  sortedLinks: StreamLink[];
  bestIndex: number;
  /** Human-readable explanation of why bestLink won. */
  selectionReason: string;
  /** Language tiers actually present in the final list (picker filter chips). */
  availableLanguages: LinkLanguage[];
}

/** Section label for picker grouping ("Your language", "Multi audio", …). */
export function getLanguageSection(
  link: StreamLink,
  preferredLanguage: PreferredLanguage,
): string {
  const langs = parseLinkLanguages(link.name);
  if (preferredLanguage !== "auto") {
    if (
      langs.includes(preferredLanguage as LinkLanguage) ||
      langs.includes("multi")
    ) {
      return `Your language (${preferredLanguage})`;
    }
  }
  if (langs.includes("multi")) return "Multi audio";
  if (langs.includes("hindi")) return "Hindi";
  if (langs.includes("english")) return "English";
  return "Other";
}

function cdnRankOf(link: StreamLink): number {
  return CDN_RANK[extractCDN(link.name, link.url)] ?? 99;
}

/**
 * Parse a human-readable size string like "8.2 GB" or "850 MB" → bytes.
 * Returns 0 if no size info found.
 */
function parseSizeText(text: string): number {
  const m = text.match(/([\d.,]+)\s*(gb|mb|tb)\b/i);
  if (!m) return 0;
  const num = parseFloat(m[1].replace(",", ""));
  if (isNaN(num) || num <= 0) return 0;
  const unit = m[2].toLowerCase();
  if (unit === "tb") return num * 1024 * 1024 * 1024 * 1024;
  if (unit === "gb") return num * 1024 * 1024 * 1024;
  if (unit === "mb") return num * 1024 * 1024;
  return 0;
}

/**
 * Get file size in bytes. Checks _meta.sizeBytes first, then parses
 * the human-readable `size` field (e.g. "8.2 GB"), then tries the
 * `name` field as a last resort. Returns 0 only if truly unknown.
 */
function sizeOf(link: StreamLink): number {
  // 1. Structured metadata (most reliable when present)
  if (link._meta?.sizeBytes && link._meta.sizeBytes > 0)
    return link._meta.sizeBytes;
  // 2. Human-readable size field like "8.2 GB"
  if (link.size) {
    const parsed = parseSizeText(link.size);
    if (parsed > 0) return parsed;
  }
  // 3. Size embedded in filename, e.g. "Movie.1080p.HEVC.1.8GB.mkv"
  const fromName = parseSizeText(link.name);
  if (fromName > 0) return fromName;
  return 0;
}

function describe(link: StreamLink, bucketLabel: string): string {
  const parts = [
    effectiveQuality(link).toUpperCase(),
    linkContainerLabel(link),
    bucketLabel,
  ];
  const gb = sizeOf(link) / 1e9;
  if (gb > 0) parts.push(`${gb.toFixed(1)} GB`);
  const cdn = extractCDN(link.name, link.url);
  if (cdn !== "unknown" && (CDN_RANK[cdn] ?? 99) <= 3) parts.push("fast CDN");
  return parts.join(" · ");
}

/**
 * Main entry — instant (NetInfo + cached speed only, no probing).
 */
export async function selectBestStream(
  links: StreamLink[],
  options: SelectOptions = {},
): Promise<StreamSelection> {
  const {
    maxQuality = null,
    cellularMaxMB = 3000,
    preferredLanguage = "auto",
    runtimeMinutes,
  } = options;

  const noSelection: StreamSelection = {
    bestLink: links[0] ?? null,
    sortedLinks: links,
    bestIndex: 0,
    selectionReason: "",
    availableLanguages: [],
  };

  // ── Pass 1: hard filters ──
  let filtered = links.filter((link) => {
    if (/\bsample\b/i.test(link.name)) return false;
    if (isPromotionalLink(link)) return false;
    if (isDownloadOnlyLink(link)) return false;
    const sizeMB = sizeOf(link) / (1024 * 1024);
    const minMB = MIN_SIZE_MB[effectiveQuality(link)] ?? 200;
    if (sizeMB > 0 && sizeMB < minMB) return false;
    return true;
  });

  if (filtered.length === 0) {
    return {
      ...noSelection,
      bestLink: links[0] ?? null,
      sortedLinks: [],
      bestIndex: 0,
    };
  }

  // ── Pass 2: network ceiling (user cap, cellular data cap) ──
  const netInfo = await NetInfo.fetch();
  const isCellular = netInfo.type === "cellular";
  const cellularMaxBytes = cellularMaxMB * 1024 * 1024;

  filtered = filtered.filter((link) => {
    const q = effectiveQuality(link);
    if (q === "8k") return false; // never auto-play 8K
    if (maxQuality) {
      const maxQIdx = (QUALITY_ORDER as readonly string[]).indexOf(
        maxQuality.toLowerCase(),
      );
      if (maxQIdx >= 0 && qualityIndex(link) < maxQIdx) return false;
    }
    if (isCellular) {
      if (sizeOf(link) > cellularMaxBytes) return false;
      if (q === "4k") return false; // never 4K on cellular
    }
    return true;
  });

  if (filtered.length === 0) {
    return {
      ...noSelection,
      bestLink: links[0] ?? null,
      sortedLinks: links,
      bestIndex: 0,
    };
  }

  // ── Pass 3: language bucket ──
  // "preferred" is a virtual bucket: any link carrying the user's language
  // OR "Multi" (which carries every language) belongs to it.
  type Bucket = LanguageTier | "preferred";
  const bucketOrder: Bucket[] =
    preferredLanguage !== "auto"
      ? ["preferred", ...LANGUAGE_ORDER]
      : LANGUAGE_ORDER;

  const bucketOf = (link: StreamLink): Bucket => {
    const langs = parseLinkLanguages(link.name);
    if (preferredLanguage !== "auto") {
      if (
        langs.includes(preferredLanguage as LinkLanguage) ||
        langs.includes("multi")
      ) {
        return "preferred";
      }
    }
    if (langs.includes("multi")) return "multi";
    if (langs.includes("hindi")) return "hindi";
    if (langs.includes("english")) return "english";
    return "unknown";
  };

  const buckets = new Map<Bucket, StreamLink[]>();
  filtered.forEach((link) => {
    const b = bucketOf(link);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b)!.push(link);
  });

  let tierLinks: StreamLink[] = filtered;
  let bucketLabel = "Multi audio";
  for (const b of bucketOrder) {
    const group = buckets.get(b);
    if (group && group.length > 0) {
      tierLinks = group;
      bucketLabel =
        b === "preferred"
          ? `Your language (${preferredLanguage})`
          : b === "unknown"
            ? "Other"
            : `${b[0].toUpperCase()}${b.slice(1)} audio`;
      break;
    }
  }

  // ── Pass 4: quality tier that fits the connection ──
  const cachedSpeed = await getCachedSpeed();
  const speedMbps =
    cachedSpeed?.speedMbps ?? (isCellular ? 4 : DEFAULT_SPEED_MBPS);
  const runtime = runtimeMinutes ?? DEFAULT_RUNTIME_MINUTES;
  const capBytes = (speedMbps * SEEK_HEADROOM * 1_000_000 * runtime * 60) / 8;

  const tiers = new Map<number, StreamLink[]>();
  tierLinks.forEach((link) => {
    const q = qualityIndex(link);
    if (!tiers.has(q)) tiers.set(q, []);
    tiers.get(q)!.push(link);
  });

  let chosenTier: StreamLink[] | null = null;
  // Best quality first (lower index = better). 480p (last index) only as a
  // last resort — never preferred while anything larger fits.
  const tierKeys = [...tiers.keys()].sort((a, b) => a - b);
  const autoPlayable = tierKeys.filter((k) => QUALITY_ORDER[k] !== "480p");

  // First pass: pick the best tier where at least one KNOWN-SIZE link fits.
  for (const key of [
    ...autoPlayable,
    ...tierKeys.filter((k) => !autoPlayable.includes(k)),
  ]) {
    const tier = tiers.get(key)!;
    const knownAndFitting = tier.filter((l) => {
      const sz = sizeOf(l);
      return sz > 0 && sz <= capBytes;
    });
    if (knownAndFitting.length > 0) {
      chosenTier = knownAndFitting;
      break;
    }
  }

  // Second pass: if no known-size link fits, try tiers with unknown-size links
  // (risky — they might be huge, but it's all we have).
  if (!chosenTier) {
    for (const key of [
      ...autoPlayable,
      ...tierKeys.filter((k) => !autoPlayable.includes(k)),
    ]) {
      const tier = tiers.get(key)!;
      const unknownSizeLinks = tier.filter((l) => sizeOf(l) === 0);
      if (unknownSizeLinks.length > 0) {
        chosenTier = unknownSizeLinks;
        break;
      }
    }
  }
  if (!chosenTier) {
    // Nothing fits the cap — pick the tier with the lightest file anyway.
    let bestKey = tierKeys[0];
    let bestSize = Infinity;
    for (const key of tierKeys) {
      const lightest = Math.min(...tiers.get(key)!.map(sizeOf));
      if (lightest < bestSize) {
        bestSize = lightest;
        bestKey = key;
      }
    }
    const fallbackTier = tiers.get(bestKey)!;
    const lightest = Math.min(...fallbackTier.map(sizeOf));
    chosenTier = fallbackTier.filter(
      (l) => sizeOf(l) === 0 || sizeOf(l) <= lightest * 1.5,
    );
  }

  // ── Pass 5: champion within the tier ──
  const clean = chosenTier.filter((l) => !isCamPrint(l));
  const pool = clean.length > 0 ? clean : chosenTier;

  pool.sort((a, b) => {
    const sa = sizeOf(a);
    const sb = sizeOf(b);
    if (sa !== sb) return sa - sb;
    const ca = cdnRankOf(a);
    const cb = cdnRankOf(b);
    if (ca !== cb) return ca - cb;
    // Equal size + CDN: HEVC wins (same bytes, better picture)
    const aHevc = a._meta?.codec === "hevc" ? 0 : 1;
    const bHevc = b._meta?.codec === "hevc" ? 0 : 1;
    return aHevc - bHevc;
  });

  // CDN tolerance: walk from lightest to heaviest; a faster CDN wins only
  // while the file is within +25% of the lightest AND fits within capBytes.
  let champion = pool[0];
  for (const candidate of pool) {
    const candSize = sizeOf(candidate);
    const champSize = sizeOf(champion);
    if (
      cdnRankOf(candidate) < cdnRankOf(champion) &&
      candSize > 0 && // don't let unknown-size links beat a known-size champion
      candSize <= champSize * CDN_SIZE_TOLERANCE &&
      candSize <= capBytes
    ) {
      champion = candidate;
    }
  }

  // ── Picker list: bucket order → quality → lightest → CDN ──
  const bucketIndexOf = (link: StreamLink) =>
    bucketOrder.indexOf(bucketOf(link));
  const sortedLinks = [...filtered].sort((a, b) => {
    const ba = bucketIndexOf(a);
    const bb = bucketIndexOf(b);
    if (ba !== bb) return ba - bb;
    const qa = qualityIndex(a);
    const qb = qualityIndex(b);
    if (qa !== qb) return qa - qb;
    const sa = sizeOf(a);
    const sb = sizeOf(b);
    if (sa !== sb) return sa - sb;
    const wa = isWebPlayable(a) ? 0 : 1;
    const wb = isWebPlayable(b) ? 0 : 1;
    if (wa !== wb) return wa - wb;
    return cdnRankOf(a) - cdnRankOf(b);
  });

  const bestIndex = Math.max(0, sortedLinks.indexOf(champion));
  const availableLanguages = Array.from(
    new Set(filtered.flatMap((l) => parseLinkLanguages(l.name))),
  );

  return {
    bestLink: champion,
    sortedLinks,
    bestIndex,
    selectionReason: describe(champion, bucketLabel),
    availableLanguages,
  };
}
