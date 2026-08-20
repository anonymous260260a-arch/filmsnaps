/**
 * FilmSnaps Desktop — Session Trust Manager
 *
 * Tracks which hosts have served verified video content during a provider
 * session. Once a host is trusted, future requests to that host bypass
 * the rule cascade (R0/R0b — checked before any blocking rule).
 *
 * Why this exists:
 *   - EasyList/AdGuard rules can accidentally block video-serving CDNs
 *   - Once a host serves a .ts segment, .m3u8 manifest, or .mp4, we know
 *     it's a legitimate video source — no need to check again
 *   - Prevents CDN breakage while maintaining strict blocking on other hosts
 *
 * Trust granularity (per expert consultation): a HOST is not trusted as a
 * whole — a video-trusting host (e.g. the player page lizer123.site) may also
 * serve ad scripts. Trust is scoped to the DIRECTORY that served verified
 * video, or to media-type requests. Non-media requests (script, image, xhr,
 * document) to a video-trusted host fall through to R1-R8 and get filtered.
 *
 * Trust TTL (Phase 2c): 15 minutes by default (sliding — resets on each
 * verified video response), configurable via rules.videoDetection.trustTTLMs
 * (provider-config getTrustTTLMs). Raised from 60s so pausing a movie for a
 * few minutes doesn't expire trust and block the next segment.
 *
 * Verification authority (Phase 2c): Content-Type MIME is the authoritative
 * signal (mime-sniffer.isVideoResponse). The disguised-URL regex + extension
 * checks remain as DETECTION HINTS for responses whose MIME was not observed.
 *
 * Trust is cleared when the video window closes or provider changes.
 */

// ── Types ───────────────────────────────────────────────────────────────────

import { isVideoResponse, isDisguisedMediaUrl } from "./mime-sniffer";

export interface TrustEntry {
  hostname: string;
  /** Directory path (pathname up to the last '/') that served the video. */
  pathPrefix: string;
  firstTrustedAt: number;
  lastVerifiedAt: number;
}

export interface VideoDetectionRule {
  extensions: string[];
  pathPatterns: string[];
  /** Sliding trust TTL in ms (rules.videoDetection.trustTTLMs; default 15min). */
  trustTTLMs?: number;
}

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Default trust TTL (sliding). 15 minutes (Phase 2c) — raised from 60s so a
 * paused movie (2+ min) doesn't expire trust and block the next segment. The
 * SessionTrustManager constructor takes a configurable override from
 * rules.videoDetection.trustTTLMs.
 */
const DEFAULT_TRUST_TTL_MS = 15 * 60 * 1000;

// Resource types that are themselves media — a trusted entry always covers
// these regardless of path (they are the video segments/manifests themselves).
const MEDIA_RESOURCE_TYPES = new Set([
  "media",
  "video",
  "audio",
  "fetch", // MSE (HLS/DASH) segment fetches use the fetch resource type
]);

// Default video detection rules (mirrors blocklist.json rules.videoDetection)
const DEFAULT_VIDEO_EXTENSIONS = [
  "m3u8",
  "mpd",
  "ts",
  "m4s",
  "mp4",
  "webm",
  "mkv",
  "m4v",
  "3gp",
  "cmfv",
  "cmfa",
  "aac",
  "key",
];

// ── SessionTrustManager ─────────────────────────────────────────────────────

export class SessionTrustManager {
  private trustedHosts = new Map<string, TrustEntry>();
  private videoExtensions: string[];
  private pathPatterns: RegExp[];
  private ttlMs: number;

  constructor(detectionRules?: VideoDetectionRule) {
    this.videoExtensions =
      detectionRules?.extensions ?? DEFAULT_VIDEO_EXTENSIONS;
    this.pathPatterns = (detectionRules?.pathPatterns ?? []).map(
      (p) => new RegExp(p, "i"),
    );
    // Phase 2c: trust TTL is configurable (rules.videoDetection.trustTTLMs),
    // defaulting to 15 minutes.
    this.ttlMs =
      typeof detectionRules?.trustTTLMs === "number" &&
      detectionRules.trustTTLMs > 0
        ? detectionRules.trustTTLMs
        : DEFAULT_TRUST_TTL_MS;
  }

