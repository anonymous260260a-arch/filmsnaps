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
  /**
   * Short tagline shown next to the display name in server pickers
   * (rendered as a distinct pill, e.g. "Multi-lang · Fast").
   * Kept separate from `displayName` so the name stays clean.
   */
  note?: string;
  /** Priority for ordering in the UI dropdown. Lower = higher. Defaults to 999 */
  order?: number;
  /** Base URL of the provider */
  baseUrl: string;
  /** Master toggle — disable a provider entirely */
  enabled?: boolean;
  /** Embed URL builders */
  embed: {
    movie: (id: string, startAt?: number) => string;
    tv: (
      id: string,
      season: number,
      episode: number,
      startAt?: number,
    ) => string;
  };
  /** Security protection config (per-provider toggle) */
  protection?: ProviderProtection;

  /**
   * Which platforms this provider should be available on.
   * Omit or set to all platforms (default) to show everywhere.
   * Example: ['web'] to only show on web, ['mobile'] for mobile only.
   */
  platforms?: ("web" | "mobile")[];

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
   * V6: marks a provider as a React/Next.js (hydration-sensitive) app.
   *
   * When true, the heavy shared guard bundle is deferred to onPageFinished
   * (post-hydration) and only a MINIMAL disable-devtool redirect blocker runs
   * at document_start (no global native-patch, no <style> injection, no
   * innerHTML blank-block). This is required for peachify, whose Next.js
   * hydration throws React error #418 when the full bundle runs at doc-start.
   * Default: false. Native side mirrors this via providers.json
   * providers[].reactSafe.
   */
  reactSafe?: boolean;

  /**
   * Skip ALL React-Native JS injection (injectedJavaScriptBeforeContentLoaded,
   * injectedJavaScriptAfterLoad, and the handleLoadingStart ref spray) for this
   * provider. Used for zxcstream (Source 5), whose in-page disable-devtool
   * detector spams a `type=4` "no devtool access" warning in an infinite loop
   * whenever our bundle overrides native methods (the uBO scriptlets patch
   * Object.defineProperty / addEventListener / setInterval, which disable-devtool
   * flags as tampering). With injection fully disabled the loop stops and the
   * stream still plays, because video detection (shouldInterceptRequest →
   * session-trust / cdn-allowlist / media-range) and network ad-blocking
   * (AdblockEngine) are NATIVE and live outside this RN bundle. Default: false.
   */
  disableInjection?: boolean;

  /**
   * Inject the surgical `disable-devtool` `type=4` (FuncToString) neutralizer at
   * `document_start`. zxcstream (Source 5) inlines `theajack/disable-devtool`,
   * whose FuncToString detector is falsely tripped by the Android WebView native
   * console-serialization bridge. The mask wraps `console.log` so the trap's
   * counter never increments. Set per-provider (not global) so only affected
   * providers pay for it. Default: false. Native side mirrors this via
   * providers.json providers[].disableDevtoolPatch.
   */
  disableDevtoolPatch?: boolean;

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
  coverOverlays?: Array<{
    top: string;
    left: string;
    width: string;
    height: string;
  }>;

  /**
   * If true, this provider is ONLY available for download pages,
   * not for the watch page server picker. Useful for direct-download
   * providers like Falix that don't have a streaming embed player.
   * Default: false
   */
  forDownloadOnly?: boolean;

  /**
   * @deprecated Use `capabilities.ui.intro` instead. Kept for backward
   * compatibility — when both are present, `capabilities.ui.intro` wins.
   * Enable the Skip Intro / Skip Recap overlay button for this provider's
   * player. Absent = enabled.
   */
  skipIntroEnabled?: boolean;

  /**
   * Per-provider playback capability matrix (the "flexible toggles" the
   * watch-progress redesign requires). Lets us turn intro / next-episode /
   * watch-progress on or off for any provider from config, not code, and
   * declares how each provider feeds time + resume.
   *
   * Any field left undefined falls back to the documented default, so we
   * don't have to touch every provider at once.
   */
  capabilities?: ProviderCapabilities;
}

/**
 * How each provider feeds playback data + which UI affordances it gets.
 *
 * - `progress`:
 *     - `'native'` — provider posts playback events itself (peachify's
 *       PLAYER_EVENT, screenscape's watch-history, vidnest/viduki's
 *       MEDIA_DATA). No in-page poller needed.
 *     - `'app'` — provider emits NOTHING. The app injects a lightweight
 *       main-frame media hook (MutationObserver + 1 Hz poll) that reads the
 *       cross-origin `<video>` currentTime/duration and posts `fs:progress`.
 *     - `'none'` — don't track progress at all.
 * - `resume`:
 *     - `'url'` — app passes a start position via the embed URL (`?startAt=`
 *       / `?progress=`). App is authoritative; provider must NOT self-resume.
 *     - `'postMessage'` — app seeks via injected JS after content-ready
 *       (used for providers with no resume param).
 *     - `'none'` — provider self-resumes unpredictably; app applies a settle
 *       window and ignores backward drift rather than fighting it.
 * - `ui` — which RN overlay buttons the watch page renders. Each defaults
 *   to `true`.
 */
export interface ProviderCapabilities {
  /** How the app obtains live currentTime/duration. Default `'native'`. */
  progress?: "native" | "app" | "none";
  /** How resume is applied. Default `'postMessage'`. */
  resume?: "url" | "postMessage" | "none";
  /** Which overlay buttons to render. Each absent = enabled. */
  ui?: {
    intro?: boolean;
    nextEpisode?: boolean;
    watchProgress?: boolean;
  };
}

/**
 * @deprecated Use ProviderDefinition instead
 */
export interface ProviderSanitizer {
  name: string;
  sanitize: (html: string, url: string) => string;
}
