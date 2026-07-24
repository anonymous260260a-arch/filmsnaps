/**
 * Cloudflare Proxy Route — solves Cloudflare challenges server-side via
 * FlareSolverr, then runs the filter engine on the cleared page.
 *
 * Architecture:
 *   1. Provider request hits this route (e.g., `/api/cf-proxy/nxsha?tvId=...`)
 *   2. Check cookie cache — if valid cf_clearance exists, fetch directly
 *   3. Otherwise, send request to FlareSolverr (headless browser)
 *   4. FlareSolverr navigates to the URL, solves JS challenge, returns HTML
 *   5. We cache the cf_clearance cookie for subsequent requests (~25 min TTL)
 *   6. Apply filter engine: rewrite assets, block ads/trackers, inject protection
 *   7. Apply per-provider CSP (from allowedOrigins)
 *   8. Return filtered HTML
 *
 * Fallback: If FlareSolverr is not configured or fails, redirect directly
 * to the provider (sandbox still protects the direct iframe).
 *
 * Setup: Requires a FlareSolverr container running somewhere.
 *   docker run -p 8191:8191 flaresolverr/flaresolverr
 * Set env var: FLARESOLVERR_URL=http://your-server:8191
 */

import { NextResponse } from 'next/server';
import { getProvider } from '@filmsnaps/shared/providers';
import {
  rewriteAssetUrls,
  injectProtectionIntoHtml,
  generateRuntimeProtectionScript,
  getContentTypeFromUrl,
  getEmptyResponseBody,
} from '@/lib/movieProviders/protection';
import { isFilterEngineLoaded } from '@/lib/movieProviders/filterService';
import { fetchWithFlareSolverr, isFlareSolverrConfigured } from '@/lib/movieProviders/flareSolverr';
import { buildProviderCSP } from '@/lib/movieProviders/cspBuilder';
import { getCorsHeaders } from '@/lib/cors';

/**
 * GET /api/cf-proxy/{provider}?id=...  (movie)
 * GET /api/cf-proxy/{provider}?tvId=...&season=...&episode=...  (tv)
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerKey } = await params;
  const provider = getProvider(providerKey);

  if (!provider) {
    return new NextResponse(`Unknown or disabled provider: ${providerKey}`, { status: 404 });
  }

  // ── Build the provider's embed URL (same pattern as regular proxy) ──
  const { searchParams } = new URL(req.url);
  const movieId = searchParams.get('id');
  const tvId = searchParams.get('tvId');
  const season = searchParams.get('season');
  const episode = searchParams.get('episode');

  if (!movieId && !tvId) {
    return new NextResponse('Missing id or tvId parameter', { status: 400 });
  }

  const embedPath = tvId && season && episode
    ? provider.embed.tv(tvId, Number(season), Number(episode))
    : provider.embed.movie(movieId!);

  const targetUrl = `${provider.baseUrl}${embedPath}`;

  // ── Try FlareSolverr (solves Cloudflare if needed) ──
  if (isFlareSolverrConfigured()) {
    const clearHtml = await fetchWithFlareSolverr(providerKey, targetUrl);
    if (clearHtml) {
      return processHtml(clearHtml, provider, providerKey, targetUrl);
    }
    console.log(`[CF-Proxy:${providerKey}] FlareSolverr failed — falling back to redirect`);
  } else {
    console.log(`[CF-Proxy:${providerKey}] FlareSolverr not configured (set FLARESOLVERR_URL)`);
  }

  // ── Fallback: regular proxy attempt ──
  const html = await tryRegularFetch(providerKey, provider.baseUrl, targetUrl);
  if (html) {
    return processHtml(html, provider, providerKey, targetUrl);
  }

  // ── Last resort: direct redirect (sandbox still applies in iframe) ──
  console.log(`[CF-Proxy:${providerKey}] All proxy attempts failed — redirecting directly`);
  return NextResponse.redirect(targetUrl, 302);
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Try a direct server-side fetch (no CF solving).
 * Returns HTML string if successful, null otherwise.
 */
async function tryRegularFetch(
  providerKey: string,
  baseUrl: string,
  targetUrl: string,
): Promise<string | null> {
  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: baseUrl + '/',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      console.log(`[CF-Proxy:${providerKey}] Regular fetch returned ${response.status}`);
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      console.log(`[CF-Proxy:${providerKey}] Response is not HTML (${contentType})`);
      return null;
    }

    const html = await response.text();

    // Check for Cloudflare challenge
    if (isCloudflareChallenge(html)) {
      console.log(`[CF-Proxy:${providerKey}] Cloudflare challenge detected in regular fetch`);
      return null;
    }

    return html;
  } catch (err) {
    console.error(`[CF-Proxy:${providerKey}] Regular fetch error:`, err);
    return null;
  }
}

/**
 * Process HTML through the filter engine pipeline:
 * rewrite assets, block ads, inject protection scripts, apply CSP.
 */
function processHtml(
  html: string,
  provider: NonNullable<ReturnType<typeof getProvider>>,
  providerKey: string,
  targetUrl: string,
): NextResponse {
  const filterEngine = isFilterEngineLoaded() ? 'cliqz' : 'legacy';
  console.log(`[CF-Proxy:${providerKey}] HTML retrieved — applying filter engine (${filterEngine})`);

  // Step 1: Rewrite asset URLs through proxy + block trackers
  html = rewriteAssetUrls(html, provider.baseUrl, providerKey);

  // Step 2: Inject runtime protection script
  const runtimeScript = generateRuntimeProtectionScript(targetUrl, providerKey, provider);
  if (runtimeScript) {
    if (html.includes('</head>')) {
      html = html.replace('</head>', runtimeScript + '\n</head>');
    } else if (html.includes('<body')) {
      html = html.replace('<body', runtimeScript + '\n<body');
    } else {
      html = runtimeScript + '\n' + html;
    }
  }

  // Step 3: Inject navigation blocker
  html = injectProtectionIntoHtml(html, targetUrl, provider);

  // Step 4: Build per-provider CSP
  const csp = buildProviderCSP(provider);

  console.log(`[CF-Proxy:${providerKey}] Filtered HTML: ${html.length} bytes`);

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...getCorsHeaders(null),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Filter-Source': `cf-proxy-${filterEngine}`,
      'Content-Security-Policy': csp,
    },
  });
}

/**
 * Detect if HTML is a Cloudflare challenge page.
 * (Duplicate of the function in cloudflareDetect.ts — kept standalone
 *  to avoid circular dependencies if imported by both routes.)
 */
function isCloudflareChallenge(html: string): boolean {
  if (html.length > 50_000) return false;
  const lower = html.toLowerCase();
  const signatures = [
    'cdn-cgi/challenge-platform',
    'cf-browser-verification',
    'challenge-form',
    'jschl_vc',
    'jschl_answer',
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
