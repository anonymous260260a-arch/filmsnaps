/**
 * FilmSnaps Desktop — R0-R8 Rule Cascade
 *
 * Central blocking decision-maker. Implements the progressive defense pipeline
 * that replaced the legacy flat shouldBlockUrl() scan:
 *
 *   R5:     Always-block domains (blocklist.json rules.alwaysBlock.domains) — block
 *   R6:     Always-block path patterns (blocklist.json rules.alwaysBlock.pathPatterns) — block
 *   R0/R0b: Session trust — allow, scoped to the verified video path
 *   R1:     Provider allowlist (+ adblock-disabled bypass) — allow
 *   R2:     Global CDN allowlist — allow
 *   R3:     Provider embed domain — allow
 *   R7a:    Same-origin ad paths (mobile R7 / adPathPatterns port) — block
 *   R4:     @cliqz/adblocker FiltersEngine — Aho-Corasick O(L) matching
 *   R7:     Legacy blocklist.ts fallback — block
 *   R8:     Default allow
 *
 * R5/R6 (always-block) run FIRST, unconditionally — no trust/allowlist entry
 * can override an operator-declared always-block (V4 step 1). Then the fast
 * allow checks, then the block rules. Each rule returns early on match.
 */

import { SessionTrustManager, looksLikeVideoRequest } from "./session-trust";
import { matchUrl, checkDomainSuffix } from "./filter-engine";
import { decideUrlSubstringBlock } from "./url-substring-filter";
import {
  loadBlocklistConfig,
  getGlobalCdnAllowlist,
  getAlwaysBlockDomains,
  getAlwaysBlockPathPatterns,
  getAllowedDomainsForProvider,
  getProviderProfileAllowlist,
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

/**
 * Same-origin ad paths (mobile R7 / adPathPatterns port). Ads served from the
 * PROVIDER'S OWN host don't generate cross-origin requests, so the FiltersEngine
 * (R4) — which is built from third-party ad-domain rules — misses them. Block any
 * request to the provider's embed host whose path matches one of these.
 */
const SAME_ORIGIN_AD_PATH =
  /\/(ads?|banners?|popups?|popunders?|tracking|affiliate|promo|sponsor|cx)\//i;

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
  // R5/R6 FIRST: Always-block domains + path patterns (V4 step 1 — P0).
  // Checked unconditionally BEFORE any trust/allowlist rule, so NO R0 trust
  // entry can override an operator-declared always-block domain (the
  // googletagmanager.com/cloudflareinsights.com conflict). Block rules must
  // beat allowlists — deny-by-exception, never allow-by-exception.
  // ═══════════════════════════════════════════════════════════════════
  const alwaysBlockDomains = getAlwaysBlockDomains();
  if (
    alwaysBlockDomains.size > 0 &&
    checkDomainSuffix(hostname, alwaysBlockDomains)
  ) {
    return { blocked: true, reason: "always-block-domain", rule: "R5" };
  }
  const alwaysBlockPathPatterns = getAlwaysBlockPathPatterns();
  if (alwaysBlockPathPatterns.length > 0) {
    const lowerUrl = url.toLowerCase();
    for (const pattern of alwaysBlockPathPatterns) {
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
  // R0/R0b: Session trust — allow, but scoped to the verified video path
  // ═══════════════════════════════════════════════════════════════════
  // A bare host trust is NOT enough (expert-flagged over-broadening): a
  // video-serving host like the player page may also serve ad scripts. The
  // request must be media-type OR under the verified video directory; otherwise
  // it falls through to R1-R8 and gets filtered like any other request.
  if (trustManager) {
    if (trustManager.isTrustedFor(url, hostname, type)) {
      return { blocked: false, reason: "session-trust", rule: "R0" };
    }
    // Suffix matching (e.g., cdn123.example.com matches trust for example.com)
    if (trustManager.isTrustedForSuffix(url, hostname, type)) {
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
      // Jump to R7 block checks (R5/R6 already ran; skip the R4 engine)
      return runBlockRules(url, hostname);
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
  // R3.5: Per-provider profile allowlist (mobile Rule 5 parity — rotation-proof)
  // Mobile's PlayerWebViewOverlayView blocks any page-facing script/iframe/
  // image whose host is NOT in the provider's profile (the blocklist.json
  // providerProfiles map). That's an ALLOWLIST — a rotating ad-orchestrator
  // hostname (new subdomain every impression) is blocked by definition, since
  // it's not in the profile. This is the mechanism that catches the six
  // R8-ALLOWED ad hosts mobile blocks but desktop currently lets through.
  //
  // Mirrors mobile's Rule 5 exactly:
  //   - only `script`/`iframe`/`image` are profile-gated (xhr/fetch are left to
  //     R5b/R4, matching mobile where the in-page isAdUrl peer handles them);
  //   - google/gstatic are always exempt (mobile: `!host.contains("google") &&
  //     !host.contains("gstatic")`);
  //   - never blocks main_frame (top-level player page) or media (streams);
  //   - fail-open when the provider has an empty profile (must not block all).
  // R3 (provider embed domain) runs first, so the provider's own host clears.
  // ═══════════════════════════════════════════════════════════════════
  if (providerId) {
    const reqType = (type || "").toLowerCase();
    const isMainFrame = reqType === "main_frame";
    const isMedia =
      reqType === "media" || reqType === "video" || reqType === "audio";
    const isPageResource =
      reqType === "script" || reqType === "iframe" || reqType === "image";
    if (!isMainFrame && !isMedia && isPageResource) {
      const profile = getProviderProfileAllowlist(providerId);
      if (
        profile.size > 0 &&
        !hostname.includes("google") &&
        !hostname.includes("gstatic") &&
        !checkDomainSuffix(hostname, profile)
      ) {
        return {
          blocked: true,
          reason: "profile-allowlist",
          rule: "R3.5",
          matchedRule: hostname,
        };
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // R7a: Same-origin ad paths (mobile R7 / adPathPatterns port)
  // Ads served from the PROVIDER'S OWN host generate no cross-origin requests,
  // so the third-party-oriented FiltersEngine (R4) misses them. Block any
  // request to the current provider host whose path matches an ad-path pattern.
  // ═══════════════════════════════════════════════════════════════════
  if (providerId && SAME_ORIGIN_AD_PATH.test(pathname)) {
    // The provider's embed host is its same-origin; its CDN hosts serving
    // ad paths are just as suspect. Block if the requested host is one of the
    // provider's own domains (embed or CDN).
    const providerDomains = getAllowedDomainsForProvider(providerId);
    if (providerDomains.size > 0 && providerDomains.has(hostname)) {
      return {
        blocked: true,
        reason: "same-origin-ad-path",
        rule: "R7",
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // R4b: Mobile-parity URL-substring block (R5b — backstop)
  // Mirrors mobile AdblockEngine.shouldBlock step 3 (whole-URL substring
  // trie, fed from android-adblock-patterns.json — SAME source of truth as
  // mobile). Runs here, AFTER the R0/R1/R2/R3 allowlists and R0 trust, so
  // video CDNs/embed hosts already trusted or allowlisted pass first; then
  // any https request to a host that cleared no allowlist whose URL contains
  // a live-extracted ad substring is BLOCKED — catching rotating ad
  // orchestrators that @cliqz/adblocker (R4) can't (their random subdomain
  // prefixes aren't in the compiled lists yet).
  //
  // Guarded: never block a MAIN-FRAME document navigation (the top-level
  // provider player page itself must always load). Every SUBRESOURCE — media,
  // xmlhttprequest, sub_frame (ad iframes), websocket, script, image — is fair
  // game, because any such request reaching here cleared R0 trust and the
  // R1/R2/R3 allowlists, so its host is NOT a known video CDN; mobile blocks
  // exactly these via the same substring trie.
  {
    const isMainFrame = type === "main_frame";
    if (!isMainFrame) {
      // Video-safety gate: exempt requests that LOOK like real video content
      // (media resource type, video extension, or disguised HLS/DASH segment —
      // mirroring mobile's request-side R0 VIDEO_MEDIA_DETECTION). Without this,
      // the 'http' substring (which matches every https URL) would block the
      // FIRST video request to a not-yet-trusted CDN and break playback. As on
      // mobile, the orchestrator rotators are NOT video-looking (their paths are
      // nothing like .m3u8/.ts/.mpd/seg-*), so they still get blocked below.
      if (!looksLikeVideoRequest(url, type)) {
        const sub = decideUrlSubstringBlock(url, hostname);
        if (sub.blocked) {
          return {
            blocked: true,
            reason: "mobile-parity-substring",
            rule: "R5b",
            matchedRule:
              sub.matchedSubstring || sub.matchedDomain || "url-substring",
          };
        }
      }
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
 * Run the remaining block rules (R7) after skipping the allow rules + engine.
 * Used by the adblock-disabled path — allows the engine bypass but still
 * blocks the legacy blocklist. (R5/R6 always-block already ran FIRST in
 * shouldBlockRequest, before any allow rule could reach this function.)
 */
function runBlockRules(url: string, hostname: string): BlockDecision {
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
