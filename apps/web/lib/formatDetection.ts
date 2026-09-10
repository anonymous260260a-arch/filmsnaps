/**
 * Format Detection — auto-detect video container + codec from a URL.
 *
 * Priority: Content-Type header → URL extension → byte-sniffing.
 * Returns a DetectedFormat that DirectVideoPlayer uses to route to the
 * correct decoder path (native <video>, video.js VHS/DASH, or WebCodecs).
 */

export type DetectedFormatType =
  | "hls"
  | "dash"
  | "mp4"
  | "mkv"
  | "webm"
  | "avi"
  | "mpegts"
  | "unknown";

export interface DetectedFormat {
  type: DetectedFormatType;
  container: string;
  videoCodec?: string;
  audioCodec?: string;
  confidence: "high" | "medium" | "low";
}

// ── Content-Type → format mapping ───────────────────────────────────

const CONTENT_TYPE_MAP: Record<string, DetectedFormat> = {
  // HLS
  "application/vnd.apple.mpegurl": {
    type: "hls",
    container: "HLS",
    confidence: "high",
  },
  "application/x-mpegurl": {
    type: "hls",
    container: "HLS",
    confidence: "high",
  },
  "audio/mpegurl": { type: "hls", container: "HLS", confidence: "high" },

  // DASH
  "application/dash+xml": {
    type: "dash",
    container: "DASH",
    confidence: "high",
  },

  // MP4 / QuickTime
  "video/mp4": { type: "mp4", container: "MP4", confidence: "high" },
  "video/quicktime": {
    type: "mp4",
    container: "QuickTime",
    confidence: "medium",
  },

  // MPEG
  "video/mpeg": { type: "mp4", container: "MPEG", confidence: "medium" },
  "video/mpegts": { type: "mpegts", container: "MPEG-TS", confidence: "high" },

  // MKV / WebM (EBML)
  "video/x-matroska": {
    type: "mkv",
    container: "Matroska",
    confidence: "high",
  },
  "video/webm": { type: "webm", container: "WebM", confidence: "high" },

  // AVI
  "video/x-msvideo": { type: "avi", container: "AVI", confidence: "high" },

  // Fallback
  "application/octet-stream": {
    type: "unknown",
    container: "OctetStream",
    confidence: "low",
  },
};

// ── URL extension → format mapping ───────────────────────────────────

function parseUrlExtension(url: string): DetectedFormat | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    const cleanPath = path.split("?")[0];

    // Check path extension first
    let ext: string | null = null;
    if (cleanPath.endsWith(".m3u8") || cleanPath.endsWith(".m3u")) {
      ext = ".m3u8";
    } else if (cleanPath.endsWith(".mpd")) {
      ext = ".mpd";
    } else if (
      cleanPath.endsWith(".mp4") ||
      cleanPath.endsWith(".mov") ||
      cleanPath.endsWith(".m4v")
    ) {
      ext = ".mp4";
    } else if (cleanPath.endsWith(".mkv")) {
      ext = ".mkv";
    } else if (cleanPath.endsWith(".webm")) {
      ext = ".webm";
    } else if (cleanPath.endsWith(".avi")) {
      ext = ".avi";
    } else if (cleanPath.endsWith(".ts")) {
      ext = ".ts";
    }

    // Fallback: check query params (R2 signed URLs put extension in filename param)
    if (!ext) {
      const filename = parsed.searchParams.get("filename");
      if (filename) {
        const lower = filename.toLowerCase();
        if (lower.endsWith(".m3u8") || lower.endsWith(".m3u")) ext = ".m3u8";
        else if (lower.endsWith(".mpd")) ext = ".mpd";
        else if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) ext = ".mp4";
        else if (lower.endsWith(".mkv")) ext = ".mkv";
        else if (lower.endsWith(".webm")) ext = ".webm";
      }
    }

    if (ext) {
      switch (ext) {
        case ".m3u8":
        case ".m3u":
          return { type: "hls", container: "HLS", confidence: "high" };
        case ".mpd":
          return { type: "dash", container: "DASH", confidence: "high" };
        case ".mp4":
        case ".m4v":
        case ".mov":
          return { type: "mp4", container: "MP4", confidence: "high" };
        case ".mkv":
          return { type: "mkv", container: "Matroska", confidence: "high" };
        case ".webm":
          return { type: "webm", container: "WebM", confidence: "high" };
        case ".avi":
          return { type: "avi", container: "AVI", confidence: "high" };
        case ".ts":
          return { type: "mpegts", container: "MPEG-TS", confidence: "medium" };
      }
    }
  } catch {
    // Not a URL — treat as relative path
    const lower = url.toLowerCase().split("?")[0];
    if (lower.endsWith(".m3u8"))
      return { type: "hls", container: "HLS", confidence: "high" };
    if (lower.endsWith(".mpd"))
      return { type: "dash", container: "DASH", confidence: "high" };
    if (lower.endsWith(".mp4"))
      return { type: "mp4", container: "MP4", confidence: "high" };
    if (lower.endsWith(".mkv"))
      return { type: "mkv", container: "Matroska", confidence: "high" };
    if (lower.endsWith(".webm"))
      return { type: "webm", container: "WebM", confidence: "high" };
    if (lower.endsWith(".avi"))
      return { type: "avi", container: "AVI", confidence: "high" };
  }

  return null;
}

