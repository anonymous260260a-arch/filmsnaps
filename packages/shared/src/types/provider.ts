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
    movie: (id: string, startAt?: number) => string;
    tv: (id: string, season: number, episode: number, startAt?: number) => string;
  };
  /** Security protection config (per-provider toggle) */
  protection?: ProviderProtection;

  /**
   * Which platforms this provider should be available on.
   * Omit or set to all platforms (default) to show everywhere.
   * Example: ['web'] to only show on web, ['mobile'] for mobile only.
   */
  platforms?: ('web' | 'mobile')[];

  /**
   * Custom sandbox attributes for the iframe embedding this provider.
   *
   * Controls what browser capabilities the iframe gets. Harder sandbox
   * = fewer popups/redirects but some providers may break.
   *
   * Default: "allow-scripts allow-same-origin allow-presentation"
   *   (-) No allow-popups — blocks window.open popups
   *   (-) No allow-forms  — blocks form submissions
   *   (+) allow-presentation — enables Presentation API (casting)
   */
  sandbox?: string;

  /**
   * Allowed external origins for Content-Security-Policy headers.
   *
   * These drive the `frame-src`, `media-src`, `connect-src`, and
   * `script-src` directives on proxied response headers so that
   * provider video players and CDN chunks can load.
   *
   * Typically just the provider's baseUrl origin, but some providers
   * use separate CDN origins for video chunks, subtitles, etc.
   *
   * Example: ['https://cdn.peachify.top', 'https://fonts.googleapis.com']
   */
  allowedOrigins?: string[];

  /**
   * Positioned overlay divs that cover known ad elements on the provider's page.
   *
   * Same-Origin Policy prevents us from reaching into the cross-origin iframe
   * DOM to hide elements. Instead, we place covering divs on the parent page
   * at the exact coordinates of the ad element on top of the iframe.
   *
   * These use `pointer-events: none` so video controls still work through them.
   *
   * Example: `[{ top: '80px', left: '40%', width: '200px', height: '60px' }]`
   */
  coverOverlays?: Array<{ top: string; left: string; width: string; height: string }>;

  /**
   * If true, this provider is ONLY available for download pages,
   * not for the watch page server picker. Useful for direct-download
   * providers like Falix that don't have a streaming embed player.
   * Default: false
   */
  forDownloadOnly?: boolean;
}

/**
 * @deprecated Use ProviderDefinition instead
 */
export interface ProviderSanitizer {
  name: string;
  sanitize: (html: string, url: string) => string;
}
