/**
 * Cloudflare challenge detection — checks if an HTML page or response
 * is behind a Cloudflare JS challenge / Turnstile / Managed Challenge.
 *
 * THREE detection modes:
 *
 * 1. PURE CHALLENGE PAGE: A small HTML page (<50KB) with CF signatures
 *    and NO player content. Classic challenge interstitial.
 *
 * 2. HYBRID CHALLENGE PAGE: A page that contains BOTH real player content
 *    AND Cloudflare challenge script references. Cloudflare's "Managed
 *    Challenge" mode returns the real content alongside a JS challenge
 *    script that must be executed to unlock the actual video sources.
 *    The presence of /cdn-cgi/challenge-platform/ ALONE indicates a
 *    challenge — the content is temporary and requires JS execution.
 *
 * 3. NO CHALLENGE: Clean page with no CF challenge references.
 *
 * When a challenge is detected, the caller should fall back to:
 *   - TLS-fingerprinting fetch (tlsFetch) — bypasses CF at the network layer
 *   - FlareSolverr — solves challenges with headless browser
 *   - Direct iframe — user's browser solves the challenge natively
 */

// ── Cloudflare challenge signatures ─────────────────────────────────

const CLOUDFLARE_SIGNATURES = [
  // Challenge Platform (jsd/main.js, Turnstile)
  'cdn-cgi/challenge-platform',
  // Browser verification
  'cf-browser-verification',
  // Challenge form elements
  'challenge-form',
  'jschl_vc',
  'jschl_answer',
  // Challenge page markers
  'data-translate="challenge"',
  'id="challenge-running"',
  'class="cf-error-title"',
  // Short challenge page text
  '>Checking your browser',
  '>Please stand by',
  'Cloudflare is checking',
  'Attention Required!',
  'Enable JavaScript',
  // Turnstile widget
  'cf-turnstile',
  // Challenge tokens (hybrid pages)
  '__cf_chl_tk',
  '__cf_chl_f_tk',
  // RUM / tracking (NOT a challenge, but included for blocking)
  'cdn-cgi/rum',
];

/**
 * Check if an HTML response is a Cloudflare challenge page.
 *
 * MODE 1 — Pure challenge: small page with CF signatures, no player content.
 * MODE 2 — Hybrid challenge: any page with /cdn-cgi/challenge-platform/ script ref.
 *
 * The hybrid mode is KEY for providers like nxsha: Cloudflare "Managed
 * Challenge" returns the real video page content PLUS a challenge script
 * at /cdn-cgi/challenge-platform/scripts/jsd/main.js. This script must
 * execute in a real browser to complete the challenge. When proxied,
 * the script 404s through the asset proxy, causing the page to reload
 * in an infinite loop.
 *
 * @param html - The HTML content to inspect
 * @param responseHeaders - Optional response headers (check for cf-mitigated)
 */
export function isCloudflareChallenge(
  html: string,
  responseHeaders?: Record<string, string>,
): boolean {
  // ── Header check: Cloudflare often adds cf-mitigated header ──
  if (responseHeaders) {
    const cfMitigated = responseHeaders['cf-mitigated']?.toLowerCase();
    if (cfMitigated === 'challenge' || cfMitigated === 'interactive_challenge') {
      return true;
    }
  }

  const lowerHtml = html.toLowerCase();

  // ── Must contain at least one Cloudflare signature ──
  const hasSignature = CLOUDFLARE_SIGNATURES.some((sig) =>
    lowerHtml.includes(sig),
  );
  if (!hasSignature) return false;

  // ── MODE 1: Pure challenge page (<50KB, no player content) ──
  if (html.length <= 50_000) {
    const hasPlayerContent =
      lowerHtml.includes('<video') ||
      lowerHtml.includes('jwplayer') ||
      lowerHtml.includes('player') ||
      lowerHtml.includes('<iframe') ||
      lowerHtml.includes('data-player');

    if (!hasPlayerContent) {
      return true;
    }
  }

  // ── MODE 2: Hybrid challenge page ──
  // If /cdn-cgi/challenge-platform/ is present, the page requires JS
  // challenge execution. This catches nxsha's case where real video
  // content coexists with the challenge script reference.
  if (
    lowerHtml.includes('cdn-cgi/challenge-platform') ||
    lowerHtml.includes('__cf_chl_tk')
  ) {
    return true;
  }

  return false;
}

/**
 * In-memory cache of providers that triggered Cloudflare challenges.
 * Caches for 5 minutes to avoid re-fetching challenged pages repeatedly.
 */
const challengedProviders = new Map<string, number>();
const CHALLENGE_CACHE_TTL_MS = 5 * 60 * 1000;

export function markProviderChallenged(providerId: string): void {
  challengedProviders.set(providerId, Date.now() + CHALLENGE_CACHE_TTL_MS);
}

export function isProviderChallenged(providerId: string): boolean {
  const ttl = challengedProviders.get(providerId);
  if (!ttl) return false;
  if (Date.now() > ttl) {
    challengedProviders.delete(providerId);
    return false;
  }
  return true;
}

/**
 * Clear challenge cache for a provider (e.g., user explicitly retries).
 */
export function clearProviderChallenge(providerId: string): void {
  challengedProviders.delete(providerId);
}