// ── Byte signatures (magic numbers) ───────────────────────────────────

const BYTE_SIGNATURES: Array<{
  type: DetectedFormatType;
  container: string;
  offset: number;
  bytes: number[];
}> = [
  // MP4 / ISO BMFF: "ftyp" at offset 4
  { type: "mp4", container: "MP4", offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }, // "ftyp"

  // MKV / WebM: EBML header [1A][45][DF][A3]
  { type: "mkv", container: "MKV", offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] },

  // HLS manifest: "#EXTM3U"
  {
    type: "hls",
    container: "HLS",
    offset: 0,
    bytes: [0x23, 0x45, 0x58, 0x54, 0x4d, 0x33, 0x55],
  }, // "#EXTM3U"

  // MPEG-TS: sync byte 0x47 at offset 0
  { type: "mpegts", container: "MPEG-TS", offset: 0, bytes: [0x47] },

  // FLV: "FLV" at offset 0
  { type: "unknown", container: "FLV", offset: 0, bytes: [0x46, 0x4c, 0x56] }, // "FLV"

  // AVI: "RIFF" at offset 0, then "AVI" at offset 8
  { type: "avi", container: "AVI", offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
];

function matchesSignature(
  bytes: Uint8Array,
  sig: { offset: number; bytes: number[] },
): boolean {
  if (bytes.length < sig.offset + sig.bytes.length) return false;
  for (let i = 0; i < sig.bytes.length; i++) {
    if (bytes[sig.offset + i] !== sig.bytes[i]) return false;
  }
  return true;
}

async function sniffBytes(url: string): Promise<DetectedFormat> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers: { Accept: "*/*" },
      signal: AbortSignal.timeout(5000),
    });

    // Some servers don't support HEAD — fall back to a range GET
    let buffer: ArrayBuffer;
    if (response.status === 405 || response.status === 400) {
      const getRes = await fetch(url, {
        headers: { Range: "bytes=0-15" },
        signal: AbortSignal.timeout(5000),
      });
      buffer = await getRes.arrayBuffer();
    } else {
      // HEAD may not give us bytes — do a small range fetch
      const rangeRes = await fetch(url, {
        headers: { Range: "bytes=0-15" },
        signal: AbortSignal.timeout(5000),
      });
      buffer = await rangeRes.arrayBuffer();
    }

    const bytes = new Uint8Array(buffer);

    for (const sig of BYTE_SIGNATURES) {
      if (matchesSignature(bytes, sig)) {
        // Distinguish MKV vs WebM: both start with EBML header
        // If we got a Content-Type of video/webm, treat as webm
        return {
          type: sig.type,
          container: sig.container,
          confidence: "high",
        };
      }
    }
  } catch (e) {
    console.warn("[formatDetection] Byte sniffing failed:", e);
  }

  return { type: "unknown", container: "unknown", confidence: "low" };
}

// ── Main detection entry point ────────────────────────────────────────

