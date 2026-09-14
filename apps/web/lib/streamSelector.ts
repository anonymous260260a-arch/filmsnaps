/**
 * streamSelector — Smart source selection for desktop.
 *
 * Direct port of mobile's streamSelector.ts adapted for web:
 * - Uses localStorage instead of AsyncStorage
 * - Uses navigator.connection instead of NetInfo
 * - Same 5-pass algorithm: hard filters → network ceiling → language → quality tier → champion
 */

// ── Types ─────────────────────────────────────────────────────────

export type LinkLanguage = "multi" | "hindi" | "english";
export type PreferredLanguage = "auto" | "multi" | "hindi" | "english";

export interface StreamEntry {
  quality: string;
  name: string;
  id: string;
  size?: string;
  url: string;
  type: string;
  _meta?: {
    codec: string;
    audio: string;
    source: string;
    isDownloadOnly: boolean;
    isWebReady: boolean;
    sizeBytes?: number;
  };
}

export interface SelectOptions {
  maxQuality?: string | null;
  cellularMaxMB?: number;
  preferredLanguage?: PreferredLanguage;
  runtimeMinutes?: number;
}

export interface StreamSelection {
  bestLink: StreamEntry;
  sortedLinks: StreamEntry[];
  bestIndex: number;
  selectionReason: string;
  availableLanguages: LinkLanguage[];
}

// ── Constants ─────────────────────────────────────────────────────

