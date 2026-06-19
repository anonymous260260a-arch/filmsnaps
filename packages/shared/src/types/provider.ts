/**
 * Protection configuration for a provider
 */
export interface ProviderProtection {
  /** Enable/disable protection filtering for this provider (default: true) */
  enabled?: boolean;
  /** Extra URL patterns to block specifically for this provider */
  customBlockPatterns?: string[];
  /** URL patterns to allow despite the global blocklist */
  allowPatterns?: string[];
}

/**
 * Single provider definition — the source of truth
 */
export interface ProviderDefinition {
  /** Unique identifier (lowercase, used in URLs & code) */
  id: string;
  /** Internal code name (used for identification in code, not shown to users) */
  name: string;
  /** Friendly name shown in the UI dropdown. Falls back to `name` if not set */
  displayName?: string;
  /** Priority for ordering in the UI dropdown. Lower = higher. Defaults to 999 */
  order?: number;
  /** Base URL of the provider */
  baseUrl: string;
  /** Master toggle — disable a provider entirely */
  enabled?: boolean;
  /** Embed URL builders */
  embed: {
    movie: (id: string) => string;
    tv: (id: string, season: number, episode: number) => string;
  };
  /** Security protection config (per-provider toggle) */
  protection?: ProviderProtection;
}

/**
 * @deprecated Use ProviderDefinition instead
 */
export interface ProviderSanitizer {
  name: string;
  sanitize: (html: string, url: string) => string;
}
