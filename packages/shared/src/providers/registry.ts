import type { ProviderDefinition, MediaType } from "../types/provider";

/**
 * App-wide content mode (Hard Mode Split). Mobile drives the whole app off
 * this; web/desktop still lean on `animeOnly`/`ANIME_PROVIDER_IDS` until
 * migrated. `'movie_tv'` = TMDB movies & TV; `'anime'` = MAL/AniList-keyed.
 */
export type AppMode = MediaType; // 'movie_tv' | 'anime'

/**
 * All providers registered in one place.
 * To add a new provider: append an entry to this array.
 * To remove: set `enabled: false` or delete the entry.
 * To reorder: adjust `order` (lower = higher in list, defaults to 999).
 * To hide the real provider name: set `displayName` (shown in UI instead of `name').
 *
 * Enabled servers in order: 1, 2, 3, 4, 5, 6, 14, 18, 19, 20, StreamGuide
 */
export const PROVIDERS: ProviderDefinition[] = [
  // ── Server 1 (DISABLED — behind Cloudflare, proxy unreliable) ──
  {
    id: "nxsha",
    name: "Nxsha",
    displayName: "Source 1",
    mediaTypes: ["movie_tv", "anime"], // Hybrid — carries some anime
    note: "Multi-lang · Fast · Sometimes gets down",
    baseUrl: "https://web.nxsha.app",
    embed: {
      movie: (id) =>
        `/embed/movie/${id}?disable_dl_button=true&disable_app_ad=true&lang=hi`,
      tv: (id, season, episode) =>
        `/embed/tv/${id}/${season}/${episode}?disable_dl_button=true&disable_app_ad=true&lang=hi`,
    },
    sandbox: "allow-scripts allow-same-origin ",
    // Hidden from the web picker (mobile + desktop show all enabled).
    platforms: ["mobile"],
    allowedOrigins: [
      "https://web.nxsha.app",
      // Common video CDNs nxsha may use for streaming
      "https://nxcdn.app",
      "https://cdn.nxsha.app",
    ],

    protection: {
      enabled: true,
      customBlockPatterns: [
        "/pop.js",
        "/popunder.js",
        "/track.php",
        "/ad.php",
        "/banner.",
        "adservexsha",
        "nxsha-ads",
        "popad.",
      ],
    },
    // nxsha emits NOTHING — the app media hook (progress: 'app') reads its
    // <video> directly. No resume param; app seeks via injected JS on
    // content-ready (resume: 'postMessage').
    capabilities: {
      progress: "app",
      resume: "postMessage",
    },
  },
  // ── Server 2 ────────────────────────────────────────────────
  {
    id: "peachify",
    name: "peachify",
    displayName: "Source 2",
    mediaTypes: ["movie_tv"],
    note: "Multi-lang",
    baseUrl: "https://peachify.top/embed",
    embed: {
      movie: (id, startAt) =>
        `/movie/${id}?dub=Hi&accent=FF9900&cast=hide&pip=hide${startAt ? `&startAt=${Math.floor(startAt)}` : ""}`,
      tv: (id, season, episode, startAt) =>
        `/tv/${id}/${season}/${episode}?dub=Hi&accent=FF9900&cast=hide&pip=hide${startAt ? `&startAt=${Math.floor(startAt)}` : ""}`,
    },
    sandbox: "allow-scripts allow-same-origin ",
    // Hidden from the web picker (mobile + desktop show all enabled).
    platforms: ["mobile"],
    // V6: Next.js app — defer the heavy guard bundle to onPageFinished so
    // document_start injection doesn't break React 18 hydration (#418).
    reactSafe: true,
    allowedOrigins: [
      "https://peachify.top",
      "https://stats.peachify.top",
      "https://fonts.googleapis.com",
    ],
    // peachify posts PLAYER_EVENT natively (progress: 'native') and accepts a
    // ?startAt= resume param (resume: 'url').
    capabilities: {
      progress: "native",
      resume: "url",
    },
  },
  // ── Server 3 ────────────────────────────────────────────────
  {
    id: "screenscape",
    name: "ScreenScape",
    displayName: "Source 3",
    mediaTypes: ["movie_tv", "anime"], // Hybrid
    note: "Reliable · Multi-lang · Always-Work",
    baseUrl: "https://screenscape.me/embed",
    embed: {
      movie: (id) => `?tmdb=${id}&type=movie`,
      tv: (id, season, episode) =>
        `?tmdb=${id}&type=tv&s=${season}&e=${episode}`,
    },
    allowedOrigins: [
      "https://screenscape.me",
      "https://www.googletagmanager.com",
    ],
    sandbox: "allow-scripts allow-same-origin ",

    platforms: ["web"],
    // screenscape posts watch-history natively (progress: 'native') but has NO
    // resume param and self-resumes unpredictably. App is authoritative via a
    // 10s settle window (resume: 'none') that tolerates the provider's own
    // seek so the two don't double-jump.
    capabilities: {
      progress: "native",
      resume: "none",
    },
  },
  // ── Server 4 ──────────────────────────────────────────────────
  {
    id: "nhdapi",
    name: "NHD Api",
    displayName: "Source 4",
    note: "Original-lang · Simple",
    baseUrl: "https://nhdapi.com",
    enabled: false,
    embed: {
      movie: (id) =>
        `/movie/${id}?lang=Hindi&autoplay=true&autonext=true&title=false&download=false&episodelist=false&hideautonext=true&hidetitle=true&hidechromecast=true&hidepip=true&hideepisodelist=true&hideupscaler=true&hidesecondarycolor=true&hideiconcolor=true&hideprimarycolor=true&appearance=off&primarycolor=6C63FF&secondarycolor=9F9BFF&iconcolor=FFFFFF`,
      tv: (id, season, episode) =>
        `/tv/${id}/${season}/${episode}?lang=Hindi&autoplay=true&autonext=true&title=false&download=false&episodelist=false&hideautonext=true&hidetitle=true&hidechromecast=true&hidepip=true&hideepisodelist=true&hideupscaler=true&hidesecondarycolor=true&hideiconcolor=true&hideprimarycolor=true&appearance=off&primarycolor=6C63FF&secondarycolor=9F9BFF&iconcolor=FFFFFF`,
    },
    allowedOrigins: ["https://nhdapi.com"],
    sandbox: "allow-scripts allow-same-origin ",

    platforms: ["web"],
  },
  // ── Server 5 ──────────────────────────────────────────────────
  {
    id: "zxcstream",
    name: "ZxcStream",
    displayName: "Source 5",
    note: "Multi-lang · Cold-Startup",
    baseUrl: "https://zxcstream.xyz",
    embed: {
      movie: (id) =>
        `/player/movie/${id}?dubLang=hi&autoplay=true&server=1&domainAd=filmsnap-pro.netlify.app&color=FFD700`,
      tv: (id, season, episode) =>
        `/player/tv/${id}/${season}/${episode}?dubLang=hi&autoplay=true`,
    },
    allowedOrigins: ["https://zxcstream.xyz"],
    sandbox: "allow-scripts allow-same-origin ",

    // Hidden from the web picker (mobile + desktop show all enabled).
    platforms: ["mobile"],
    // V6: Next.js app (serves /_next/static) — same disable-devtool neutralization
    // interference as peachify. Disable the doc-start devblock so the type=4
    // warning loop stops; native video detection still finds the stream.
    reactSafe: true,
    // Expert fix (2026-08-15): inject the surgical console.log mask at
    // document_start to defeat disable-devtool's FuncToString (type=4) false
    // positive (Android WebView native console-serialization bridge). With this
    // in place, full RN injection (guard + scriptlets + bridge + progress) is
    // re-enabled for zxcstream — `disableInjection` is no longer needed.
    disableDevtoolPatch: true,
    // zxcstream emits NOTHING — app media hook (progress: 'app'); no resume
    // param, app seeks via injected JS (resume: 'postMessage').
    capabilities: {
      progress: "app",
      resume: "postMessage",
    },
  },
  // ── Server 6 ──────────────────────────────────────────────────
  {
    id: "cinemaos",
    name: "CinemaOS",
    displayName: "Source 6",
    note: "Multi-lang · Sometimes works best",
    baseUrl: "https://cinemaos.live",
    embed: {
      movie: (id) => `/movie/watch/${id}`,
      tv: (id, season, episode) =>
        `/tv/watch/${id}?season=${season}&episode=${episode}`,
    },
    allowedOrigins: ["https://cinemaos.live"],
    sandbox: "allow-scripts allow-same-origin ",
    coverOverlays: [
      { top: "8px", left: "23%", width: "127px", height: "67px" },
    ],
    platforms: ["web"],
    // cinemaos emits NOTHING — app media hook (progress: 'app'); no resume param,
    // app seeks via injected JS (resume: 'postMessage').
    capabilities: {
      progress: "app",
      resume: "postMessage",
    },
  },
  // ── Falix [Direct, HEVC] ────────────────────────────────────────
  // HEVC content played via native expo-video player (hardware decode).
  // MKV files with x265 HEVC encoding, direct URL playback.
  // Currently download-only — in-app playback not yet enabled.
  {
    id: "falix",
    name: "Falix",
    displayName: "Falix",
    note: "HEVC downloads",
    enabled: true,
    forDownloadOnly: true,
    order: 7,
    baseUrl: "https://download-falix-falixmovies-backend-hf.hf.space",
    embed: {
      movie: (id) => `/api/id/${id}`,
      tv: (id) => `/api/id/${id}`,
    },
    platforms: ["mobile"],
  },
  // ── Server 22 (disabled — was Server 5) ──────────────────────
  {
    id: "multiembed",
    name: "MultiEmbed",
    displayName: "Server 22",
    enabled: false,
    baseUrl: "https://multiembed.mov",
    embed: {
      movie: (id) => `/?video_id=${id}&tmdb=1`,
      tv: (id, season, episode) =>
        `/?video_id=${id}&tmdb=1&s=${season}&e=${episode}`,
    },
  },
  // ── Server 21 (disabled — was Server 5) ────────────────────────
  {
    id: "vidbinge",
    name: "VidBinge",
    displayName: "Server 21",
    enabled: false,
    baseUrl: "https://vidbinge.to",
    embed: {
      movie: (id) => `/movie/${id}`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}`,
    },
  },

  // ── Server 7 (disabled) ─────────────────────────────────────
  {
    id: "vidfast",
    name: "VidFast",
    displayName: "Server 7",
    enabled: false,
    baseUrl: "https://vidfast.pro",
    embed: {
      movie: (id) => `/movie/${id}`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}`,
    },
  },
  // ── VidSrc family (disabled) ────────────────────────────────
  {
    id: "vidsrc",
    name: "VidSrc 1",
    displayName: "Server 8",
    enabled: false,
    baseUrl: "https://www.viduki.net",
    embed: {
      movie: (id) => `/api/1/movie/?id=${id}&color=e01621`,
      tv: (id, season, episode) =>
        `/api/1/tv/?id=${id}&season=${season}&episode=${episode}&color=e01621`,
    },
  },
  {
    id: "vidsrc2",
    name: "VidSrc 2",
    displayName: "Server 9",
    enabled: false,
    baseUrl: "https://www.viduki.net",
    // Next.js app (serves /_next/static) — defer the heavy guard bundle to
    // post-hydration (reactSafe) to avoid breaking React 18 hydration, and
    // inject the disable-devtool FuncToString mask at document_start. viduki.net
    // loads `cdn.jsdelivr.net/npm/disable-devtool@latest` which false-positives
    // in the Android WebView console-serialization bridge and blanks/breaks the
    // player (same root cause + fix as zxcstream).
    reactSafe: true,
    disableDevtoolPatch: true,
    embed: {
      movie: (id, startAt) =>
        `/2/movie/${id}?color=e01621${startAt ? `&progress=${Math.floor(startAt)}` : ""}`,
      tv: (id, season, episode, startAt) =>
        `/2/tv/${id}/${season}/${episode}?color=e01621${startAt ? `&progress=${Math.floor(startAt)}` : ""}`,
    },
    // viduki.net (vidsrc2) posts MEDIA_DATA natively (progress: 'native') and
    // accepts a ?progress= resume param (resume: 'url').
    capabilities: {
      progress: "native",
      resume: "url",
    },
  },
  {
    id: "vidsrc3",
    name: "VidSrc 3",
    displayName: "Server 10",
    enabled: false,
    baseUrl: "https://www.viduki.net",
    embed: {
      movie: (id) => `/api/3/movie/?id=${id}&color=e01621`,
      tv: (id, season, episode) =>
        `/api/3/tv/?id=${id}&season=${season}&episode=${episode}&color=e01621`,
    },
  },
  {
    id: "vidsrc4",
    name: "VidSrc 4",
    displayName: "Server 11",
    enabled: false,
    baseUrl: "https://www.viduki.net",
    embed: {
      movie: (id) => `/api/4/movie/?id=${id}&color=e01621`,
      tv: (id, season, episode) =>
        `/api/4/tv/?id=${id}&season=${season}&episode=${episode}&color=e01621`,
    },
  },
  {
    id: "vidsrc5",
    name: "VidSrc 5",
    displayName: "Server 12",
    enabled: false,
    baseUrl: "https://vidsrc.su",
    embed: {
      movie: (id) => `/movie/${id}&colour=00ff9d`,
      tv: (id, season, episode) =>
        `/tv/${id}/${season}/${episode}&colour=00ff9d`,
    },
  },
  {
    id: "vidsrc6",
    name: "VidSrc 6",
    displayName: "Server 13",
    enabled: false,
    baseUrl: "https://vidsrc-embed.ru",
    embed: {
      movie: (id) => `/embed/movie/${id}`,
      tv: (id, season, episode) => `/embed/tv/${id}/${season}/${episode}`,
    },
  },
  // ── Server 14 ───────────────────────────────────────────────
  {
    id: "vidnest",
    name: "Vidnest",
    displayName: "Source 14",
    note: "Very Fast · Limited-Multi-lang · Best for Original lang",
    baseUrl: "https://vidnest.fun",
    embed: {
      movie: (id, startAt) =>
        `/movie/${id}${startAt ? `?startAt=${Math.floor(startAt)}` : ""}`,
      tv: (id, season, episode, startAt) =>
        `/tv/${id}/${season}/${episode}${startAt ? `?startAt=${Math.floor(startAt)}` : ""}`,
    },
    allowedOrigins: ["https://vidnest.fun"],
    // Hidden from the web picker (mobile + desktop show all enabled).
    platforms: ["mobile"],
    // vidnest posts MEDIA_DATA + PLAYER_EVENT natively (progress: 'native') and
    // accepts a ?startAt= resume param (resume: 'url').
    capabilities: {
      progress: "native",
      resume: "url",
    },
  },
  // ── Server 15 (disabled) ────────────────────────────────────
  {
    id: "vidpro",
    name: "VidPro",
    displayName: "Server 15",
    enabled: false,
    baseUrl: "https://vidlink.pro",
    embed: {
      movie: (id) => `/movie/${id}`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}`,
    },
  },
  // ── Server 16 (disabled — always returns HTTP 403) ─────────
  {
    id: "vixsrc",
    name: "Vixsrc",
    displayName: "Server 16",
    enabled: false,
    baseUrl: "https://vixsrc.to",
    embed: {
      movie: (id, startAt) =>
        `/movie/${id}${startAt ? `?startAt=${Math.floor(startAt)}` : ""}`,
      tv: (id, season, episode, startAt) =>
        `/tv/${id}/${season}/${episode}${startAt ? `?startAt=${Math.floor(startAt)}` : ""}`,
    },
  },
  // ── Server 17 (disabled) ────────────────────────────────────
  {
    id: "vidup",
    name: "VidUp",
    displayName: "Server 17",
    enabled: false,
    baseUrl: "https://vidup.to",
    embed: {
      movie: (id) => `/movie/${id}?autoPlay=true`,
      tv: (id, season, episode) =>
        `/tv/${id}/${season}/${episode}?autoPlay=true`,
    },
  },
  {
    id: "vidvault",
    name: "VidVault",
    displayName: "VidVault",
    enabled: false,
    baseUrl: "https://vidvault.ru",
    embed: {
      movie: (id) => `/movie/${id}`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}`,
    },
  },
  // ── Server 20 (disabled) ────────────────────────────────────
  {
    id: "videasy",
    name: "videasy",
    displayName: "Server 20",
    note: "Limited-Multi-lang · Best for Original lang",
    // enabled: false,
    baseUrl: "https://player.videasy.net",
    embed: {
      movie: (id, startAt) =>
        `/movies/${id}${startAt ? `?progress=${Math.floor(startAt)}` : ""}`,
      tv: (id, season, episode, startAt) =>
        `/tv/${id}/${season}/${episode}${startAt ? `?progress=${Math.floor(startAt)}` : ""}`,
    },
    // videasy emits no live events — app media hook (progress: 'app'); resume is
    // via the ?progress= URL param only (resume: 'url').
    capabilities: {
      progress: "app",
      resume: "url",
    },
  },
  // ── Server 18 ───────────────────────────────────────────────
  {
    id: "chillflix",
    name: "ChillFlix",
    displayName: "Source 18",
    note: "Slow to load · Only original lang",
    baseUrl: "https://www.chillflix.lol/embed",
    enabled: false,
    embed: {
      movie: (id) =>
        `/movie/${id}?autoplay=true&watchparty=false&title=false&parent_origin=${encodeURIComponent("https://www.chillflix.lol")}`,
      tv: (id, season, episode) =>
        `/tv/${id}/${season}/${episode}?autoplay=true&watchparty=false&title=false&parent_origin=${encodeURIComponent("https://www.chillflix.lol")}`,
    },
    // Loaded directly (cross-origin, Cloudflare) — sandbox is the primary defense
    sandbox: "allow-scripts allow-same-origin ",
    allowedOrigins: ["https://www.chillflix.lol"],
    // Hidden from the web picker (mobile + desktop show all enabled).
    platforms: ["mobile"],
    // chillflix emits NOTHING observable — app media hook (progress: 'app'); no
    // resume param, app seeks via injected JS (resume: 'postMessage').
    capabilities: {
      progress: "app",
      resume: "postMessage",
    },
  },
  // ── Server 21 (VidZee) ──────────────────────────────────────
  // {
  //   id: "vidzee",
  //   name: "VidZee",
  //   displayName: "VidZee",
  //   order: 21,
  //   baseUrl: "https://player.vidzee.wtf",
  //   embed: {
  //     movie: (id) => `/embed/movie/${id}`,
  //     tv: (id, season, episode) =>
  //       `/embed/tv/${id}/${season}/${episode}`,
  //   },
  //   allowedOrigins: ["https://player.vidzee.wtf"],
  //   sandbox: "allow-scripts allow-same-origin ",

  //   // Visible on web + mobile (no platforms field = everywhere).
  // },
  // ── Server 19 (was Server 6) ─────────────────────────────────
  {
    id: "vidking",
    name: "VidKing",
    displayName: "Source 19",
    enabled: false,
    baseUrl: "https://www.vidking.net",
    embed: {
      movie: (id) => `/embed/movie/${id}?color=ff0000`,
      tv: (id, season, episode) =>
        `/embed/tv/${id}/${season}/${episode}?color=ff0000`,
    },
    allowedOrigins: ["https://www.vidking.net"],
  },
  // ── Server 20 ───────────────────────────────────────────────

  {
    id: "toustream",
    name: "TouStream",
    displayName: "Source 20",
    enabled: false,
    baseUrl: "https://toustream.xyz",
    embed: {
      movie: (id) => `/tou/movies/${id}`,
      tv: (id, season, episode) => `/tou/tv/${id}/${season}/${episode}`,
    },
    allowedOrigins: ["https://toustream.xyz"],
  },
  // ── StreamGuide ─────────────────────────────────────────────
  {
    id: "streamguide",
    name: "StreamGuide",
    displayName: "StreamGuide",
    enabled: false,

    baseUrl: "https://streamguide.cfd",
    embed: {
      movie: (id) => `/embed/?type=m&id=m-api-${id}&ep=m-api-${id}`,
      tv: (id, season, episode) =>
        `/embed/?type=t&id=t-api-${id}&ep=t-api-${id}-s${season}e${episode}`,
    },
    allowedOrigins: ["https://streamguide.cfd"],
  },
  // ── MegaPlay (anime-only · MAL/AniList-keyed) ───────────────
  // URL shapes: /stream/mal/<malId>/<ep>/<sub|dub> and /stream/ani/<anilistId>/...
  // Keyed by MyAnimeList/AniList IDs, NOT TMDB. `animeOnly` keeps it out of
  // every movie/TV picker (all platforms); it appears only in anime-profiled
  // watch sessions, where the caller passes EmbedOptions.idSpace + resolved ids.
  // Expert verdict Q6a/Q8: opts-based builders, v1 sub-only UI (opts.audio is
  // honored but never set by callers yet).
  {
    id: "megaplay",
    name: "MegaPlay",
    displayName: "MegaPlay",
    note: "Anime · Sub & Dub",
    baseUrl: "https://megaplay.buzz",
    mediaTypes: ["anime"],
    enabled: true,
    animeOnly: true,
    order: 30,
    embed: {
      // Anime film — no episode segment.
      movie: (id, _startAt, opts) =>
        `/stream/${opts?.idSpace === "ani" ? "ani" : "mal"}/${id}/${
          opts?.audio === "dub" ? "dub" : "sub"
        }`,
      tv: (id, _season, episode, _startAt, opts) =>
        `/stream/${opts?.idSpace === "ani" ? "ani" : "mal"}/${id}/${episode}/${
          opts?.audio === "dub" ? "dub" : "sub"
        }`,
    },
    allowedOrigins: [
      "https://megaplay.buzz",
      "https://megacloud.animanga.fun",
      "https://upcloud.animanga.fun",
    ],
    sandbox: "allow-scripts allow-same-origin ",
    // Player posts events over window.parent.postMessage (megacloud channel) —
    // event contract unverified, so progress stays default-native (passive)
    // and resume stays default-postMessage: unlike screenscape, MegaPlay does
    // not self-resume (fresh loads start at 0), so an app-side seek is safe to
    // attempt and silently degrades if the nested player ignores it.
  },
];

