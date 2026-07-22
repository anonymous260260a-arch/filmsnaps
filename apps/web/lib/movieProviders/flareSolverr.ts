/**
 * FlareSolverr Client — solves Cloudflare challenges using a headless
 * browser (Puppeteer/Playwright) managed by flaresolverr.
 *
 * Architecture:
 *   ┌──────────────┐   POST /v1    ┌───────────────┐   browser    ┌──────────────┐
 *   │  Our Proxy   │ ────────────► │  FlareSolverr │ ────────────► │  Provider    │
 *   │  (route.ts)  │ ◄──────────── │  (container)  │ ◄──────────── │  (Cloudflare)│
 *   └──────────────┘   HTML+       └───────────────┘   cleared     └──────────────┘
 *                      cookies
 *
 * Setup: Run `docker run -p 8191:8191 flaresolverr/flaresolverr` on
 * your server. Point the env var FLARESOLVERR_URL to it.
 *
 * Cookie caching: FlareSolverr sessions expire after ~30 min.
 * We cache cf_clearance cookies to disk so subsequent requests within
 * that window skip the headless browser entirely (faster, ~20ms vs ~5s).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isFilterEngineLoaded } from './filterService';

// ── Configuration ───────────────────────────────────────────────────


const FLARESOLVERR_URL =
  process.env.FLARESOLVERR_URL || 'http://localhost:8191';
const CACHE_DIR = join(process.cwd(), '.cf-cache');
const CACHE_TTL_MS = 25 * 60 * 1000; // 25 min (FlareSolverr session ~30 min)

interface CachedCookie {
  /** Provider id, e.g. 'nxsha' */
  provider: string;
  /** The cf_clearance cookie value */
  cookie: string;
  /** Absolute URL this clearance was obtained for */
  url: string;
  /** Expiry timestamp */
  expiresAt: number;
}

// ── Public API ──────────────────────────────────────────────────────

export function isFlareSolverrConfigured(): boolean {
  return !!process.env.FLARESOLVERR_URL;
}

/**
 * Fetch a Cloudflare-protected page via FlareSolverr.
 *
 * 1. Check cookie cache — if a valid cf_clearance exists, fetch directly
 *    with the cached cookie (no headless browser needed).
 * 2. Otherwise, tell FlareSolverr to solve the challenge.
 * 3. Cache the returned cf_clearance cookie for next time.
 * 4. Return the HTML.
 *
 * Returns null if:
 *   - FlareSolverr is not configured / unreachable
 *   - Challenge solving fails
 *   - Response is not valid HTML
 */
export async function fetchWithFlareSolverr(
  providerId: string,
  targetUrl: string,
  maxTimeoutMs = 30000,
): Promise<string | null> {
  // 1. Try cookie cache first
  const cached = getCachedCookie(providerId);
  if (cached) {
    console.log(`[FlareSolverr:${providerId}] Using cached cf_clearance (expires ${new Date(cached.expiresAt).toISOString()})`);
    // Fetch directly with the cached cookie
    const result = await fetch(targetUrl, {
      headers: {
        Cookie: cached.cookie,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: new URL(targetUrl).origin + '/',
      },
      redirect: 'follow',
    });

    if (responseIsValidHtml(result)) {
      const html = await result.text();
      if (!isCloudflareChallengePage(html)) {
        return html;
      }
      // Cookie expired, clear it and fall through to FlareSolverr
      console.log(`[FlareSolverr:${providerId}] Cached cookie invalid — re-solving`);
      clearCachedCookie(providerId);
    }
  }

  // 2. No cache or cache expired — use FlareSolverr
  if (!isFlareSolverrConfigured()) {
    console.log(`[FlareSolverr:${providerId}] Not configured (set FLARESOLVERR_URL)`);
    return null;
  }

  console.log(`[FlareSolverr:${providerId}] Solving Cloudflare challenge...`);
  const html = await solveChallenge(providerId, targetUrl, maxTimeoutMs);
  return html;
}

// ── Internal ────────────────────────────────────────────────────────

/**
 * Send the request to FlareSolverr and return the rendered HTML.
 * The headless browser navigates to the URL, solves any JS challenge,
 * and returns the fully rendered page.
 */
