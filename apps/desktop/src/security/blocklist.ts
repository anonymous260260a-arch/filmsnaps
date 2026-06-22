/**
 * FilmSnaps Desktop — Consolidated Security Blocklist
 *
 * Merges the mobile app's 45-domain ad blocklist with the web app's
 * 120+ DEFAULT_BLOCKED_PATTERNS into a single optimized lookup.
 *
 * Structure for fast matching:
 *   - DOMAIN_SET    — exact substring domain match (O(1) per domain via Set)
 *   - PATTERN_LIST  — URI substring patterns (trackers, analytics paths)
 *   - DOWNLOAD_EXTS — file extensions to block (.apk, .exe, .zip, etc.)
 */

// ── Domain-based rules (fast substring match) ──
export const DOMAIN_BLOCKLIST: ReadonlySet<string> = new Set([
  // Google / DoubleClick
  'doubleclick.net',
  'googleadservices.com',
  'googlesyndication.com',
  'google-analytics.com',
  'googletagmanager.com',
  'pagead2.googlesyndication.com',
  'ad.doubleclick.net',
  'stats.g.doubleclick.net',
  'analytics.google.com',

  // Facebook / Meta
  'connect.facebook.net',
  'an.facebook.com',
  'facebook.com/tr',
  'pixel.facebook.com',

  // Ad networks
  'adnxs.com',
  'rubiconproject.com',
  'criteo.com',
  'criteo.net',
  'outbrain.com',
  'taboola.com',
  'revcontent.com',
  'amazon-adsystem.com',
  'casalemedia.com',
  'contextweb.com',
  'openx.net',
  'pubmatic.com',
  'sharethrough.com',
  'media.net',
  'advertising.com',
  'adap.tv',
  'moatads.com',
  'exdynsrv.com',

  // Popup / popunder networks
  'popads.net',
  'popcash.net',
  'adsterra.com',
  'propellerads.com',
  'trafficfactory.biz',
  'exoclick.com',
  'juicyads.com',
  'plugrush.com',
  'trafficjunky.com',
  'adreactor.com',
  'adcash.com',
  'adhitz.com',
  'adk2.com',
  'adpierce.com',
  'clickadu.com',
  'clicksco.net',
  'hilltopads.com',

  // Analytics services
  'hotjar.com',
  'fullstory.com',
  'logrocket.com',
  'sentry.io',
  'mouseflow.com',
  'clarity.ms',
  'livesession.io',
  'heap.com',
  'mixpanel.com',
  'amplitude.com',
  'segment.io',
  'segment.com',
  'rudderstack.com',
  'histats.com',
  'statcounter.com',
  'scorecardresearch.com',

  // Cloudflare tracking / RUM
  'cloudflareinsights.com',
  'cloudflare-beacon.com',
  'cloudflarestream.com',

  // Crypto miners
  'coinhive.com',
  'coinimp.com',
  'webminepool.com',
]);

// ── URI substring patterns (broader matching) ──
export const PATTERN_BLOCKLIST: ReadonlyArray<string> = [
  // Cloudflare
  'cdn-cgi/rum',
  'cdn-cgi/challenge-platform',

  // Google tags
  'gtag/js',
  'analytics.',
  'google-analytics.com',

  // Ad network substrings
  'adsystem.',
  'adserver.',
  'ads.',
  'banner.',
  'popads.',
  'popcash.',
  'popup.',
  'popunder.',
  'cryptoloot.',
  'miner.',

  // Tracking / telemetry
  'pixel.',
  'track.',
  'tracking.',
  'beacon.',
  'telemetry.',
  'counter.',
  'umami.',
  'plausible.io',
  'matomo.',

  // Specific file patterns
  '/analytics.js',
  '/tracking.js',
  '/tracker.js',
  '/beacon.js',
  '/telemetry.js',
  '/rum.js',
  '/gtag.js',
  '/fbevents.js',
  '/pixel.js',

  // Query parameter trackers
  '?utm_',
  '?fbclid=',
  '?gclid=',
  '?_ga=',
  '?mc_cid=',
  '?mc_eid=',
  '?utm_source=',
  '?utm_medium=',
  '?utm_campaign=',
  '?utm_term=',
  '?utm_content=',
];

// ── Download file extensions to block ──
export const DOWNLOAD_EXTENSIONS: ReadonlyArray<string> = [
  '.apk',
  '.exe',
  '.msi',
  '.dmg',
  '.zip',
  '.rar',
  '.7z',
  '.tar.gz',
  '.tar.bz2',
  '.jar',
  '.crx',
  '.deb',
  '.rpm',
  '.appimage',
];

// ── Known video/embed domains that should be ALLOWED through iframe checks ──
export const VIDEO_DOMAIN_ALLOWLIST: ReadonlySet<string> = new Set([
  'vidsrc',
  'embed',
  'player',
  'video',
  'cdn',
  'peachify',
  'stream',
  'media',
  'hls',
  'dash',
  'm3u8',
]);

// ── Check functions ──

/**
 * Check if a URL matches any known ad, tracker, or malware pattern.
 * Runs in the Electron main process — cannot be bypassed by page JS.
 */
export function shouldBlockUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;

  const lower = url.toLowerCase();

  // 1. Fast domain check (Set.has is O(1))
  for (const domain of DOMAIN_BLOCKLIST) {
    if (lower.includes(domain)) return true;
  }

  // 2. Substring pattern check
  for (const pattern of PATTERN_BLOCKLIST) {
    if (lower.includes(pattern)) return true;
  }

  return false;
}

/**
 * Check if a URL points to a downloadable file that should be blocked.
 */
export function isDownloadUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;

  const lower = url.toLowerCase();

  for (const ext of DOWNLOAD_EXTENSIONS) {
    if (lower.includes(ext)) return true;
  }

  return false;
}

/**
 * Check if a hostname is a known video/embed domain that should bypass
 * iframe cleanup rules.
 */
export function isVideoDomain(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  for (const pattern of VIDEO_DOMAIN_ALLOWLIST) {
    if (lower.includes(pattern)) return true;
  }

  return false;
}

/**
 * Get a human-readable category label for a blocked URL.
 */
export function getBlockCategory(url: string): string {
  const lower = url.toLowerCase();

  // Check domains
  for (const domain of DOMAIN_BLOCKLIST) {
    if (lower.includes(domain)) {
      if (domain.includes('pop') || domain.includes('ads')) return 'ad';
      if (domain.includes('analyt') || domain.includes('track')) return 'tracker';
      if (domain.includes('miner') || domain.includes('coin')) return 'crypto-miner';
      return 'ad';
    }
  }

  // Check patterns
  if (lower.includes('pixel') || lower.includes('beacon')) return 'tracker';
  if (lower.includes('pop')) return 'popup';
  if (lower.includes('miner') || lower.includes('coin')) return 'crypto-miner';
  if (lower.includes('utm_') || lower.includes('fbclid') || lower.includes('gclid')) return 'tracking-param';

  return 'unknown';
}
