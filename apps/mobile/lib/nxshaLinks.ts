/**
 * Nxsha link parsing — fed by the main-process API path (structured
 * {url, label, orgUri} tuples; see docs/nxsha-download-api-findings.md),
 * with graceful degradation for labels scraped by the hidden-window fallback.
 *
 * Two label dialects exist in the wild:
 *   • mbox:      "Hindi dub : 1080", "Arabic sub : 480"   (<lang> <dub|sub> : <height>)
 *   • hdhub4u / k4khdhub (pipe-separated):
 *                "66.39 GB | 2160p | Hindi | English | DTS | BluRay | x265 | HEVC"
 *                "720p 1.5 GB | Hindi | English | Bluray | x264"   (size rides with quality)
 *                " 1.5 GB | …"                                     (quality missing)
 *                "1080p "                                          (size+extras missing)
 *
 * Links are also classified as DIRECT (enqueueable file URL) vs GATEWAY
 * (hubcloud landing pages that merely host a download button) so the UI can
 * offer Download vs Open-in-browser instead of downloading HTML files.
 */

export interface NxshaLink {
  url: string;
  label: string;
  /** Original (unwrapped) URL from the API path — often the real direct file. */
  orgUri?: string;
  provider?: string;
}

export interface NxshaServer {
  name: string;
  links: NxshaLink[];
}

export interface ParsedLink extends NxshaLink {
  /** Owning server name (filled by parseLinks). */
  server: string;
  quality: string;
  qualityRank: number;
  /** Human size ("2.9 GB") parsed from the label; "" when absent. */
  size: string;
  /** Size in bytes for sorting (0 = unknown). */
  sizeBytes: number;
  /** Languages parsed from the label ("Hindi", "English", "ptbr"…). */
  langs: string[];
  /** mbox-dialect audio tag ("Hindi dub"); "" for pipe labels. */
  audioLabel: string;
  audioPriority: number;
  /** Leftover pipe tokens worth showing as chips ("x265", "HEVC", "BluRay"). */
  extras: string[];
  /** Best-guess file name (R2 disposition or final URL path). */
  filename: string;
  /** The URL we actually hand to the downloader (prefers orgUri). */
  downloadUrl: string;
  /** True when downloadUrl points at a file we can enqueue directly. */
  isDirect: boolean;
  /** Mirrors collapsed into this row by label-dedup (1 = unique). */
  mirrorCount: number;
}

const QUALITY_RANK: Record<string, number> = {
  "2160p": 0,
  "4k": 0,
  "1440p": 0.5,
  "1080p": 1,
  fhd: 1,
  "720p": 2,
  hd: 2,
  "480p": 3,
  sd: 3,
  "360p": 4,
};

/** Known release-tag tokens that are safe to surface as chips. */
const EXTRA_WHITELIST = new Set([
  "dts",
  "dts-hd",
  "dtshd",
  "truehd",
  "ddp5.1",
  "dd5.1",
  "aac",
  "ac3",
  "eac3",
  "bluray",
  "bluray remux",
  "remux",
  "web-dl",
  "webdl",
  "web",
  "webrip",
  "hdr10+",
  "hdr10",
  "hdr",
  "dv",
  "dolby",
  "10bit",
  "x264",
  "x265",
  "h264",
  "h.264",
  "hevc",
  "avc",
]);

const LANG_MAP: Record<string, string> = {
  hindi: "Hindi",
  english: "English",
  tamil: "Tamil",
  telugu: "Telugu",
  kannada: "Kannada",
  malayalam: "Malayalam",
  bengali: "Bengali",
  bangla: "Bengali",
  marathi: "Marathi",
  punjabi: "Punjabi",
  arabic: "Arabic",
  french: "French",
  russian: "Russian",
  spanish: "Spanish",
  portuguese: "Portuguese",
  ptbr: "Portuguese (BR)",
  kurdish: "Kurdish",
  ukr: "Ukrainian",
  ukranian: "Ukrainian",
  ukrainian: "Ukrainian",
  korean: "Korean",
  japanese: "Japanese",
  chinese: "Chinese",
  mandarin: "Chinese",
  german: "German",
  turkish: "Turkish",
  italian: "Italian",
};