const QUALITY_ORDER = ["8k", "4k", "1080p", "720p", "480p"];
const LANGUAGE_ORDER: LinkLanguage[] = ["multi", "hindi", "english"];
const CDN_RANK: Record<string, number> = {
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
const MIN_SIZE_MB: Record<string, number> = {
  "480p": 80,
  "720p": 200,
  "1080p": 500,
  "4k": 1500,
  "8k": 4000,
};
const CDN_SIZE_TOLERANCE = 1.25;
const DEFAULT_SPEED_MBPS = 10;
const CELLULAR_SPEED_MBPS = 4;

// ── Helpers ───────────────────────────────────────────────────────

export function effectiveQuality(link: StreamEntry): string {
  const name = link.name || "";
  const q = link.quality || "";
  const combined = `${name} ${q}`;

  // Try filename first (more reliable than API quality field)
  const m = combined.match(/(2160p|1080p|720p|480p|360p)/i);
  if (m) {
    const raw = m[1].toLowerCase();
    if (raw === "2160p") return "4k";
    if (QUALITY_ORDER.includes(raw)) return raw;
  }
  if (/\b4k\b/i.test(combined)) return "4k";

  // Fallback: check quality field
  const ql = q.toLowerCase();
  for (const qo of QUALITY_ORDER) {
    if (ql.includes(qo)) return qo;
  }

  return "unknown";
}

function qualityIndex(q: string): number {
  const idx = QUALITY_ORDER.indexOf(q);
  return idx >= 0 ? idx : QUALITY_ORDER.length;
}

export function sizeOf(link: StreamEntry): number {
  // 1. Structured bytes
  if (link._meta?.sizeBytes && link._meta.sizeBytes > 0)
    return link._meta.sizeBytes;
  // 2. size field
  if (link.size) {
    const parsed = parseSizeText(link.size);
    if (parsed > 0) return parsed;
  }
  // 3. Name
  if (link.name) {
    const parsed = parseSizeText(link.name);
    if (parsed > 0) return parsed;
  }
  return 0;
}

function parseSizeText(text: string): number {
  const m = text.match(/([\d.]+)\s*(GB|MB|KB|TB)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  if (unit === "TB") return Math.round(n * 1024 * 1024 * 1024 * 1024);
  if (unit === "GB") return Math.round(n * 1024 * 1024 * 1024);
  if (unit === "MB") return Math.round(n * 1024 * 1024);
  return Math.round(n * 1024);
}

export function parseLinkLanguages(name: string): LinkLanguage[] {
  const lower = name.toLowerCase();
  const langs: LinkLanguage[] = [];

  // Multi detection
  if (
    /multi|mls|dual\s*line|\bdl\b|dual|hin[\s.]?eng|hindi.*english|eng.*hindi/i.test(
      lower,
    )
  ) {
    langs.push("multi");
  }
  // Hindi detection
  if (/\bhin(di)?\b|hindi|hin[\s.\-]|hc\b/i.test(lower)) {
    langs.push("hindi");
  }
  // English detection
  if (/\beng(lish)?\b|english|eng[\s.\-]/i.test(lower)) {
    langs.push("english");
  }

  return langs.length > 0 ? langs : ["multi"]; // Default to multi if no language detected
}

export function extractCDN(name: string, url: string): string {
  const combined = `${name} ${url}`.toLowerCase();
  for (const cdn of Object.keys(CDN_RANK)) {
    if (cdn !== "unknown" && combined.includes(cdn)) return cdn;
  }
  return "unknown";
}

function cdnRankOf(link: StreamEntry): number {
  return CDN_RANK[extractCDN(link.name, link.url)] ?? 99;
}

export function isDownloadOnlyLink(link: StreamEntry): boolean {
  if (link._meta?.isDownloadOnly) return true;
  const combined = `${link.name} ${link.quality}`.toLowerCase();
  if (/download[\s._-]*only/i.test(combined)) return true;
  if (/gpdl|\/download/i.test(link.url)) return true;
  return false;
}

export function isCamPrint(link: StreamEntry): boolean {
  return /\b(hdtc|hdts|camrip|telesync|screener)\b|\bcam\b/i.test(link.name);
}

export function linkContainerLabel(link: StreamEntry): string {
  const name = link.name.toLowerCase();
  const type = link.type?.toLowerCase() || "";
  if (name.includes(".mkv") || type === "mkv") return "MKV";
  if (name.includes(".webm") || type === "webm") return "WEBM";
  if (name.includes(".ts") || type === "ts") return "TS";
  return "MP4";
}

function isPromotionalLink(link: StreamEntry): boolean {
  if (/Native App Stream/i.test(link.name)) return true;
  if (/MovieBox|Sunny/i.test(link.name) && /360p/i.test(link.quality))
    return true;
  return false;
}

// ── Network speed (cached, non-blocking) ──────────────────────────

function getCachedSpeed(): number | null {
  try {
    const raw = localStorage.getItem("@filmsnaps/network-speed");
    if (!raw) return null;
    const data = JSON.parse(raw) as {
      speed: number;
      timestamp: number;
      type: string;
    };
    if (Date.now() - data.timestamp > 24 * 60 * 60 * 1000) {
      localStorage.removeItem("@filmsnaps/network-speed");
      return null;
    }
    return data.speed;
  } catch {
    return null;
  }
}

function getNetworkType(): "wifi" | "cellular" {
  try {
    const conn = (navigator as any).connection;
    if (conn?.type === "wifi" || conn?.type === "ethernet") return "wifi";
    if (
      conn?.type === "cellular" ||
      conn?.type === "slow-2g" ||
      conn?.type === "2g" ||
      conn?.type === "3g" ||
      conn?.type === "4g"
    )
      return "cellular";
  } catch {}
  return "wifi"; // Default to wifi on desktop
}

// ── Main: 5-Pass Algorithm ────────────────────────────────────────

export function selectBestStream(
  links: StreamEntry[],
  options: SelectOptions = {},
): StreamSelection {
  const {
    maxQuality = null,
    cellularMaxMB = 3000,
    preferredLanguage = "auto",
    runtimeMinutes = 120,
  } = options;

  const isCellular = getNetworkType() === "cellular";
  const cellularMaxBytes = cellularMaxMB * 1024 * 1024;
  const networkSpeed =
    getCachedSpeed() ?? (isCellular ? CELLULAR_SPEED_MBPS : DEFAULT_SPEED_MBPS);

  // ── Pass 1: Hard Filters ──
  let pool = links.filter((link) => {
    if (/\bsample\b/i.test(link.name)) return false;
    if (isPromotionalLink(link)) return false;
    if (isDownloadOnlyLink(link)) return false;

    const q = effectiveQuality(link);
    const sz = sizeOf(link);
    const minMb = MIN_SIZE_MB[q];
    if (minMb && sz > 0 && sz / (1024 * 1024) < minMb) return false;

    return true;
  });

  if (pool.length === 0) pool = links.slice(0, 1); // Fallback to first link

  // ── Pass 2: Network Ceiling ──
  const capBytes = (networkSpeed * 0.35 * 1_000_000 * runtimeMinutes * 60) / 8;

  let ceilingPool = pool.filter((link) => {
    const q = effectiveQuality(link);
    if (q === "8k") return false;
    if (maxQuality) {
      const capIdx = qualityIndex(maxQuality);
      if (qualityIndex(q) < capIdx) return false;
    }
    if (isCellular) {
      const sz = sizeOf(link);
      if (sz > 0 && sz > cellularMaxBytes) return false;
      if (q === "4k") return false;
    }
    return true;
  });

  if (ceilingPool.length === 0) ceilingPool = pool;

  // ── Pass 3: Language Bucket ──
  const buckets: Record<string, StreamEntry[]> = {
    multi: [],
    hindi: [],
    english: [],
    unknown: [],
    preferred: [],
  };

  for (const link of ceilingPool) {
    const langs = parseLinkLanguages(link.name);
    const isPreferred =
      preferredLanguage !== "auto" &&
      langs.includes(preferredLanguage as LinkLanguage);

    if (isPreferred) {
      buckets.preferred.push(link);
    } else if (langs.includes("multi")) {
      buckets.multi.push(link);
    } else if (langs.includes("hindi")) {
      buckets.hindi.push(link);
    } else if (langs.includes("english")) {
      buckets.english.push(link);
    } else {
      buckets.unknown.push(link);
    }
  }

  const bucketOrder =
    preferredLanguage !== "auto"
      ? ["preferred", "multi", "hindi", "english", "unknown"]
      : ["multi", "hindi", "english", "unknown"];

  let langPool: StreamEntry[] = [];
  for (const key of bucketOrder) {
    if (buckets[key].length > 0) {
      langPool = buckets[key];
      break;
    }
  }
  if (langPool.length === 0) langPool = ceilingPool;

  // ── Pass 4: Quality Tier Selection ──
  const tiers = new Map<number, StreamEntry[]>();
  for (const link of langPool) {
    const qi = qualityIndex(effectiveQuality(link));
    if (!tiers.has(qi)) tiers.set(qi, []);
    tiers.get(qi)!.push(link);
  }

  const tierKeys = Array.from(tiers.keys()).sort((a, b) => a - b);
  // Deprioritize 480p — try it last
  const non480 = tierKeys.filter((k) => QUALITY_ORDER[k] !== "480p");
  const only480 = tierKeys.filter((k) => QUALITY_ORDER[k] === "480p");
  const orderedTiers = [...non480, ...only480];

  let tierPool: StreamEntry[] | null = null;

  // 4a: Known-size links that fit the cap
  for (const qi of orderedTiers) {
    const candidates = tiers.get(qi)!.filter((l) => {
      const sz = sizeOf(l);
      return sz > 0 && sz <= capBytes;
    });
    if (candidates.length > 0) {
      tierPool = candidates;
      break;
    }
  }

  // 4b: Unknown-size links
  if (!tierPool) {
    for (const qi of orderedTiers) {
      const candidates = tiers.get(qi)!.filter((l) => sizeOf(l) === 0);
      if (candidates.length > 0) {
        tierPool = candidates;
        break;
      }
    }
  }

  // 4c: Last resort — lightest tier
  if (!tierPool) {
    let lightestSize = Infinity;
    let lightestTier: StreamEntry[] = [];
    for (const qi of orderedTiers) {
      const links = tiers.get(qi)!;
      const minSize = Math.min(
        ...links.map((l) => sizeOf(l)).filter((s) => s > 0),
      );
      if (minSize < lightestSize) {
        lightestSize = minSize;
        lightestTier = links;
      }
    }
    tierPool = lightestTier.filter((l) => {
      const sz = sizeOf(l);
      return sz === 0 || sz <= lightestSize * 1.5;
    });
  }

  if (!tierPool || tierPool.length === 0) tierPool = langPool;

  // ── Pass 5: Champion Within Tier ──
  // Remove cam prints (unless all are cam)
  let championPool = tierPool.filter((l) => !isCamPrint(l));
  if (championPool.length === 0) championPool = tierPool;

  // Sort: lightest first, then fastest CDN, then HEVC bonus
  championPool.sort((a, b) => {
    const sizeA = sizeOf(a);
    const sizeB = sizeOf(b);
    if (sizeA !== sizeB) return sizeA - sizeB;
    const cdnA = cdnRankOf(a);
    const cdnB = cdnRankOf(b);
    if (cdnA !== cdnB) return cdnA - cdnB;
    const hevcA = a._meta?.codec === "hevc" ? 0 : 1;
    const hevcB = b._meta?.codec === "hevc" ? 0 : 1;
    return hevcA - hevcB;
  });

  // CDN tolerance walk — faster CDN replaces champion if within 25% size
  let champion = championPool[0];
  for (let i = 1; i < championPool.length; i++) {
    const candidate = championPool[i];
    const candRank = cdnRankOf(candidate);
    const champRank = cdnRankOf(champion);
    const candSize = sizeOf(candidate);
    const champSize = sizeOf(champion);

    if (
      candRank < champRank &&
      candSize > 0 &&
      candSize <= champSize * CDN_SIZE_TOLERANCE &&
      candSize <= capBytes
    ) {
      champion = candidate;
    }
  }

  // ── Build sorted picker list ──
  const sortedLinks = [...ceilingPool].sort((a, b) => {
    const aLangs = parseLinkLanguages(a.name);
    const bLangs = parseLinkLanguages(b.name);
    const aLangIdx = aLangs.some((l) => l === preferredLanguage)
      ? 0
      : LANGUAGE_ORDER.indexOf(aLangs[0] ?? "english");
    const bLangIdx = bLangs.some((l) => l === preferredLanguage)
      ? 0
      : LANGUAGE_ORDER.indexOf(bLangs[0] ?? "english");
    if (aLangIdx !== bLangIdx) return aLangIdx - bLangIdx;

    const aQi = qualityIndex(effectiveQuality(a));
    const bQi = qualityIndex(effectiveQuality(b));
    if (aQi !== bQi) return aQi - bQi;

    return sizeOf(a) - sizeOf(b);
  });

  const bestIndex = links.findIndex((l) => l.id === champion.id);
  const availableLanguages = Array.from(
    new Set(langPool.flatMap((l) => parseLinkLanguages(l.name))),
  );

  return {
    bestLink: champion,
    sortedLinks,
    bestIndex: bestIndex >= 0 ? bestIndex : 0,
    selectionReason: `${effectiveQuality(champion)} · ${linkContainerLabel(champion)} · ${extractCDN(champion.name, champion.url)}`,
    availableLanguages,
  };
}

// ── Source Remembering (localStorage) ─────────────────────────────

const SOURCE_STORAGE_KEY = "@filmsnaps/last-source/v1";
const SOURCE_TTL_DAYS = 30;

export function rememberWorkingSource(
  mediaType: string,
  tmdbId: string,
  url: string,
): void {
  try {
    const key = `${SOURCE_STORAGE_KEY}:${mediaType}:${tmdbId}`;
    const urlKey = url.split("?")[0]; // Strip query string (presigned tokens expire)
    localStorage.setItem(key, JSON.stringify({ urlKey, at: Date.now() }));
  } catch {}
}

export function getLastWorkingSource(
  mediaType: string,
  tmdbId: string,
): string | null {
  try {
    const key = `${SOURCE_STORAGE_KEY}:${mediaType}:${tmdbId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as { urlKey: string; at: number };
    if (Date.now() - data.at > SOURCE_TTL_DAYS * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(key);
      return null;
    }
    return data.urlKey;
  } catch {
    return null;
  }
}

export function forgetWorkingSource(mediaType: string, tmdbId: string): void {
  try {
    const key = `${SOURCE_STORAGE_KEY}:${mediaType}:${tmdbId}`;
    localStorage.removeItem(key);
  } catch {}
}

/**
 * If a link was remembered as working but is now failing, forget it.
 */
export function forgetIfRemembered(
  mediaType: string,
  tmdbId: string,
  url: string,
  rememberedKey: string | null,
): void {
  if (!rememberedKey) return;
  const urlKey = url.split("?")[0];
  if (urlKey === rememberedKey) {
    forgetWorkingSource(mediaType, tmdbId);
  }
}
