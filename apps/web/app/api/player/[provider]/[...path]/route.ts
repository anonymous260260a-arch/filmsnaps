/**
 * Generic Player Proxy — fetches provider HTML, injects uBlock-style protection
 * Uses shared config from lib/movieProviders.
 *
 * TLS fingerprinting: Uses curl-impersonate / Chrome-like TLS to bypass
 * Cloudflare JS challenges at the network layer (avoids hybrid challenge pages).
 */

import { NextResponse } from 'next/server';
import { getProvider } from '@filmsnaps/shared/providers';
import {
  shouldBlockUrl,
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
  markProviderChallenged,
} from '@/lib/movieProviders/cloudflareDetect';
import {
  fetchWithFlareSolverr,
  isFlareSolverrConfigured,
} from '@/lib/movieProviders/flareSolverr';
import { tlsFetch, getTlsFetchMode } from '@/lib/movieProviders/tlsFetch';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string; path: string[] }> },
) {
  const { provider: providerKey, path } = await params;
  const provider = getProvider(providerKey);

  if (!provider) {
    return new NextResponse(`Unknown or disabled provider: ${providerKey}`, {
      status: 404,
    });
  }

  const embedPath = '/' + path.join('/');
  const providerBaseUrl = provider.baseUrl;

  // ── Asset requests (js, css, img, video, etc.) — proxy individually ──
  const isAsset = embedPath.match(
    /\.(js|css|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|m3u8|mpd|mp4|webm|json|wasm)$/i,
  );

  if (isAsset) {
    const fullUrl = `${providerBaseUrl}${embedPath}`;

    if (shouldBlockUrl(fullUrl, { provider })) {
      const ct = getContentTypeFromUrl(fullUrl);
      const filterEngine = isFilterEngineLoaded() ? 'cliqz' : 'legacy';
      console.log(`[Player Proxy:${providerKey}] BLOCKED (${filterEngine})  ${fullUrl}`);
      return new NextResponse(getEmptyResponseBody(ct), {
        status: 204,
        headers: {
          'Content-Type': ct,
          'X-Blocked-By': 'Filmsnaps-Filter',
          'X-Filter-Source': filterEngine,
        },
      });
    }

    try {
      const response = await fetch(fullUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
          Accept: '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      const contentType =
        response.headers.get('content-type') || getContentTypeFromUrl(fullUrl);
      return new NextResponse(response.body, {
        status: response.status,
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    } catch {
      return new NextResponse(null, { status: 502 });
    }
  }

  // ── HTML page request — fetch, rewrite, inject protection ──
  const queryString = new URL(req.url).searchParams.toString();
  const targetUrl = queryString
    ? `${providerBaseUrl}${embedPath}?${queryString}`
    : `${providerBaseUrl}${embedPath}`;
  console.log(`[Player Proxy:${providerKey}] Fetching:`, targetUrl);

  try {
    // ── Log which TLS mode we're using ──
    const tlsMode = await getTlsFetchMode();
    console.log(`[Player Proxy:${providerKey}] TLS mode: ${tlsMode}`);

    // ── PHASE 1: Try TLS-fingerprinting fetch ──
    // Uses curl-impersonate or Chrome-like TLS to bypass Cloudflare
    // at the network layer. If Cloudflare doesn't detect us as a bot,
    // we get clean HTML with no challenge script.
    // Note: We use desktop Chrome UA for primary request (best chance of
    // bypassing CF). If Cloudflare still returns a challenge, Phase 2
    // will retry with an iPad UA (often bypasses both CF and mobile ads).
    let result = await tlsFetch(targetUrl, {
      mobileUA: false,
      timeout: 30000,
      followRedirects: true,
      headers: {
        Referer: providerBaseUrl + '/',
      },
    });

    console.log(`[Player Proxy:${providerKey}] tlsFetch: status=${result.statusCode}, body=${result.body?.length} bytes, method=${result.method}`);

    let responseHeadersForDetect: Record<string, string> | undefined;
    if (result.headers && Object.keys(result.headers).length > 0) {
      responseHeadersForDetect = result.headers;
    }

    // ── PHASE 2: Cloudflare challenge detection ──
    if (isCloudflareChallenge(result.body, responseHeadersForDetect)) {
      console.log(`[Player Proxy:${providerKey}] Cloudflare challenge detected (hybrid/pure) — attempting solve`);

      markProviderChallenged(providerKey);

      if (isFlareSolverrConfigured()) {
        console.log(`[Player Proxy:${providerKey}] Trying FlareSolverr...`);
        const solved = await fetchWithFlareSolverr(providerKey, targetUrl, 60000);
        if (solved) {
          result = {
            body: solved,
            statusCode: 200,
            headers: {},
            method: 'native-fetch',
          };
          console.log(`[Player Proxy:${providerKey}] FlareSolverr solved challenge (${solved.length} bytes)`);
        } else {
          console.warn(`[Player Proxy:${providerKey}] FlareSolverr failed — showing fallback`);
          return cloudflareFallback();
        }
      } else {
        // No FlareSolverr — try iPad UA as fallback (expert analysis: often works)
        console.log(`[Player Proxy:${providerKey}] No FlareSolverr — trying iPad UA fallback`);
        const ipadResult = await tlsFetch(targetUrl, {
          mobileUA: true,
          timeout: 30000,
          followRedirects: true,
          headers: {
            Referer: providerBaseUrl + '/',
          },
        });

        if (
          ipadResult.body &&
          ipadResult.statusCode < 400 &&
          !isCloudflareChallenge(ipadResult.body)
        ) {
          result = ipadResult;
          console.log(`[Player Proxy:${providerKey}] iPad UA bypassed Cloudflare (${ipadResult.body.length} bytes)`);
        } else {
          console.warn(`[Player Proxy:${providerKey}] iPad UA also blocked — showing fallback`);
          return cloudflareFallback();
        }
      }
    }

    // ── PHASE 3: Rewrite & inject protection ──
    let html = result.body;

    // Step 1: Rewrite asset URLs through proxy + block trackers
    html = rewriteAssetUrls(html, providerBaseUrl, providerKey);

    // Step 2: Inject runtime protection script (nav blocking + network interceptor)
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

    // Step 3: Inject navigation blocker (redundant extra layer)
    html = injectProtectionIntoHtml(html, targetUrl, provider);

    console.log(`[Player Proxy:${providerKey}] Rewritten HTML length:`, html.length);

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Tls-Method': result.method,
        'Content-Security-Policy': buildProviderCSP(provider),
      },
    });
  } catch (error) {
    console.error(`[Player Proxy:${providerKey}] Error:`, error);
    return new NextResponse(
      `Proxy error: ${error instanceof Error ? error.message : 'Unknown'}`,
      { status: 502 },
    );
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function cloudflareFallback() {
  return new NextResponse(
    '<!DOCTYPE html>' +
    '<html lang="en">' +
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Server Behind Cloudflare</title>' +
    '<style>' +
    'body{margin:0;background:#070708;color:#A1A1AA;display:flex;align-items:center;justify-content:center;' +
    'height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center;padding:2rem}' +
    '.wrap{max-width:400px}' +
    'h1{color:#D4A237;font-size:1.25rem;margin:0 0 0.5rem;font-weight:700}' +
    'p{font-size:0.875rem;line-height:1.6;margin:0 0 1.5rem;color:#71717A}' +
    '.badge{display:inline-block;padding:0.25rem 0.75rem;border-radius:999px;' +
    'background:rgba(212,162,55,0.1);border:1px solid rgba(212,162,55,0.2);' +
    'color:#D4A237;font-size:0.75rem;font-weight:600}' +
    '</style>' +
    '</head>' +
    '<body>' +
    '<div class="wrap">' +
    '<div class="badge">Cloudflare Protected</div>' +
    '<h1>Server Behind Cloudflare</h1>' +
    '<p>This server is protected by Cloudflare and cannot be proxied.<br>' +
    'Switch to another server above to continue watching.</p>' +
    '</div>' +
    '</body>' +
    '</html>',
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}