const VIDEO_EXT_RE =
  /\.(mkv|mp4|m4v|avi|webm|mov|wmv|flv|ts|mpg|mpeg)(?:[?#]|$)/i;

// ── URL classification ─────────────────────────────────────────────

function safeUrl(u: string): URL | null {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

/** hubcloud-style landing pages — NOT enqueueable; open externally instead. */
export function isGatewayUrl(rawUrl: string): boolean {
  const u = safeUrl(rawUrl);
  if (!u) return true; // unparseable → treat as non-direct
  const host = u.hostname.toLowerCase();
  // drive/admin · pixel.hubcloud.cx/?id=… · gpdl.hubcloud.cx/?id=… · tg/go
  if (host.endsWith("hubcloud.cx")) return true;
  if (host === "pixeldrain.dev" && u.pathname.startsWith("/u/")) return true;
  return false;
}

/** True for any hubcloud origin (used to deprioritize candidates). */
function isHubcloudOrigin(rawUrl: string): boolean {
  const u = safeUrl(rawUrl);
  return !!u && u.hostname.toLowerCase().endsWith("hubcloud.cx");
}

/** A URL pointing straight at a media file we can enqueue. */
function isDirectFileUrl(rawUrl: string): boolean {
  const u = safeUrl(rawUrl);
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  if (host.includes("googleusercontent.com")) return true;
  if (host === "pixeldrain.dev" && u.pathname.startsWith("/api/file/"))
    return true;
  if (host.endsWith(".r2.cloudflarestorage.com")) return true; // presigned GET
  if (
    u.searchParams.has("response-content-disposition") &&
    VIDEO_EXT_RE.test(
      decodeURIComponent(
        u.searchParams.get("response-content-disposition") || "",
      ),
    )
  ) {
    return true;
  }
  return VIDEO_EXT_RE.test(u.pathname);
}

function dispositionFilename(rawUrl: string): string {
  const u = safeUrl(rawUrl);
  if (!u) return "";
  const cd = u.searchParams.get("response-content-disposition");
  if (!cd) return "";
  try {
    const m = decodeURIComponent(cd).match(/filename\s*=\s*"?([^";]+)"?/i);
    if (m?.[1]) return m[1].trim();
  } catch {
    // fall through
  }
  return "";
}

/** File name guess from disposition or final path segment. */
export function extractFilename(rawUrl: string): string {
  const fromCd = dispositionFilename(rawUrl);
  if (fromCd) return fromCd;
  const u = safeUrl(rawUrl);
  if (!u) return "";
  const seg = decodeURIComponent(
    u.pathname.split("/").filter(Boolean).pop() ?? "",
  );
  return VIDEO_EXT_RE.test(seg) ? seg : "";
}

/** Pick the enqueueable URL: orgUri when it beats url, else url. */
function pickDownloadUrl(link: NxshaLink): { url: string; direct: boolean } {
  const candidates = [link.orgUri, link.url].filter(Boolean) as string[];
  const directHit = candidates.find((c) => isDirectFileUrl(c));
  if (directHit) return { url: directHit, direct: true };
  // No provable file URL — prefer the non-hubcloud candidate if one exists.
  const nonHub = candidates.find((c) => !isHubcloudOrigin(c));
  const chosen = nonHub ?? candidates[0] ?? link.url;
  return { url: chosen, direct: !isGatewayUrl(chosen) };
}

// ── Label parsing ──────────────────────────────────────────────────

function normalizeLang(tok: string): string | null {
  const key = tok.toLowerCase().replace(/[^a-z]/g, "");
  return LANG_MAP[key] ?? null;
}

function parseSizeTok(tok: string): { text: string; bytes: number } | null {
  const m = tok.match(/^([\d.,]+)\s*(gb|mb)$/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const mult = m[2].toLowerCase() === "gb" ? 1024 ** 3 : 1024 ** 2;
  return { text: `${n} ${m[2].toUpperCase()}`, bytes: Math.round(n * mult) };
}

export function parseLabel(
  label: string,
): Pick<
  ParsedLink,
  | "quality"
  | "qualityRank"
  | "size"
  | "sizeBytes"
  | "langs"
  | "audioLabel"
  | "audioPriority"
  | "extras"
> {
  const out = {
    quality: "",
    qualityRank: 99,
    size: "",
    sizeBytes: 0,
    langs: [] as string[],
    audioLabel: "",
    audioPriority: 5,
    extras: [] as string[],
  };
  const raw = label.trim();

  // mbox dialect: "<lang> <dub|sub> : <height>"
  const mb = raw.match(/^(.{1,32}?)\s+(dub|sub)\s*:\s*(\d{3,4})\s*p?$/i);
  if (mb) {
    const langTok = mb[1];
    const kind = mb[2].toLowerCase();
    const h = mb[3];
    out.quality = `${h}p`;
    out.qualityRank = QUALITY_RANK[out.quality] ?? 5;
    const lang = normalizeLang(langTok);
    out.audioLabel = `${lang ?? titleCase(langTok)} ${kind}`;
    out.audioPriority = rankAudio(out.audioLabel);
    if (lang) out.langs.push(lang);
    return out;
  }

  // Pipe dialect (also handles single-segment leftovers like "1080p").
  const segs = raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const seg of segs) {
    // Size either owns a segment ("66.39 GB") or rides with quality ("720p 1.5 GB")
    const inlineSize = seg.match(/([\d.,]+)\s*(gb|mb)\b/i);
    if (inlineSize && !out.size) {
      const parsed = parseSizeTok(inlineSize[0]);
      if (parsed) {
        out.size = parsed.text;
        out.sizeBytes = parsed.bytes;
      }
    }

    const qMatch = seg
      .toLowerCase()
      .match(/\b(2160p|1440p|1080p|720p|480p|360p|4k)\b/);
    if (qMatch && !out.quality) {
      const q = qMatch[1] === "4k" ? "2160p" : qMatch[1];
      out.quality = q;
      out.qualityRank = QUALITY_RANK[q] ?? 99;
    }

    const lang = normalizeLang(seg);
    if (lang) {
      if (!out.langs.includes(lang)) out.langs.push(lang);
      continue;
    }
    if (qMatch) continue; // already consumed as quality
    if (inlineSize && seg.replace(inlineSize[0], "").trim() === "") continue;

    const key = seg.toLowerCase().replace(/\s+/g, " ");
    if (EXTRA_WHITELIST.has(key)) {
      if (!out.extras.some((e) => e.toLowerCase() === key))
        out.extras.push(seg);
    }
  }

  return out;
}

function rankAudio(label: string): number {
  const l = label.toLowerCase();
  if (l.startsWith("hindi")) return 0;
  if (l.includes("dual")) return 1;
  if (l.includes("original")) return 2;
  if (l.startsWith("tamil") || l.startsWith("telugu")) return 3;
  if (l.startsWith("english")) return 4;
  return 5;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Assembly ───────────────────────────────────────────────────────

export function parseLinks(server: NxshaServer): ParsedLink[] {
  return server.links.map((link: NxshaLink) => {
    const picked = pickDownloadUrl(link);
    return {
      ...link,
      ...parseLabel(link.label || ""),
      server: server.name,
      filename: extractFilename(picked.url),
      downloadUrl: picked.url,
      isDirect: picked.direct,
      mirrorCount: 1,
    };
  });
}

export function sortParsedLinks(links: ParsedLink[]): ParsedLink[] {
  return [...links].sort((a, b) => {
    if (a.audioPriority !== b.audioPriority)
      return a.audioPriority - b.audioPriority;
    if (a.qualityRank !== b.qualityRank) return a.qualityRank - b.qualityRank;
    return b.sizeBytes - a.sizeBytes; // bigger release first within a tier
  });
}

/**
 * Collapse each server's mirror groups into single rows. k4khdhub emits every
 * release as gateway + pixel/gpdl + workers/R2 direct + pixeldrain sharing one
 * label; we keep the best (direct-first) URL and note how many mirrors hid
 * behind it. Direct rows always beat gateway rows with identical labels.
 */
export function organizeServers(
  servers: NxshaServer[],
): Array<NxshaServer & { parsed: ParsedLink[] }> {
  return servers
    .map((s) => ({ ...s, parsed: dedupeMirrors(parseLinks(s)) }))
    .sort((a, b) => {
      const aExact = a.name.includes("MbPly") ? 0 : 1;
      const bExact = b.name.includes("MbPly") ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const aMulti = a.name.toLowerCase().includes("multi-lang") ? 0 : 1;
      const bMulti = b.name.toLowerCase().includes("multi-lang") ? 0 : 1;
      if (aMulti !== bMulti) return aMulti - bMulti;
      return 0;
    });
}

/** Group by normalized label; keep the strongest row of each group. */
function dedupeMirrors(links: ParsedLink[]): ParsedLink[] {
  const groups = new Map<string, ParsedLink[]>();
  for (const l of links) {
    const key =
      l.label.toLowerCase().replace(/\s+/g, " ").trim() ||
      l.downloadUrl.slice(0, 120);
    const arr = groups.get(key);
    if (arr) arr.push(l);
    else groups.set(key, [l]);
  }
  const out: ParsedLink[] = [];
  for (const group of Array.from(groups.values())) {
    const sorted = sortParsedLinks(group);
    const best = sorted.find((l) => l.isDirect) ?? sorted[0];
    out.push({ ...best, mirrorCount: group.length });
  }
  return out;
}

/** File extension from a direct URL (falls back to mp4). */
export function getExt(url: string): string {
  const fname = extractFilename(url);
  const m = fname.match(/\.([a-z0-9]+)$/i);
  if (m) return m[1].toLowerCase();
  try {
    const p = new URL(url).pathname;
    const m2 = p.match(/\.([a-z0-9]+)(?:\?|$)/i);
    return m2 ? m2[1].toLowerCase() : "mp4";
  } catch {
    return "mp4";
  }
}
