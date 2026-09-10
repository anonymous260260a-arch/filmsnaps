/**
 * Stream URL validator — GET Range probe with outcome classification.
 *
 * HEAD requests are unreliable: many CDNs return 200 for HEAD but 400/403 for
 * actual video requests (auth, quotas, region locks only trigger on GET).
 * GET Range: bytes=0-8191 triggers the same server path as the video player.
 *
 * Probes classify into three outcomes:
 *  - "valid"   → verified playable (media signature, size, auth all OK)
 *  - "dead"    → unusable (401/403/404/410/5xx, error page, unsupported codec)
 *                — requires TWO agreeing attempts before a link is condemned
 *  - "unknown" → inconclusive (timeout, network flake, 429 rate-limit) —
 *                NEVER cached and NEVER blacklisted; the link may play fine
 *
 * Only "valid" and "dead" outcomes are cached (with short TTLs). This fixes
 * the old behavior where a slow CDN that would play fine got marked Failed
 * for 5 minutes because its first bytes took longer than the probe timeout.
 */

const RANGE_PROBE_SIZE = 8192;
const VALID_CACHE_TTL = 90 * 1000; // 90 s — presigned URLs can rotate, keep short
const DEAD_CACHE_TTL = 60 * 1000; // 60 s — dead links may recover (token refresh)

import {
  getPlayerTuning,
  headersForUrl,
  shouldBlockDirect,
  shouldSkipProbe,
} from "./playerConfig";

export type ProbeOutcome = "valid" | "dead" | "unknown";

export interface ValidationResult {
  outcome: ProbeOutcome;
  /** Backward-compatible convenience flag: outcome === "valid". */
  valid: boolean;
  statusCode?: number;
  contentType?: string;
  supportsRange?: boolean;
  error?: string;
  containerType?: "mp4" | "mkv" | "webm" | "mp3" | "aac" | "mpegts" | "unknown";
  /** MKV audio risk from EBML sniff: dts/eac3 tracks often fail on device. */
  audioRisk?: "safe" | "risky" | "unknown";
  /** Measured round-trip to first probe bytes (ms) — hints which hosts start fast. */
  probeMs?: number;
  timestamp: number;
}

const validationCache = new Map<string, ValidationResult>();

function cacheTtlFor(outcome: ProbeOutcome): number {
  if (outcome === "valid") return VALID_CACHE_TTL;
  if (outcome === "dead") return DEAD_CACHE_TTL;
  return 0; // unknown outcomes are never cached
}

/**
 * Headers shared by the probe and the actual player source now come from
 * lib/playerConfig (headersForUrl): built-in defaults, optionally overridden
 * by the remote player config's defaultHttpHeaders and per-host rules.
 * Keeping probe and playback headers identical means a probe verdict predicts
 * what playback will get (some CDNs auth-check the User-Agent/Referer pair).
 */

/**
 * Native probe transport (expo-video patch — StreamProbe on the shared
 * OkHttpClient the player itself uses). Verdicts therefore match playback
 * (same TLS/header stack — the old false-403 class was a fingerprint
 * mismatch), a successful probe pre-warms the connection playback reuses,
 * and we get true connect/TLS timings. Classification still lives here in
 * JS, and the JS fetch path below remains as fallback for builds without
 * the native module.
 */
type NativeProbeFn = (
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
) => Promise<any>;

let nativeProbeFn: NativeProbeFn | null | undefined;

function getNativeProbe(): NativeProbeFn | null {
  if (nativeProbeFn !== undefined) return nativeProbeFn;
  try {
    const { requireNativeModule } = require("expo-modules-core");
    const mod = requireNativeModule("ExpoVideo");
    nativeProbeFn =
      typeof mod?.probeStream === "function" ? mod.probeStream.bind(mod) : null;
    if (nativeProbeFn)
      console.log(
        "[Validator] native OkHttp probe available (player HTTP stack)",
      );
  } catch {
    nativeProbeFn = null;
  }
  return nativeProbeFn ?? null;
}