async function solveChallenge(
  providerId: string,
  targetUrl: string,
  maxTimeoutMs: number,
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), maxTimeoutMs + 5000);

    const response = await fetch(`${FLARESOLVERR_URL}/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cmd: 'request.get',
        url: targetUrl,
        maxTimeout: maxTimeoutMs,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[FlareSolverr:${providerId}] HTTP ${response.status}: ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    if (data.status === 'error' || data.status === 'timeout') {
      console.error(`[FlareSolverr:${providerId}] Error: ${data.message || data.status}`);
      return null;
    }

    if (!data.solution?.response) {
      console.error(`[FlareSolverr:${providerId}] No solution response`, JSON.stringify(data).slice(0, 200));
      return null;
    }

    // Extract cf_clearance cookie and cache it
    const cookies = data.solution.cookies || [];
    const cfCookie = cookies.find(
      (c: any) => c.name === 'cf_clearance' || c.name === 'cf_clearance',
    );
    if (cfCookie) {
      cacheCookie(providerId, targetUrl, cfCookie);
    }

    console.log(`[FlareSolverr:${providerId}] Challenge solved ✓ (${data.solution.response.length} bytes)`);
    return data.solution.response;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.error(`[FlareSolverr:${providerId}] Request timed out after ${maxTimeoutMs}ms`);
    } else if (err.code === 'ECONNREFUSED') {
      console.error(`[FlareSolverr:${providerId}] Connection refused — is flaresolverr running?`);
    } else {
      console.error(`[FlareSolverr:${providerId}] Fetch error:`, err.message);
    }
    return null;
  }
}

// ── Cookie Cache ────────────────────────────────────────────────────

function cacheDir(): string {
  if (!existsSync(CACHE_DIR)) {
    try {
      mkdirSync(CACHE_DIR, { recursive: true });
    } catch {
      // Fallback to temp dir
      return join(process.cwd(), 'tmp', '.cf-cache');
    }
  }
  return CACHE_DIR;
}

function cachePath(providerId: string): string {
  return join(cacheDir(), `cf-${providerId}.json`);
}

function cacheCookie(providerId: string, url: string, cfCookie: any): void {
  const entry: CachedCookie = {
    provider: providerId,
    cookie: `${cfCookie.name}=${cfCookie.value}`,
    url,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  try {
    writeFileSync(cachePath(providerId), JSON.stringify(entry, null, 2), 'utf-8');
    console.log(`[FlareSolverr:${providerId}] Cached cf_clearance (TTL ${Math.round(CACHE_TTL_MS / 60000)} min)`);
  } catch (err) {
    console.warn(`[FlareSolverr:${providerId}] Failed to cache cookie:`, err);
  }
}

export function getCachedCookie(providerId: string): CachedCookie | null {
  const path = cachePath(providerId);
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, 'utf-8');
    const entry: CachedCookie = JSON.parse(raw);

    if (Date.now() > entry.expiresAt) {
      // Expired — remove and return null
      try { writeFileSync(path, ''); } catch {}
      return null;
    }

    return entry;
  } catch {
    return null;
  }
}

function clearCachedCookie(providerId: string): void {
  const path = cachePath(providerId);
  try {
    writeFileSync(path, '');
  } catch {}
}

// ── Helpers ─────────────────────────────────────────────────────────

function responseIsValidHtml(response: Response): boolean {
  const ct = response.headers.get('content-type') || '';
  return response.ok && ct.includes('text/html');
}

function isCloudflareChallengePage(html: string): boolean {
  if (html.length > 50_000) return false;
  const lower = html.toLowerCase();
  const signatures = [
    'cdn-cgi/challenge-platform',
    'cf-browser-verification',
    'challenge-form',
    'jschl_vc',
    'jschl_answer',
    'data-translate="challenge"',
    '>Checking your browser',
    '>Please stand by',
    '__cf_chl_tk',
    'cf-turnstile',
  ];
  const hasSig = signatures.some((s) => lower.includes(s));
  if (!hasSig) return false;
  const hasContent =
    lower.includes('<video') ||
    lower.includes('jwplayer') ||
    lower.includes('<iframe') ||
    lower.includes('data-player');
  return !hasContent;
}