export async function detectFormat(url: string): Promise<DetectedFormat> {
  // Priority 1: Content-Type header
  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers: { Accept: "*/*" },
      signal: AbortSignal.timeout(5000),
    });

    const contentType = response.headers.get("content-type");
    if (contentType) {
      const mapped =
        CONTENT_TYPE_MAP[contentType.split(";")[0].trim().toLowerCase()];
      if (mapped && mapped.confidence === "high") {
        return mapped;
      }
    }
  } catch (e) {
    console.warn("[formatDetection] Content-Type check failed:", e);
  }

  // Priority 2: URL extension
  const urlResult = parseUrlExtension(url);
  if (urlResult && urlResult.confidence === "high") {
    return urlResult;
  }

  // Priority 3: Byte-sniffing
  const byteResult = await sniffBytes(url);

  // Fall back to URL extension even if medium confidence
  return byteResult.confidence === "high"
    ? byteResult
    : (urlResult ?? byteResult);
}

// ── Native playback capability checks ─────────────────────────────────

const HEVC_PROFILES = [
  "hev1.1.6.L93.B0",
  "hev1.1.6.L120.B0",
  "hev1.1.6.L150.B0",
  "hev1.1.6.L153.B0",
  "hev1.1.6.L156.B0",
  "hev1.1.6.L180.B0",
  "hev1.1.6.L183.B0",
  "hev1.1.6.L186.B0",
  "hev1.2.4.L93.B0",
  "hev1.2.4.L120.B0",
  "hev1.2.4.L150.B0",
  "hev1.2.4.L153.B0",
  "hev1.2.4.L156.B0",
  "hev1.2.4.L180.B0",
  "hev1.2.4.L183.B0",
  "hev1.2.4.L186.B0",
];

const AV1_PROFILES = [
  "av01.0.00M.08",
  "av01.0.01M.08",
  "av01.0.04M.08",
  "av01.0.05M.08",
  "av01.0.08M.08",
  "av01.0.09M.08",
  "av01.0.12M.08",
  "av01.0.13M.08",
  "av01.0.04M.10",
  "av01.0.08M.10",
];

// Module-level cache to avoid redundant checks
let hevcSupportCache: Promise<boolean> | null = null;
let av1SupportCache: Promise<boolean> | null = null;

export async function checkHevcSupport(): Promise<boolean> {
  if (!hevcSupportCache) {
    hevcSupportCache = (async () => {
      for (const codec of HEVC_PROFILES) {
        try {
          const support = await VideoDecoder.isConfigSupported({
            codec,
            codedWidth: 1920,
            codedHeight: 1080,
          });
          if (support.supported) return true;
        } catch {
          continue;
        }
      }

      // Fallback: check native <video> canPlayType
      const testEl = document.createElement("video");
      return (
        testEl.canPlayType('video/mp4; codecs="hev1.1.6.L150.B0"') ===
        "probably"
      );
    })();
  }
  return hevcSupportCache;
}

export async function checkAV1Support(): Promise<boolean> {
  if (!av1SupportCache) {
    av1SupportCache = (async () => {
      // Check via mediaCapabilities for hardware-accelerated AV1
      if ("mediaCapabilities" in navigator) {
        try {
          const info = await navigator.mediaCapabilities.decodingInfo({
            type: "file",
            video: {
              contentType: 'video/mp4; codecs="av01.0.08M.08"',
              width: 1920,
              height: 1080,
              bitrate: 5_000_000,
              framerate: 30,
            },
          });
          return info.supported;
        } catch {
          /* fall through to canPlayType */
        }
      }

      // Fallback
      const testEl = document.createElement("video");
      return (
        testEl.canPlayType('video/mp4; codecs="av01.0.08M.08"') === "probably"
      );
    })();
  }
  return av1SupportCache;
}

/** Returns true if running Safari (supports MKV in <video> via type="video/x-matroska"). */
export function isSafariBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /Safari/.test(navigator.userAgent || "") &&
    !/Chrome/.test(navigator.userAgent || "") &&
    !/Edg/.test(navigator.userAgent || "") &&
    !/Android/.test(navigator.userAgent || "")
  );
}

/** Check if the browser can natively play a given format/codec combo. */
export function canPlayNatively(format: DetectedFormat): boolean {
  const testEl = document.createElement("video");

  switch (format.type) {
    case "mp4":
      return (
        testEl.canPlayType('video/mp4; codecs="avc1.640028"') === "probably" ||
        testEl.canPlayType("video/mp4") === "probably"
      );
    case "webm":
      return testEl.canPlayType('video/webm; codecs="vp9"') === "probably";
    case "hls":
      // Native HLS is Safari-only; Chrome needs hls.js (VHS)
      return (
        testEl.canPlayType("application/vnd.apple.mpegurl") !== "" &&
        isSafariBrowser()
      );
    case "dash":
      // No native DASH in any browser
      return false;
    case "mkv":
      // MKV is natively supported in Safari only; Chrome/Firefox need WebCodecs
      return isSafariBrowser();
    case "avi":
    case "mpegts":
    case "unknown":
      return false;
    default:
      return false;
  }
}

