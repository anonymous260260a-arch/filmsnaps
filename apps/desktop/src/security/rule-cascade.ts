/**
 * FilmSnaps Desktop — R0-R8 Rule Cascade
 *
 * Central blocking decision-maker. Implements the progressive defense pipeline
 * that replaced the legacy flat shouldBlockUrl() scan:
 *
 *   R0/R0b: Session trust — allow unconditionally
 *   R1:     Provider allowlist (+ adblock-disabled bypass) — allow
 *   R2:     Global CDN allowlist — allow
 *   R3:     Provider embed domain — allow
 *   R4:     @cliqz/adblocker FiltersEngine — Aho-Corasick O(L) matching
 *   R5:     Always-block domains (blocklist.json rules.alwaysBlock.domains) — block
 *   R6:     Always-block path patterns (blocklist.json rules.alwaysBlock.pathPatterns) — block
 *   R7:     Legacy blocklist.ts fallback — block
 *   R8:     Default allow
 *
 * Fastest checks run first (session trust, Set lookups), most expensive
 * (Aho-Corasick engine) runs in the middle. Each rule returns early on match.
 */

import { SessionTrustManager } from "./session-trust";
import { matchUrl, checkDomainSuffix } from "./filter-engine";
import {
  loadBlocklistConfig,
  getGlobalCdnAllowlist,
  getAlwaysBlockDomains,
  getAlwaysBlockPathPatterns,
  getAllowedDomainsForProvider,
  isAdblockDisabledForProvider,
} from "./provider-config";
import { shouldBlockUrl, isDownloadUrl, getBlockCategory } from "./blocklist";

// ── Types ───────────────────────────────────────────────────────────────────

export interface CascadeOptions {
  /** The full URL being requested */
  url: string;
  /** The URL of the page making the request */
  sourceUrl: string;
  /** The hostname of the requested URL (pre-parsed, for reuse) */
  hostname?: string;
  /** Optional provider ID for per-provider rules */
  providerId?: string;
  /** Optional session trust manager */
  trustManager?: SessionTrustManager;
  /** Resource type hint for filter engine */
  type?: string;
}

export interface BlockDecision {
  /** Whether the request should be blocked */
  blocked: boolean;
  /** Human-readable reason for the decision */
  reason: string;
  /** The rule level that made the decision (R0-R8) */
  rule: string;
  /** The specific filter/pattern that matched (if applicable) */
  matchedRule?: string;
}

// ── Internal URL parsing cache ──────────────────────────────────────────────

function parseHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function parsePathname(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

// ── Rule cascade ────────────────────────────────────────────────────────────

/**
 * Run the full R0-R8 rule cascade to decide if a request should be blocked.
 *
 * Order matters: rules are checked from fastest to most expensive,
 * with allow-rules preceding block-rules so known-good domains bypass
 * the filter engine entirely.
 */
export function shouldBlockRequest(options: CascadeOptions): BlockDecision {
  const { url, sourceUrl, providerId, trustManager, type } = options;

  // ── Pre-checks (never block internal/protocol URLs) ──
  if (!url || typeof url !== "string") {
    return { blocked: false, reason: "empty-url", rule: "R8" };
  }

  if (
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("about:") ||
    url.startsWith("file:")
  ) {
    return { blocked: false, reason: "internal-protocol", rule: "R8" };
  }

  const hostname = options.hostname || parseHostname(url);
  if (!hostname) {
    // Can't parse URL — allow (safety)
    return { blocked: false, reason: "unparseable-url", rule: "R8" };
  }

  const pathname = parsePathname(url);

  // ═══════════════════════════════════════════════════════════════════
  // R0/R0b: Session trust — allow unconditionally
  // ═══════════════════════════════════════════════════════════════════
  if (trustManager) {
    // Check if the hostname itself is trusted (exact match)
    if (trustManager.isTrusted(hostname)) {
      return { blocked: false, reason: "session-trust", rule: "R0" };
    }
    // Check suffix matching (e.g., cdn123.example.com matches trust for example.com)
    if (trustManager.isTrustedSuffix(hostname)) {
      return { blocked: false, reason: "session-trust-suffix", rule: "R0" };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // R1: Provider allowlist + adblock-disabled bypass
  // ═══════════════════════════════════════════════════════════════════
  if (providerId) {
    // If adblock is disabled for this provider, skip the filter engine (R4)
    // but STILL run block rules (R5-R7) — so alwaysBlock domains are blocked
    // even for providers whose ads double as video auth.
    const adblockDisabled = isAdblockDisabledForProvider(providerId);
    if (adblockDisabled) {
      // Jump to R5-R7 block checks (skip R4 engine)
      return runBlockRules(url, hostname, pathname, providerId, trustManager);
    }

    // Check provider-specific allowed domains
    const providerDomains = getAllowedDomainsForProvider(providerId);
    if (
      providerDomains.size > 0 &&
      checkDomainSuffix(hostname, providerDomains)
    ) {
      return { blocked: false, reason: "provider-allowlist", rule: "R1" };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // R2: Global CDN allowlist
  // ═══════════════════════════════════════════════════════════════════
  const globalCdn = getGlobalCdnAllowlist();
  if (globalCdn.size > 0 && checkDomainSuffix(hostname, globalCdn)) {
    return { blocked: false, reason: "global-cdn-allowlist", rule: "R2" };
  }

  // ═══════════════════════════════════════════════════════════════════
  // R3: Provider embed domain (the main provider hostname itself)
  // ═══════════════════════════════════════════════════════════════════
  if (providerId) {
    const config = getAllowedDomainsForProvider(providerId);
    if (config.size > 0 && config.has(hostname)) {
      return { blocked: false, reason: "provider-embed-domain", rule: "R3" };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // R4: @cliqz/adblocker FiltersEngine (Aho-Corasick O(L) matching)
  // ═══════════════════════════════════════════════════════════════════
  try {
    const engineResult = matchUrl(url, sourceUrl, type);
    if (engineResult.blocked) {
      return {
        blocked: true,
        reason: "filter-engine",
        rule: "R4",
        matchedRule: engineResult.matchedRule,
      };
    }
    // If the engine explicitly allowlisted via exception rule, skip to R8
    if (engineResult.category === "allowlist") {
      return {
        blocked: false,
        reason: "engine-allowlist-exception",
        rule: "R8",
      };
    }
  } catch {
    // Engine not loaded or matching failed — continue to next rules
  }

  // ═══════════════════════════════════════════════════════════════════
  // R5: Always-block domains (from blocklist.json rules.alwaysBlock.domains)
  // ═══════════════════════════════════════════════════════════════════
  const alwaysBlockDomains = getAlwaysBlockDomains();
  if (alwaysBlockDomains.size > 0) {
    if (checkDomainSuffix(hostname, alwaysBlockDomains)) {
      return { blocked: true, reason: "always-block-domain", rule: "R5" };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // R6: Always-block path patterns (from blocklist.json rules.alwaysBlock.pathPatterns)
  // ═══════════════════════════════════════════════════════════════════
  const pathPatterns = getAlwaysBlockPathPatterns();
  if (pathPatterns.length > 0) {
    const lowerUrl = url.toLowerCase();
    for (const pattern of pathPatterns) {
      if (lowerUrl.includes(pattern.toLowerCase())) {
        return {
          blocked: true,
          reason: "always-block-path-pattern",
          rule: "R6",
          matchedRule: pattern,
        };
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // R7: Legacy blocklist.ts fallback
  // ═══════════════════════════════════════════════════════════════════
  if (shouldBlockUrl(url)) {
    const category = getBlockCategory(url);
    return {
      blocked: true,
      reason: `legacy-blocklist:${category}`,
      rule: "R7",
    };
  }

  // Check download URLs (complementary to R5/R6)
  if (isDownloadUrl(url)) {
    return { blocked: true, reason: "legacy-download", rule: "R7" };
  }

  // ═══════════════════════════════════════════════════════════════════
  // R8: Default allow
  // ═══════════════════════════════════════════════════════════════════
  return { blocked: false, reason: "default-allow", rule: "R8" };
}

/**
 * Run R5-R7 block rules only (skip allow rules R0-R4).
 * Used by the adblock-disabled path — allows the engine bypass but
 * still blocks explicitly listed domains/patterns.
 */
function runBlockRules(
  url: string,
  hostname: string,
  pathname: string,
  providerId?: string,
  trustManager?: SessionTrustManager,
): BlockDecision {
  // ═══════════════════════════════════════════════════════════════════
  // R5: Always-block domains (from blocklist.json rules.alwaysBlock.domains)
  // ═══════════════════════════════════════════════════════════════════
  const alwaysBlockDomains = getAlwaysBlockDomains();
  if (alwaysBlockDomains.size > 0) {
    if (checkDomainSuffix(hostname, alwaysBlockDomains)) {
      return { blocked: true, reason: "always-block-domain", rule: "R5" };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // R6: Always-block path patterns (from blocklist.json rules.alwaysBlock.pathPatterns)
  // ═══════════════════════════════════════════════════════════════════
  const pathPatterns = getAlwaysBlockPathPatterns();
  if (pathPatterns.length > 0) {
    const lowerUrl = url.toLowerCase();
    for (const pattern of pathPatterns) {
      if (lowerUrl.includes(pattern.toLowerCase())) {
        return {
          blocked: true,
          reason: "always-block-path-pattern",
          rule: "R6",
          matchedRule: pattern,
        };
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // R7: Legacy blocklist.ts fallback
  // ═══════════════════════════════════════════════════════════════════
  if (shouldBlockUrl(url)) {
    const category = getBlockCategory(url);
    return {
      blocked: true,
      reason: `legacy-blocklist:${category}`,
      rule: "R7",
    };
  }

  // Check download URLs (complementary to R5/R6)
  if (isDownloadUrl(url)) {
    return { blocked: true, reason: "legacy-download", rule: "R7" };
  }

  return {
    blocked: false,
    reason: "adblock-disabled-default-allow",
    rule: "R8",
  };
}

/**
 * Check if session trust should be updated based on a response.
 * Called when a request completes with video content (via will-redirect
 * or onCompleted handlers).
 */
export function checkResponseForTrust(
  trustManager: SessionTrustManager,
  url: string,
  contentType?: string,
): boolean {
  if (!trustManager || !url) return false;

  const hostname = parseHostname(url);
  if (!hostname) return false;

  return trustManager.checkVideoContent(url, hostname, contentType);
}
