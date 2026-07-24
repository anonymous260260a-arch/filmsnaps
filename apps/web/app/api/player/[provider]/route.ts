/**
 * Player Proxy — fetches provider's embed page through the server,
 * applies the filter engine (ad/tracker blocking), rewrites asset URLs,
 * and injects runtime protection.
 *
 * Previously this route did a 302 redirect directly to the provider.
 * Now it proxies the page so the @cliqz/adblocker engine processes
 * every resource request from the provider's HTML.
 *
 * CLOUDFLARE FALLBACK: If the provider returns a Cloudflare challenge
 * page (Turnstile/JS challenge/captcha) instead of real content, we
 * fall back to a 302 redirect so the user's browser handles the
 * challenge natively. The filter engine still protects assets via
 * the asset proxy route, and the sandbox attribute on the iframe
 * provides browser-level popup/navigation blocking.
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
import { buildProviderCSP } from '@/lib/movieProviders/cspBuilder';
import {
  isCloudflareChallenge,
  isProviderChallenged,
  markProviderChallenged,
  clearProviderChallenge,
} from '@/lib/movieProviders/cloudflareDetect';
import { getCorsHeaders } from '@/lib/cors';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerKey } = await params;
  const provider = getProvider(providerKey);

  if (!provider) {
    return new NextResponse(`Unknown or disabled provider: ${providerKey}`, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const movieId = searchParams.get('id');
  const tvId = searchParams.get('tvId');
  const season = searchParams.get('season');
  const episode = searchParams.get('episode');

  if (!movieId && !tvId) {
    return new NextResponse('Missing id or tvId parameter', { status: 400 });
  }

  // Get the provider's full embed URL
  const embedPath = tvId && season && episode
    ? provider.embed.tv(tvId, Number(season), Number(episode))
    : provider.embed.movie(movieId!);

  const targetUrl = `${provider.baseUrl}${embedPath}`;

  // ── Check challenge cache — if recently challenged, redirect directly ──
  if (isProviderChallenged(providerKey)) {
    console.log(`[Player Proxy:${providerKey}] Cached challenge — redirecting directly`);
    return NextResponse.redirect(targetUrl, 302);
  }

  console.log(`[Player Proxy:${providerKey}] Fetching:`, targetUrl);

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: provider.baseUrl + '/',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      console.log(`[Player Proxy:${providerKey}] Upstream ${response.status} — redirecting directly`);
      // Fall back to direct iframe for error responses (likely Cloudflare 403)
      markProviderChallenged(providerKey);
      return NextResponse.redirect(targetUrl, 302);
    }

    const contentType = response.headers.get('content-type') || '';

    // ── Non-HTML response (JSON, binary, etc.) ──
    if (!contentType.includes('text/html')) {
      return new NextResponse(response.body, {
        status: response.status,
        headers: {
          'Content-Type': contentType,
          ...getCorsHeaders(req.headers.get('origin')),
        },
      });
    }

    // ── HTML — check for Cloudflare challenge ──
    let html = await response.text();

    if (isCloudflareChallenge(html)) {
      console.log(`[Player Proxy:${providerKey}] DETECTED Cloudflare challenge — redirecting directly`);
      markProviderChallenged(providerKey);
      return NextResponse.redirect(targetUrl, 302);
    }

    // Clear any previous challenge flag (successful proxy)
    clearProviderChallenge(providerKey);

    // ── Apply filter engine + rewrite ──
    const filterEngine = isFilterEngineLoaded() ? 'cliqz' : 'legacy';
    console.log(`[Player Proxy:${providerKey}] Filter engine ACTIVE (${filterEngine}) — processing HTML`);

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

    console.log(
      `[Player Proxy:${providerKey}] Rewritten HTML length: ${html.length} (filter: ${filterEngine})`,
    );

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        ...getCorsHeaders(req.headers.get('origin')),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Filter-Source': filterEngine,
        'Content-Security-Policy': buildProviderCSP(provider),
      },
    });
  } catch (error) {
    console.error(`[Player Proxy:${providerKey}] Error:`, error);
    // Network error — fall back to direct iframe
    markProviderChallenged(providerKey);
    return NextResponse.redirect(targetUrl, 302);
  }
}