/** Returns true if this is a Windows platform (HEVC hardware decode limited). */
export function isWindowsPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /Windows/.test(navigator.platform || "") ||
    /Windows/.test(navigator.userAgent || "")
  );
}

/** Returns the Chrome major version number, or null if not Chrome. */
function getChromeVersion(): number | null {
  if (typeof navigator === "undefined") return null;
  const match = navigator.userAgent.match(/Chrome\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/** Returns true if this is an Android platform (supports broader codec set). */
export function isAndroidPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/.test(navigator.userAgent || "");
}

/**
 * Check if a filename or entry name indicates HEVC encoding.
 */
export function isHevcEncoding(name: string): boolean {
  return /x265|HEVC|hevc|10bit|h\.265/i.test(name);
}

/**
 * Check if a filename or entry name indicates H.264 encoding.
 */
export function isH264Encoding(name: string): boolean {
  return !isHevcEncoding(name);
}

// ── Decoder selection ─────────────────────────────────────────────────

export type DecoderType =
  | "native"
  | "videojs"
  | "webcodecs"
  | "mpv"
  | "unsupported";

export async function selectDecoder(
  format: DetectedFormat,
  entryName?: string,
): Promise<DecoderType> {
  // 0. Desktop mpv — prefer for legacy container formats (AVI, MPEG-TS) and HEVC (x265)
  const isDesktop =
    typeof window !== "undefined" && !!(window as any).electronAPI?.mpv;
  console.log(
    `[selectDecoder] format=${format.type} entryName=${entryName?.slice(0, 40)} isDesktop=${isDesktop}`,
  );
  if (isDesktop) {
    const mpvPreferred =
      format.type === "avi" ||
      format.type === "mpegts" ||
      (entryName && isHevcEncoding(entryName));
    console.log(`[selectDecoder] mpvPreferred=${mpvPreferred}`);
    if (mpvPreferred) return "mpv";
  }

  // 1. HEVC in MKV → always WebCodecs (even native MKV not supported in <video>)
  if (format.type === "mkv" && entryName && isHevcEncoding(entryName)) {
    const supported = await checkHevcSupport();
    return supported ? "webcodecs" : "unsupported";
  }

  // 2. MKV → native on modern browsers (Chrome 130+, Firefox, Edge, Safari 18+)
  // WebCodecs fallback for very old browsers only
  if (format.type === "mkv") {
    // Chrome 130+ has full MKV support (H.264, HEVC, VP8/VP9, AV1)
    const chromeVersion = getChromeVersion();
    if (chromeVersion && chromeVersion >= 130) {
      return "native";
    }
    // Safari 18+ has full MKV support
    if (isSafariBrowser()) {
      return "native";
    }
    // Firefox and Edge: use canPlayType feature detection
    const testEl = document.createElement("video");
    if (testEl.canPlayType("video/x-matroska") !== "") {
      return "native";
    }
    // Very old browser without MKV support → WebCodecs
    return "webcodecs";
  }

  // 3. HLS → video.js with VHS (hls.js) for Chrome; native for Safari
  if (format.type === "hls") {
    if (canPlayNatively(format)) return "native";
    return "videojs";
  }

  // 4. DASH → always video.js (no native DASH support)
  if (format.type === "dash") {
    return "videojs";
  }

  // 5. MP4/WebM → native if supported
  if (format.type === "mp4" || format.type === "webm") {
    if (canPlayNatively(format)) return "native";
    // HEVC in MP4 → WebCodecs
    if (entryName && isHevcEncoding(entryName)) {
      const supported = await checkHevcSupport();
      return supported ? "webcodecs" : "unsupported";
    }
    // AV1 → check support
    if (entryName && /av01|av1/i.test(entryName)) {
      if (await checkAV1Support()) return "native";
      // AV1 with WebCodecs fallback possible but rare in practice
    }
    return "unsupported";
  }

  return "unsupported";
}
