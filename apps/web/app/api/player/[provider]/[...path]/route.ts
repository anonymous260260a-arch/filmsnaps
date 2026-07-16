/**
 * Generic Player Proxy — fetches provider HTML, injects uBlock-style protection
 * Uses shared config from lib/movieProviders
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

    // Block if matches filter
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

    // Proxy the asset
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
  const targetUrl = `${providerBaseUrl}${embedPath}`;
  console.log(`[Player Proxy:${providerKey}] Fetching:`, targetUrl);

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: providerBaseUrl + '/',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return new NextResponse(`Upstream error: ${response.status}`, {
        status: response.status,
      });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return new NextResponse(response.body, {
        status: response.status,
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    let html = await response.text();

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

    console.log(
      `[Player Proxy:${providerKey}] Rewritten HTML length:`,
      html.length,
    );

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
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
