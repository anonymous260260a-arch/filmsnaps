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
 * Content mode for the Hard Mode Split. A provider advertises which modes it
 * can serve via `mediaTypes`; the app picks providers with
 * `p.mediaTypes.includes(currentMode)`.
 */
export type MediaType = "movie_tv" | "anime";

/**
 * Extra context threaded to embed URL builders. Providers that key their
 * URLs by non-TMDB ID spaces (anime providers use MAL / AniList ids) read
 * `idSpace`; audio-track selection reads `audio`. All fields optional —
 * absent values fall back to the provider's documented default.
 */
export interface EmbedOptions {
  /**
   * Which ID space `id` belongs to. Default `'mal'`.
   * MegaPlay: `/stream/mal/<id>/…` vs `/stream/ani/<id>/…`.
   */
  idSpace?: "mal" | "ani";
  /** Audio track path segment. Default `'sub'` (v1 ships sub-only UI). */
  audio?: "sub" | "dub";
}

/**
 * Playback architecture of a provider. The single discriminator every watch
 * surface should branch on — never provider-id string matching.
 *
 * - `'embed'` — URL from `embed.*` loads in SecureIframe (web), VideoWebView
 *   (mobile) or WebContentsView (desktop). Stream URLs come from inside the
 *   iframe via postMessage.
 * - `'direct'` — native video player (DirectVideoPlayer / HevcPlayer / mpv).
 *   Stream URLs are resolved externally via the provider's `streamSources`.
 */
export type ProviderType = "embed" | "direct";

/**
 * Declarative config for one upstream API backing a direct provider.
 * Data only — the parsing behavior lives in the matching StreamSourceAdapter
 * (registered in packages/shared/src/providers/sources/index.ts), keyed by
 * `id`. Adding an upstream API = one adapter file + one entry here.
 */
export interface StreamSourceConfig {
  /** Unique source id, e.g. "hdhub", "falix" — must match a registered adapter. */
  id: string;
  /** Base URL of the upstream API, no trailing slash. */
  apiBase: string;
  /** What this API serves. */
  kind: "streams" | "downloads" | "m3u8" | "raw";
  /** Master toggle — false disables this source. */
  enabled: boolean;
  /**
   * Adapter registry key (sources/index.ts). Defaults to the source id —
   * set it when several sources share one adapter (e.g. five spacedom
   * servers with one response shape).
   */
  adapter?: string;
  /** Priority tier — lower is better. Sources sharing a tier are fetched in parallel. */
  priority?: number;
  /** Per-source fetch timeout in ms (the tier escalates after it expires). */
  timeoutMs?: number;
  /** Playable-link count this tier must produce before later tiers are skipped. */
  minPlayable?: number;
  /** URL template for APIs keyed by path. Placeholders: {tmdbId} {imdbId} {type} {season} {episode}. */
  urlTemplate?: string;
  /** URL template for TV episodes. */
  urlTemplateTv?: string;
  /** Optional custom headers for API requests. */
  headers?: Record<string, string>;
  /**
   * Extra attempts when a source comes up empty or errors. Some upstreams
   * (spacedom) intermittently return "unavailable" on the first request.
   */
  retries?: number;
  /** Delay between retry attempts in ms. Defaults to 800. */
  retryDelayMs?: number;
}

/**
 * App surfaces a provider can be shown on / defaulted for. Used by the
 * `platforms` visibility filter and the platform-defaults table in the
 * registry — the single source of truth for per-platform availability.
 */
export type ProviderPlatform = "web" | "mobile" | "desktop";

/**
 * Single provider definition — the source of truth
 */
export interface ProviderDefinition {
  /** Unique identifier (lowercase, used in URLs & code) */
  id: string;
  /** Internal code name (used for identification in code, not shown to users) */
  name: string;
  /**
   * Playback architecture. Default `'embed'` — only direct-play providers
   * (falix, direct) need to set this explicitly.
   */
  type?: ProviderType;
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
  /** Embed URL builders. `opts` carries ID-space/audio context (see EmbedOptions). */
  embed: {
    movie: (id: string, startAt?: number, opts?: EmbedOptions) => string;
    tv: (
      id: string,
      season: number,
      episode: number,
      startAt?: number,
      opts?: EmbedOptions,
    ) => string;
  };

  /**
   * Anime-exclusive provider keyed by MAL/AniList ids (never TMDB). Such
   * providers are excluded from movie/TV server pickers on every platform and
   * appear only when a watch session is anime-profiled (ANIME_PROVIDER_IDS
   * allowlist in registry.ts). Default: false.
   */
  animeOnly?: boolean;
  /**
   * Hard-mode-split capabilities (mobile-first). Replaces the brittle
   * `animeOnly` boolean + `ANIME_PROVIDER_IDS` array as the picker source of
   * truth. A provider may serve both worlds (hybrid: `['movie_tv','anime']`).
   * Picker logic: `providers.filter(p => p.mediaTypes.includes(currentMode))`.
   * Additive — `animeOnly` is retained for web/desktop until they migrate.
   */
  mediaTypes?: MediaType[];
  /** Security protection config (per-provider toggle) */
  protection?: ProviderProtection;

  /**
   * Which platforms this provider should be available on.
   * Omit or set to all platforms (default) to show everywhere.
   * Example: ['web'] to only show on web, ['mobile'] for mobile only.
   * Desktop consumers that render providers inside Electron WebContentsViews
   * may ignore this filter (all enabled providers are shown there today).
   */
  platforms?: ProviderPlatform[];

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

  /**
   * Upstream APIs backing a `type: 'direct'` provider. The resolution
   * pipeline (shared/providers/resolveStreams.ts) fetches each enabled
   * source through its adapter and merges all streams into one pool that
   * the shared stream selector ranks. Ignored by embed providers.
   */
  streamSources?: StreamSourceConfig[];

  /**
   * Stream selector id (selectors/index.ts) that orders this provider's
   * resolved link pool into the playback chain. Absent = the generic
   * quality/size/language ranker ("default"). Set when a provider's links
   * need provider-specific ordering — e.g. spacedom always leads with
   * heron's original-quality file regardless of size metadata.
   */
  selection?: string;

  /**
   * How streams from multiple `streamSources` are merged before ranking.
   * Default `'concat'`. `'interleave'` round-robins one stream per source.
   */
  mergeStrategy?: "concat" | "interleave";
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