/** Minimal base64 → ArrayBuffer (no RN global atob guarantee). */
function base64ToArrayBuffer(b64: string): ArrayBuffer | null {
  try {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
    const bytes = new Uint8Array(Math.floor((clean.length / 4) * 3));
    let outLen = 0;
    let buf = 0;
    let bits = 0;
    for (let i = 0; i < clean.length; i++) {
      const c = clean[i];
      if (c === "=") break;
      const v = chars.indexOf(c);
      if (v < 0) return null;
      buf = (buf << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes[outLen++] = (buf >> bits) & 0xff;
      }
    }
    return bytes.subarray(0, outLen).slice().buffer;
  } catch {
    return null;
  }
}

interface ProbeMeta {
  statusCode: number;
  contentType?: string;
  contentRange?: string;
  contentLength?: number;
  acceptRanges?: string;
}

/**
 * Shared classification for both transports. `body` holds the first bytes of
 * the response (may be empty — treated like any other undersized payload).
 */
function classifyProbe(
  meta: ProbeMeta,
  body: ArrayBuffer | null,
): Omit<ValidationResult, "timestamp" | "probeMs"> {
  const isHttpSuccess = meta.statusCode === 200 || meta.statusCode === 206;
  const base = {
    statusCode: meta.statusCode,
    contentType: meta.contentType,
    supportsRange: meta.statusCode === 206,
  };

  if (!isHttpSuccess) {
    // 429 = rate-limited, the link itself may be fine → unknown.
    // Everything else in 4xx/5xx is an authoritative rejection.
    const dead = meta.statusCode !== 429;
    return {
      outcome: dead ? "dead" : "unknown",
      valid: false,
      error: `HTTP ${meta.statusCode}`,
      ...base,
    };
  }

  // Total size check:
  // On 206 Partial Content, Content-Length is only the chunk size (8192 bytes), so we check Content-Range.
  // On 200 OK, Content-Length represents the entire file size.
  if (meta.statusCode === 206 && meta.contentRange) {
    const totalMatch = meta.contentRange.match(/\/(\d+)$/);
    if (totalMatch) {
      const totalSize = parseInt(totalMatch[1], 10);
      if (!Number.isNaN(totalSize) && totalSize < 1000000) {
        return {
          outcome: "dead",
          valid: false,
          error: `File too small: ${totalSize} bytes`,
          ...base,
        };
      }
    }
  } else if (meta.statusCode === 200 && meta.contentLength != null) {
    const size = meta.contentLength;
    if (!Number.isNaN(size) && size < 1000000) {
      return {
        outcome: "dead",
        valid: false,
        error: `File too small: ${size} bytes`,
        ...base,
      };
    }
  }

  // Validate body payload / container signature
  const buffer = body ?? new ArrayBuffer(0);
  const containerInfo = validateContainerSignature(buffer);
  if (!containerInfo.valid) {
    return {
      outcome: "dead",
      valid: false,
      error: containerInfo.error || "Unknown container format",
      ...base,
    };
  }

  // For MP4: validate codec if detectable
  if (containerInfo.type === "mp4") {
    const codecInfo = extractMp4CodecInfo(buffer);
    if (codecInfo && !isSupportedCodec(codecInfo)) {
      return {
        outcome: "dead",
        valid: false,
        error: `Unsupported codec: ${codecInfo}`,
        ...base,
      };
    }
  }

  // For MKV: sniff track codec IDs from the EBML header region. DTS/E-AC3
  // audio tracks frequently fail on-device — flag as risky (deprioritized,
  // never blacklisted; the file may still play or have alternate tracks).
  let audioRisk: "safe" | "risky" | "unknown" = "unknown";
  if (containerInfo.type === "mkv") {
    const hint = extractMatroskaCodecHint(buffer);
    audioRisk = audioCodecRisk(hint.audioCodec);
  }

  return {
    outcome: "valid",
    valid: true,
    containerType: containerInfo.type,
    audioRisk,
    ...base,
  };
}

