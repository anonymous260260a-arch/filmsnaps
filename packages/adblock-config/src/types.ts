/**
 * TypeScript types mirroring the Kotlin BlocklistConfig data class.
 *
 * This package is the single source of truth for the blocklist config schema.
 * Both the web app and the filter-compiler use these types, ensuring the
 * Kotlin-native BlocklistConfig in PlayerWebViewOverlayView matches the
 * JSON produced at build time and served at runtime.
 *
 * Schema version: 5
 *
 * v5 SPLIT:
 *   The single blocklist.json is replaced by two files that travel together:
 *     - providers.json  — app-logic (per-provider domains, navigation guard,
 *                         video detection, always-block, profiles)
 *     - filters.txt     — standard uBO/EasyList syntax for the ad engine
 *                         (replaces substring allowedCdnHosts/blockedDomains/
 *                         rules.alwaysBlock for network/cosmetic blocking)
 *     - providers.json.sig — Ed25519 signature over providers.json (for OTA)
 *
 * Matching semantics (v5): every allowlist/blocklist host match is EXACT
 * host or SUFFIX (`endswith('.' + host)` or `=== host`), never substring.
 */

// ── Top-level config ──────────────────────────────────────────────────

export interface BlocklistConfig {
  version: number;
  /**
   * V1: flat allowlist of CDN hosts (backward compat — v5 keeps these as
   * exact/suffix match targets, but new configs should use filters.txt).
   */
  allowedCdnHosts: string[];
  /** V1: hosts that are always blocked (v5 → filters.txt preferred). */
  blockedDomains: string[];
  /** V1: per-provider profile mapping (kept — rotation-proof allowlists). */
  providerProfiles?: Record<string, string[]>;
  /** V1: known provider embed/root hosts. */
  providerRootHosts?: string[];

  /** V2+: fine-grained blocking rules. */
  rules?: {
    videoDetection?: VideoDetectionConfig;
    alwaysBlock?: AlwaysBlockConfig;
  };

  /** V2+: per-provider CDN domain definitions. */
  providers?: ProviderConfig[];

  /** V3+: provider home-escape containment (navigation guard). */
  navigationGuard?: NavigationGuardConfig;

  /** V5: Ed25519 signature over the canonical JSON bytes (OTA integrity). */
  signature?: string;
  /** V5: hex-encoded Ed25519 public key that must verify `signature`. */
  publicKey?: string;
}

// ── Sub-types ─────────────────────────────────────────────────────────

export interface VideoDetectionConfig {
  extensions: string[];
  pathPatterns: string[];
  enableSessionTrust: boolean;
  /** V5: sliding trust TTL in ms. Default 900000 (15 min). */
  trustTTLMs?: number;
}

export interface AlwaysBlockConfig {
  domains: string[];
  pathPatterns: string[];
}

export interface ProviderConfig {
  id: string;
  embedDomains: string[];
  cdnDomains: string[];
  enabled: boolean;
  /** V5: allow the provider's own initial server redirect (301/302/307/308)
   *  during the NavGuard bootstrap window. Fixes redirect-mesh embeds that
   *  otherwise ERR_FAILED (viduki.net, videasy.to). */
  allowServerRedirects?: boolean;
  /** V5: hosts the provider's video/API auth APIs run on (R3.5 API exemption). */
  apiDomains?: string[];
  /** Provider home/list paths that escape the player frame. */
  blockHomePaths?: string[];
  /** API synthetic-interception rules (screenscape /api/ads/cycles). */
  apiIntercepts?: ApiInterceptRule[];
  /** CSS cosmetic rules applied via injectCosmetics. */
  cosmeticRules?: string[];
  /** Some providers' ad scripts double as video auth — disable ad blocking. */
  adblockDisabled?: boolean;
}

export interface ApiInterceptRule {
  match: string;
  methods?: string[];
  synthetic?: {
    primary?: Record<string, unknown>;
    fallback?: Record<string, unknown>;
    fallbackCondition?: string;
  };
}

export interface NavigationGuardConfig {
  /** Paths blocked for EVERY provider (e.g. bare "/"). */
  universalBlockPaths?: string[];
  /** Reserved (deny-list is primary); parsed for schema parity. */
  shallowDepthThreshold?: number;
}
