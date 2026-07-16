/**
 * Cloudflare challenge detection — checks if a fetched HTML page
 * is a Cloudflare challenge (Turnstile/JS challenge/captcha) rather
 * than the actual provider content.
 *
 * When detected, the player should fall back to a direct iframe load
 * so the user's browser handles the challenge natively.
 */

// ── Challenge page heuristics ────────────────────────────────────────

const CLOUDFLARE_SIGNATURES = [
  'cdn-cgi/challenge-platform',
  'cf-browser-verification',
  'challenge-form',
  'jschl_vc',
  'jschl_answer',
  'data-translate="challenge"',
  'id="challenge-running"',
  'class="cf-error-title"',
  // Common short challenge page patterns
  '>Checking your browser',
  '>Please stand by',
  'Cloudflare is checking',
  'Attention Required!',
  'Enable JavaScript',
  '__cf_chl_tk',
  '__cf_chl_f_tk',
  // Turnstile widget
  'cf-turnstile',
];

/**
 * Check if an HTML response is a Cloudflare challenge page.
 * Looks for signature strings that indicate a challenge rather
 * than actual provider content.
 */
export function isCloudflareChallenge(html: string): boolean {
  // Challenge pages are usually small (under 20KB)
  if (html.length > 50_000) return false;

  const lowerHtml = html.toLowerCase();

  // Must contain at least one Cloudflare-specific signature
  const hasSignature = CLOUDFLARE_SIGNATURES.some((sig) =>
    lowerHtml.includes(sig),
  );
  if (!hasSignature) return false;

  // Check it's not a normal page that happens to reference Cloudflare
  // Challenge pages lack normal content like <video>, <canvas>, player divs
  const hasPlayerContent =
    lowerHtml.includes('<video') ||
    lowerHtml.includes('jwplayer') ||
    lowerHtml.includes('player') ||
    lowerHtml.includes('<iframe') ||
    lowerHtml.includes('data-player');

  // If it has Cloudflare signatures AND lacks player content, likely a challenge
  return !hasPlayerContent;
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
