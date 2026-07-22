/**
 * TypeScript types mirroring the Kotlin BlocklistConfig data class.
 *
 * This package is the single source of truth for the blocklist.json schema.
 * Both the web app and the filter-compiler use these types, ensuring the
 * Kotlin-native BlocklistConfig in PlayerWebViewOverlayView matches the
 * JSON produced at build time and served at runtime.
 *
 * Schema version: 2
 */

// ── Top-level config ──────────────────────────────────────────────────

export interface BlocklistConfig {
  version: number;
  /** V1: flat allowlist of CDN hosts (backward compat) */
  allowedCdnHosts: string[];
  /** V1: hosts that are always blocked */
  blockedDomains: string[];
  /** V1: per-provider profile mapping */
  providerProfiles?: Record<string, string[]>;
  /** V1: known provider embed/root hosts */
  providerRootHosts?: string[];

  /** V2: fine-grained blocking rules */
  rules?: {
    videoDetection?: VideoDetectionConfig;
    alwaysBlock?: AlwaysBlockConfig;
  };

  /** V2: per-provider CDN domain definitions */
  providers?: ProviderConfig[];
}

// ── V2 sub-types ──────────────────────────────────────────────────────

export interface VideoDetectionConfig {
  extensions: string[];
  pathPatterns: string[];
  enableSessionTrust: boolean;
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
}