/**
 * One probe request + full classification. No caching — the orchestrator
 * (validateStreamUrl) decides what to keep.
 */
async function probeAttempt(
  url: string,
  probeHeaders: Record<string, string>,
): Promise<ValidationResult> {
  const startedAt = Date.now();
  const finish = (
    result: Omit<ValidationResult, "timestamp" | "probeMs">,
  ): ValidationResult => ({
    ...result,
    probeMs: Date.now() - startedAt,
    timestamp: Date.now(),
  });

  const native = getNativeProbe();
  if (native) {
    try {
      const r = await native(
        url,
        probeHeaders,
        getPlayerTuning().validationTimeoutMs,
      );
      const buffer: ArrayBuffer | null =
        typeof r?.bodyBase64 === "string"
          ? base64ToArrayBuffer(r.bodyBase64)
          : null;
      return {
        ...classifyProbe(
          {
            statusCode: r?.statusCode ?? 0,
            contentType: r?.contentType ?? undefined,
            contentRange: r?.contentRange ?? undefined,
            contentLength:
              typeof r?.contentLength === "number"
                ? r.contentLength
                : undefined,
            acceptRanges: r?.acceptRanges ?? undefined,
          },
          buffer,
        ),
        probeMs:
          typeof r?.probeMs === "number" ? r.probeMs : Date.now() - startedAt,
        timestamp: Date.now(),
      };
    } catch (error) {
      // Native timeouts and network flakes say nothing definitive either —
      // same policy as the fetch path: unknown, never cached, never blacklisted.
      return finish({
        outcome: "unknown",
        valid: false,
        error:
          error instanceof Error ? error.message : "Native probe network error",
      });
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    getPlayerTuning().validationTimeoutMs,
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Range: `bytes=0-${RANGE_PROBE_SIZE - 1}`,
        ...probeHeaders,
      },
      signal: controller.signal,
      cache: "no-store",
    });

    let body: ArrayBuffer = new ArrayBuffer(0);
    if (
      response.body &&
      typeof (response.body as any).getReader === "function"
    ) {
      try {
        const reader = (response.body as any).getReader();
        const { value } = await reader.read();
        reader.cancel().catch(() => {});
        body = value
          ? value.buffer.slice(
              value.byteOffset,
              value.byteOffset + value.byteLength,
            )
          : new ArrayBuffer(0);
      } catch {
        body = await response.arrayBuffer();
      }
    } else {
      body = await response.arrayBuffer();
    }

    return finish(
      classifyProbe(
        {
          statusCode: response.status,
          contentType: response.headers.get("content-type") || undefined,
          contentRange: response.headers.get("content-range") || undefined,
          contentLength: response.headers.get("content-length")
            ? parseInt(response.headers.get("content-length") as string, 10)
            : undefined,
        },
        body,
      ),
    );
  } catch (error) {
    const isTimeout =
      error instanceof Error &&
      (error.name === "AbortError" || /abort|timeout/i.test(error.message));

    // Timeouts and network flakes say nothing definitive about the link —
    // it may stream fine in the player. Never cache, never blacklist.
    return finish({
      outcome: "unknown",
      valid: false,
      error: isTimeout
        ? "Probe timed out"
        : error instanceof Error
          ? error.message
          : "Network error",
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function validateStreamUrl(
  url: string,
): Promise<ValidationResult> {
  // Server-driven per-host rules (lib/playerConfig) — checked before any
  // network traffic so a bad host costs nothing.
  if (shouldBlockDirect(url)) {
    return {
      outcome: "dead",
      valid: false,
      error: "Host blocked by player config",
      timestamp: Date.now(),
    };
  }
  if (shouldSkipProbe(url)) {
    // Unverified is not dead: the player may still try this link.
    return {
      outcome: "unknown",
      valid: false,
      error: "Probe skipped by player config",
      timestamp: Date.now(),
    };
  }

  const cached = validationCache.get(url);
  if (cached) {
    const ttl = cacheTtlFor(cached.outcome);
    if (ttl > 0 && Date.now() - cached.timestamp < ttl) {
      return cached;
    }
    validationCache.delete(url);
  }

  // Attempt 1 — headers identical to what playback sends.
  const first = await probeAttempt(url, headersForUrl(url));
  if (first.outcome !== "dead") {
    if (first.outcome !== "unknown") validationCache.set(url, first);
    return first;
  }

  // Attempt 2 — a single failure never condemns a link. Confirm with a
  // minimal header set on a fresh request: some CDNs / edge rules 403 the
  // full browser-fingerprint header pair (Referer, Accept-Encoding) while the
  // player's plain request plays fine. Only two agreeing failures count.
  const second = await probeAttempt(url, {
    "User-Agent": headersForUrl(url)["User-Agent"],
  });
  if (second.outcome !== "dead") {
    if (__DEV__)
      console.log(
        `[Validator] probe healed after retry: ${url.slice(0, 80)} (first attempt: ${first.error ?? "dead"})`,
      );
    if (second.outcome !== "unknown") validationCache.set(url, second);
    return second;
  }

  // Confirmed dead by both attempts — cache the verdict.
  validationCache.set(url, first);
  return first;
}

/** Forget the cached verdict for one URL (e.g. after a playback error). */
export function invalidateValidation(url: string): void {
  validationCache.delete(url);
}

export function clearValidationCache(): void {
  validationCache.clear();
}

interface ContainerInfo {
  valid: boolean;
  type?: "mp4" | "mkv" | "webm" | "mp3" | "aac" | "mpegts" | "unknown";
  error?: string;
}

/**
 * Validate that the first bytes do not contain an HTML/JSON error page
 * and identify recognized video container signatures.
 */
function validateContainerSignature(buffer: ArrayBuffer): ContainerInfo {
  if (buffer.byteLength < 4) {
    return { valid: false, error: "Buffer too small" };
  }

  const view = new Uint8Array(buffer);

  // Check for HTML / JSON / XML error text in payload
  const headLength = Math.min(view.length, 256);
  const headText = String.fromCharCode(
    ...Array.from(view.slice(0, headLength)),
  ).toLowerCase();
  if (
    headText.includes("<!doctype html") ||
    headText.includes("<html") ||
    headText.includes("<?xml") ||
    headText.includes("<error>") ||
    headText.includes("accessdenied") ||
    headText.includes('{"error"') ||
    headText.includes('{"message"')
  ) {
    return {
      valid: false,
      error: "Server returned error or HTML page instead of video",
    };
  }

  // MP4 family: "ftyp" box (usually at offset 4, or within first 32 bytes)
  for (let i = 0; i <= Math.min(view.length - 8, 32); i++) {
    const box = String.fromCharCode(
      view[i],
      view[i + 1],
      view[i + 2],
      view[i + 3],
    );
    if (box === "ftyp" || box === "moov" || box === "mdat") {
      return { valid: true, type: "mp4" };
    }
  }

  // MKV/WebM: EBML header (0x1A45DFA3)
  if (
    view[0] === 0x1a &&
    view[1] === 0x45 &&
    view[2] === 0xdf &&
    view[3] === 0xa3
  ) {
    // Disambiguate WebM vs Matroska via DocType string
    const text = bufferToAsciiString(buffer);
    if (text.includes("webm")) {
      return { valid: true, type: "webm" };
    }
    return { valid: true, type: "mkv" };
  }

  // MPEG-TS: 0x47 at sync byte positions
  if (view[0] === 0x47 || (view.length >= 192 && view[188] === 0x47)) {
    return { valid: true, type: "mpegts" };
  }

  // MP3: frame sync (11 bits set)
  if ((view[0] & 0xff) === 0xff && (view[1] & 0xe0) === 0xe0) {
    return { valid: true, type: "mp3" };
  }

  // AAC: ADTS sync (0xFFF1 or 0xFFF9)
  if (
    view[0] === 0xff &&
    ((view[1] & 0xf0) === 0xf0 || (view[1] & 0xf0) === 0xf9)
  ) {
    return { valid: true, type: "aac" };
  }

  // If not identified by simple signature but is binary stream, allow it for ExoPlayer
  return { valid: true, type: "unknown" };
}

/**
 * Safe binary-to-string conversion for Hermes / React Native (where TextDecoder only supports UTF-8).
 */
function bufferToAsciiString(buffer: ArrayBuffer, maxBytes = 8192): string {
  const bytes = new Uint8Array(
    buffer,
    0,
    Math.min(buffer.byteLength, maxBytes),
  );
  let str = "";
  const CHUNK_SIZE = 1024;
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    str += String.fromCharCode.apply(null, chunk as any);
  }
  return str;
}

/**
 * Sniff video and audio codec ID strings from Matroska / WebM EBML tracks.
 */
export function extractMatroskaCodecHint(buffer: ArrayBuffer): {
  codec: string | null;
  audioCodec: string | null;
} {
  const text = bufferToAsciiString(buffer);

  let codec: string | null = null;
  if (text.includes("V_MPEGH/ISO/HEVC")) codec = "hevc";
  else if (text.includes("V_MPEG4/ISO/AVC")) codec = "h264";
  else if (text.includes("V_VP9")) codec = "vp9";
  else if (text.includes("V_VP8")) codec = "vp8";
  else if (text.includes("V_AV1")) codec = "av1";

  let audioCodec: string | null = null;
  if (text.includes("A_OPUS")) audioCodec = "opus";
  else if (text.includes("A_VORBIS")) audioCodec = "vorbis";
  else if (text.includes("A_AAC")) audioCodec = "aac";
  else if (text.includes("A_AC3")) audioCodec = "ac3";
  else if (text.includes("A_EAC3")) audioCodec = "eac3";
  else if (text.includes("A_DTS")) audioCodec = "dts";

  return { codec, audioCodec };
}

const UNRELIABLE_AUDIO_CODECS = new Set(["dts", "eac3"]);

export function audioCodecRisk(
  audioCodec: string | null,
): "safe" | "risky" | "unknown" {
  if (!audioCodec) return "unknown";
  if (UNRELIABLE_AUDIO_CODECS.has(audioCodec)) return "risky";
  return "safe";
}

/**
 * Extract codec information from MP4 ftyp compatible brands.
 * Used to catch unsupported codecs (e.g. AV1 on older devices) before playback.
 */
function extractMp4CodecInfo(buffer: ArrayBuffer): string | null {
  const view = new DataView(buffer);
  let offset = 0;

  while (offset < buffer.byteLength - 8) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7),
    );

    if (type === "ftyp") {
      const brands: string[] = [];
      for (let i = offset + 16; i < offset + size; i += 4) {
        if (i + 3 >= buffer.byteLength) break;
        const brand = String.fromCharCode(
          view.getUint8(i),
          view.getUint8(i + 1),
          view.getUint8(i + 2),
          view.getUint8(i + 3),
        );
        brands.push(brand);
      }

      if (brands.some((b) => b.includes("hvc") || b.includes("hev"))) {
        return "hevc";
      }
      if (brands.some((b) => b.includes("av01") || b.includes("av1"))) {
        return "av1";
      }
      if (brands.some((b) => b.includes("avc") || b.includes("mp4"))) {
        return "h264";
      }
    }

    offset += size;
    if (size === 0) break;
  }

  return null;
}

/**
 * Check if a codec is supported by ExoPlayer on this device.
 * ExoPlayer supports H.264, H.265 (8-bit), VP8, VP9, AV1.
 */
function isSupportedCodec(codec: string): boolean {
  const supported = ["h264", "h265", "hevc", "vp8", "vp9", "av1", "avc1"];
  return supported.includes(codec.toLowerCase());
}