  /**
   * Check if a URL/response indicates video content from a host.
   * If it does, the host is added to the trust list.
   *
   * @param url - The full URL of the request/response
   * @param hostname - The hostname that served the response
   * @param contentType - Optional Content-Type header value
   * @returns true if video content was detected and trust was added
   */
  checkVideoContent(
    url: string,
    hostname: string,
    contentType?: string,
  ): boolean {
    if (!url || !hostname) return false;

    // 1. MIME is the AUTHORITY (Phase 2c): video/*, DASH, HLS, mpegurl are
    // video regardless of URL shape; octet-stream corroborates when the URL
    // (disguised segment or explicit extension) agrees. A real video server
    // does not label its segments text/html — so a text/html response with a
    // video-ish URL is NOT trusted.
    if (isVideoResponse(url, contentType, this.videoExtensions)) {
      this.addTrust(hostname, this.getPathPrefix(url));
      return true;
    }

    // 2. Check URL extension (DETECTION HINT — only when no authoritative
    // MIME was observed; when a non-video MIME was observed, trust is refused
    // even if the extension looks video-ish).
    if (contentType == null) {
      const pathname = this.getPathname(url);
      const ext = this.getExtension(pathname);
      if (ext && this.videoExtensions.includes(ext)) {
        this.addTrust(hostname, this.getPathPrefix(url));
        return true;
      }

      // 2b. Disguised HLS/DASH segments (V5 Q6 port) — a .woff2/.png/.css/.js
      // URL with HLS packaging structure (seg-/init-/chunk-/part-) IS video.
      // Only ADDS trust — never removes — so it can't cause playback regression.
      if (isDisguisedMediaUrl(url)) {
        this.addTrust(hostname, this.getPathPrefix(url));
        console.log(
          `[SecurityFilter] Trust added: ${hostname} (disguised media segment: ${this.getPathname(url).slice(-60)})`,
        );
        return true;
      }
    }

    // 3. Check URL against path patterns (provider-configured)
    for (const regex of this.pathPatterns) {
      if (regex.test(url)) {
        this.addTrust(hostname, this.getPathPrefix(url));
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a HOST is trusted for a specific request.
   *
   * Trust is scoped: a bare host trust is not enough — the request must either
   * be a media-type resource (video segment / manifest / MSE fetch), or its
   * path must fall under the directory that actually served verified video.
   * This prevents a video-serving host's ad scripts from short-circuiting the
   * R1-R8 rule cascade (the expert-flagged R0 over-broadening).
   *
   * @param url - The full URL being requested
   * @param hostname - The request's hostname (pre-parsed)
   * @param resourceType - Chromium resource type hint ('script', 'media', ...)
   * @returns true only if the request is trusted and within TTL
   */
  isTrustedFor(url: string, hostname: string, resourceType?: string): boolean {
    if (!url || !hostname) return false;

    const lower = hostname.toLowerCase();
    const entry = this.trustedHosts.get(lower);

    if (!entry) return false;

    const age = Date.now() - entry.lastVerifiedAt;
    if (age > this.ttlMs) {
      // Expired — remove and return false
      this.trustedHosts.delete(lower);
      return false;
    }

    // Media-type requests are always covered by a video-trusted entry.
    const type = resourceType?.toLowerCase() ?? "";
    if (MEDIA_RESOURCE_TYPES.has(type)) return true;

    // Otherwise the request path must fall under the verified video directory.
    // NO whole-host carve-out (V4 §5.2 / V5 trust granularity): a `/` or empty
    // pathPrefix must NOT trust every request to the host — a video-serving
    // host like the player page may also serve same-host ad scripts at other
    // paths. Those must fall through to R1-R8. If the prefix is `/` (root
    // video), derive the scope from the first path segment instead so ad
    // scripts at other roots still get filtered.
    if (!entry.pathPrefix || entry.pathPrefix === "/") return false;
    return this.getPathPrefix(url).startsWith(entry.pathPrefix);
  }

  /**
   * Check if a hostname is trusted for a request using suffix matching
   * (subdomain allow). "cdn.example.com" will match a trust entry for
   * "example.com". Same path/resourceType scoping as isTrustedFor.
   */
  isTrustedForSuffix(
    url: string,
    hostname: string,
    resourceType?: string,
  ): boolean {
    if (!url || !hostname) return false;

    const lower = hostname.toLowerCase();

    // Exact match first
    if (this.isTrustedFor(url, lower, resourceType)) return true;

    // Suffix match against all trusted hosts
    for (const trustedHost of this.trustedHosts.keys()) {
      if (lower.endsWith("." + trustedHost)) {
        if (this.isTrustedFor(url, trustedHost, resourceType)) return true;
      }
    }

    return false;
  }

  /**
   * Explicitly add a hostname to the trust list, scoped to a path prefix.
   *
   * @param hostname - Hostname that served verified video content
   * @param pathPrefix - Directory path that served it (may be empty)
   */
  addTrust(hostname: string, pathPrefix = ""): void {
    if (!hostname) return;

    const lower = hostname.toLowerCase();
    const now = Date.now();

    const existing = this.trustedHosts.get(lower);
    if (existing) {
      existing.lastVerifiedAt = now;
      // If a new verified video came from a different directory, widen the
      // trusted prefix to the common root so the whole tree stays playable.
      if (pathPrefix && pathPrefix !== existing.pathPrefix) {
        existing.pathPrefix = this.commonPathPrefix(
          existing.pathPrefix,
          pathPrefix,
        );
      }
    } else {
      this.trustedHosts.set(lower, {
        hostname: lower,
        pathPrefix,
        firstTrustedAt: now,
        lastVerifiedAt: now,
      });
    }
  }

  /**
   * Clear all trusted hosts. Called when the video window closes or
   * provider changes.
   */
  clear(): void {
    this.trustedHosts.clear();
  }

  /**
   * Remove a specific host from trust.
   */
  removeTrust(hostname: string): void {
    this.trustedHosts.delete(hostname.toLowerCase());
  }

  /**
   * Get all currently trusted hosts (within TTL).
   */
  getTrustedHosts(): TrustEntry[] {
    const now = Date.now();
    const valid: TrustEntry[] = [];

    for (const entry of this.trustedHosts.values()) {
      if (now - entry.lastVerifiedAt <= this.ttlMs) {
        valid.push(entry);
      }
    }

    return valid;
  }

  /**
   * Get the number of currently trusted hosts.
   */
  get size(): number {
    return this.getTrustedHosts().length;
  }

  // ── Helpers ──

  /**
   * Directory path (pathname up to the last '/') of a URL. Used as the trust
   * scope so only requests under the verified video directory bypass R1-R8.
   */
  private getPathPrefix(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const lastSlash = pathname.lastIndexOf("/");
      if (lastSlash <= 0) return "/";
      return pathname.substring(0, lastSlash + 1);
    } catch {
      return "/";
    }
  }

  /**
   * Common directory prefix of two paths. Keeps trust widening conservative:
   * "/a/b/" and "/a/c/" → "/a/", never "" (which would mean the whole host).
   */
  private commonPathPrefix(a: string, b: string): string {
    const segA = a.split("/");
    const segB = b.split("/");
    const common: string[] = [];
    const len = Math.min(segA.length, segB.length);
    for (let i = 0; i < len; i++) {
      if (segA[i] === segB[i]) common.push(segA[i]);
      else break;
    }
    let prefix = common.join("/");
    if (!prefix.endsWith("/")) prefix += "/";
    return prefix;
  }

  private getPathname(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }

  private getExtension(pathname: string): string | null {
    const dotIndex = pathname.lastIndexOf(".");
    if (dotIndex === -1 || dotIndex === pathname.length - 1) return null;
    const ext = pathname
      .substring(dotIndex + 1)
      .split("?")[0]
      .split("#")[0];
    return ext || null;
  }
}

/**
 * Request-side video predicate — mirrors mobile's R0 `VIDEO_MEDIA_DETECTION`
 * check (PlayerWebViewOverlayView.kt) EXCEPT it does NOT mutate trust. It only
 * answers "does this request LOOK like real video content?" from the URL +
 * resource-type alone, so the cascade can exempt genuine media from rules that
 * are intended for ads (e.g. the mobile-parity R4b substring backstop).
 *
 * This preserves playback safety for the first request to a not-yet-trusted
 * CDN: mobile runs this on the REQUEST (before the substring trie) and exempts
 * video-looking media accordingly. We do the same for the R4b/R5b substring
 * block — without adding any trust, so the album/ad-layer behavior is unchanged
 * (R0 stays purely response-driven trust acquisition).
 *
 * @param url          Full request URL
 * @param resourceType Chromium resource type hint ('media', 'video', 'fetch', …)
 * @param detectionRules Optional video-detection rules (extension + path patterns)
 */
export function looksLikeVideoRequest(
  url: string,
  resourceType?: string,
  detectionRules?: VideoDetectionRule,
): boolean {
  if (!url) return false;

  const type = (resourceType || "").toLowerCase();
  // Media-ish resource types are, by definition, carrying video/meta.
  if (MEDIA_RESOURCE_TYPES.has(type)) return true;

  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }

  // Explicit video extension (.m3u8, .mpd, .ts, .m4s, .mp4, …)
  const ext = extractExtension(pathname);
  const videoExtensions =
    detectionRules?.extensions ?? DEFAULT_VIDEO_EXTENSIONS;
  if (ext && videoExtensions.includes(ext.toLowerCase())) return true;

  // Disguised HLS/DASH segments (.woff2/.png/.css/.js with seg-/init-/chunk-/…)
  if (isDisguisedMediaUrl(url)) return true;

  // Provider path patterns
  if (detectionRules?.pathPatterns) {
    for (const p of detectionRules.pathPatterns) {
      try {
        if (new RegExp(p, "i").test(url)) return true;
      } catch {
        /* skip malformed pattern */
      }
    }
  }

  return false;
}

function extractExtension(pathname: string): string | null {
  const dotIndex = pathname.lastIndexOf(".");
  if (dotIndex === -1 || dotIndex === pathname.length - 1) return null;
  const ext = pathname
    .substring(dotIndex + 1)
    .split("?")[0]
    .split("#")[0];
  return ext || null;
}