/**
 * Look up a provider by its id
 */
export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find(
    (p) => p.id === id.toLowerCase() && p.enabled !== false,
  );
}

/**
 * Get only enabled providers (for UI dropdown, sorted by priority)
 * @param includeDownloadOnly - if true, includes providers marked as forDownloadOnly
 */
export function getEnabledProviders(
  includeDownloadOnly = false,
): ProviderDefinition[] {
  return PROVIDERS.filter(
    (p) => p.enabled !== false && (includeDownloadOnly || !p.forDownloadOnly),
  ).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

/**
 * Providers allowed in an anime-profiled watch session, in picker priority
 * order (expert verdict: servers 1 + 3 carry some anime; megaplay is the
 * dedicated anime source). Intersected with each platform's own rules.
 */
export const ANIME_PROVIDER_IDS = ["nxsha", "screenscape", "megaplay"];

/**
 * Intersect a platform-filtered provider list with the anime allowlist.
 * Callers apply their platform filtering first; this narrows to anime-capable
 * servers only.
 */
export function filterAnimeProviders(
  providers: ProviderDefinition[],
): ProviderDefinition[] {
  const allow = new Set<string>(ANIME_PROVIDER_IDS);
  return providers.filter((p) => allow.has(p.id));
}

/**
 * Providers for regular movie/TV sessions — excludes `animeOnly` providers
 * whose URLs are keyed by MAL/AniList ids and would break with a TMDB id.
 * Every server-picker surface (web, desktop, mobile RN) must derive its list
 * through this (or an equivalent filter) rather than the raw enabled list.
 */
export function getNonAnimeProviders(): ProviderDefinition[] {
  return getEnabledProviders().filter((p) => p.animeOnly !== true);
}

/**
 * Hard Mode Split picker (mobile). Returns enabled providers whose
 * `mediaTypes` includes the active mode. Providers without `mediaTypes` are
 * treated as `['movie_tv']` (legacy default) so unmigrated entries still
 * appear in movie/TV mode. Prefer this over `getNonAnimeProviders` /
 * `filterAnimeProviders` on mobile.
 */
export function getProvidersForMode(mode: MediaType): ProviderDefinition[] {
  return getEnabledProviders().filter((p) =>
    (p.mediaTypes ?? ["movie_tv"]).includes(mode),
  );
}

/**
 * Check whether protection is enabled for a given provider
 */
export function isProtectionEnabled(provider: ProviderDefinition): boolean {
  return provider.protection?.enabled ?? true;
}

/**
 * Check whether the Skip Intro / Skip Recap button should show for a given
 * provider. Absent flag = enabled (current behavior: all providers get it).
 *
 * @deprecated Prefer `isUiEnabled(provider, 'intro')`, which also reads the
 * new `capabilities.ui` matrix.
 */
export function isSkipIntroEnabled(provider: ProviderDefinition): boolean {
  return provider.skipIntroEnabled ?? true;
}

/**
 * Read a single UI capability toggle, honoring the `capabilities.ui` matrix
 * with `skipIntroEnabled` backward-compat and an "enabled by default" rule.
 *
 * This is the single switch the watch page uses to decide whether to render
 * the Skip-Intro, Next-Episode, or Watch-Progress affordances for a provider.
 */
export function isUiEnabled(
  provider: ProviderDefinition,
  feature: "intro" | "nextEpisode" | "watchProgress",
): boolean {
  const ui = provider.capabilities?.ui;
  if (ui && feature in ui) return ui[feature] ?? true;
  // Backward-compat: the legacy `skipIntroEnabled` flag only ever governed
  // the intro button; next-episode / watch-progress were always on.
  if (feature === "intro" && provider.skipIntroEnabled !== undefined) {
    return provider.skipIntroEnabled;
  }
  return true;
}

/**
 * Resolve the effective progress-source mode for a provider.
 * Default `'native'` — existing postMessage paths keep working unchanged.
 */
export function getProgressMode(
  provider: ProviderDefinition,
): "native" | "app" | "none" {
  return provider.capabilities?.progress ?? "native";
}

/**
 * Resolve the effective resume mode for a provider.
 * Default `'postMessage'` — app seeks via injected JS on content-ready.
 */
export function getResumeMode(
  provider: ProviderDefinition,
): "url" | "postMessage" | "none" {
  return provider.capabilities?.resume ?? "postMessage";
}
