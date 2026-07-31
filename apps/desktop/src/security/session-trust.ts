/**
 * FilmSnaps Desktop — Session Trust Manager
 *
 * Tracks which hosts have served verified video content during a provider
 * session. Once a host is trusted, all future requests to that host bypass
 * the rule cascade (R0/R0b — checked before any blocking rule).
 *
 * Why this exists:
 *   - EasyList/AdGuard rules can accidentally block video-serving CDNs
 *   - Once a host serves a .ts segment, .m3u8 manifest, or .mp4, we know
 *     it's a legitimate video source — no need to check again
 *   - Prevents CDN breakage while maintaining strict blocking on other hosts
 *
 * Trust TTL: 5 minutes (resets on each verified video response)
 * Trust is cleared when the video window closes or provider changes.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface TrustEntry {
  hostname: string;
  firstTrustedAt: number;
  lastVerifiedAt: number;
}

export interface VideoDetectionRule {
  extensions: string[];
  pathPatterns: string[];
}

// ── Constants ───────────────────────────────────────────────────────────────

const TRUST_TTL_MS = 5 * 60 * 1000; // 5 minutes

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

  constructor(detectionRules?: VideoDetectionRule) {
    this.videoExtensions =
      detectionRules?.extensions ?? DEFAULT_VIDEO_EXTENSIONS;
    this.pathPatterns = (detectionRules?.pathPatterns ?? []).map(
      (p) => new RegExp(p, "i"),
    );
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

    // 1. Check Content-Type header (most reliable when available)
    if (contentType) {
      const ct = contentType.toLowerCase();
      if (
        ct.includes("video/") ||
        ct.includes("application/dash+xml") ||
        ct.includes("application/vnd.apple.mpegurl") ||
        ct.includes("application/x-mpegurl") ||
        ct.includes("octet-stream") // Often used for .ts segments
      ) {
        this.addTrust(hostname);
        return true;
      }
    }

    // 2. Check URL extension
    const pathname = this.getPathname(url);
    const ext = this.getExtension(pathname);
    if (ext && this.videoExtensions.includes(ext)) {
      this.addTrust(hostname);
      return true;
    }

    // 3. Check URL against path patterns
    for (const regex of this.pathPatterns) {
      if (regex.test(url)) {
        this.addTrust(hostname);
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a hostname is currently trusted.
   * Trust expires after TTL if not re-verified.
   *
   * @param hostname - The hostname to check
   * @returns true if the host is trusted and within TTL
   */
  isTrusted(hostname: string): boolean {
    if (!hostname) return false;

    const lower = hostname.toLowerCase();
    const entry = this.trustedHosts.get(lower);

    if (!entry) return false;

    const age = Date.now() - entry.lastVerifiedAt;
    if (age > TRUST_TTL_MS) {
      // Expired — remove and return false
      this.trustedHosts.delete(lower);
      return false;
    }

    return true;
  }

  /**
   * Check if a hostname is trusted using suffix matching (subdomain allow).
   * "cdn.example.com" will match a trust entry for "example.com".
   */
  isTrustedSuffix(hostname: string): boolean {
    if (!hostname) return false;

    const lower = hostname.toLowerCase();

    // Exact match first
    if (this.isTrusted(lower)) return true;

    // Suffix match against all trusted hosts
    for (const trustedHost of this.trustedHosts.keys()) {
      if (lower.endsWith("." + trustedHost)) {
        // Re-check TTL for the matched entry
        return this.isTrusted(trustedHost);
      }
    }

    return false;
  }

  /**
   * Explicitly add a hostname to the trust list.
   */
  addTrust(hostname: string): void {
    if (!hostname) return;

    const lower = hostname.toLowerCase();
    const now = Date.now();

    const existing = this.trustedHosts.get(lower);
    if (existing) {
      existing.lastVerifiedAt = now;
    } else {
      this.trustedHosts.set(lower, {
        hostname: lower,
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
      if (now - entry.lastVerifiedAt <= TRUST_TTL_MS) {
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
