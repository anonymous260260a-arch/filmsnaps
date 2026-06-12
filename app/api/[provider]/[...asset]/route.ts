/**
 * Asset Proxy — network-level request filtering (uBlock Origin style)
 * Proxies provider assets with centralized tracking blocking.
 *
 * Uses shared protection engine from lib/movieProviders/protection
 * so patterns are maintained in ONE place.
 */

import { NextResponse } from 'next/server';
import { getProvider } from '@/lib/movieProviders/providers';
import {
  shouldBlockUrl,
  getContentTypeFromUrl,
} from '@/lib/movieProviders/protection';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ provider: string; asset: string[] }> },
) {
  const { provider: providerKey, asset } = await ctx.params;
  const provider = getProvider(providerKey);

  if (!provider) {
    return new NextResponse(`Unknown or disabled provider: ${providerKey}`, {
      status: 403,
    });
  }

  const origin = provider.baseUrl;
  const assetPath = asset.join('/');
  const lowerPath = assetPath.toLowerCase();

  // ── Service Worker — return empty stub ──
  if (
    lowerPath.endsWith('sw.js') ||
    lowerPath.endsWith('service-worker.js') ||
    lowerPath.endsWith('worker.js')
  ) {
    return new NextResponse(
      `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', () => {});`,
      {
        headers: {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  // ── Manifest — return empty ──
  if (lowerPath.endsWith('manifest.json')) {
    return new NextResponse('{}', {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  // Construct target URL
  const targetUrl = new URL(assetPath, origin).toString();

  // Forward search params
  const { searchParams } = new URL(req.url);
  const finalUrl = new URL(targetUrl);
  searchParams.forEach((value, key) => {
    finalUrl.searchParams.append(key, value);
  });

  const resolvedUrl = finalUrl.toString();

  // ── Block if matches filter patterns ──
  if (shouldBlockUrl(resolvedUrl, { provider })) {
    console.log(`[Asset Proxy] Blocked: ${resolvedUrl}`);
    return new NextResponse('', {
      status: 204,
      headers: {
        'X-Blocked-By': 'Filmsnaps-Filter',
        'Cache-Control': 'no-store',
      },
    });
  }

  console.log(`[Asset Proxy] Fetching: ${resolvedUrl}`);

  try {
    const response = await fetch(resolvedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        Accept: req.headers.get('accept') || '*/*',
        'Accept-Language': 'en-US,en;q=0.5',
        Referer: origin + '/',
        Origin: origin,
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      console.error(`[Asset Proxy] Failed: ${response.status} at ${resolvedUrl}`);
      return new NextResponse(`Asset Error: ${response.status}`, {
        status: response.status,
      });
    }

    const contentType =
      response.headers.get('content-type') ||
      getContentTypeFromUrl(resolvedUrl);
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control':
        response.headers.get('cache-control') || 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    };

    const contentLength = response.headers.get('content-length');
    if (contentLength) headers['Content-Length'] = contentLength;

    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      headers['Content-Range'] = contentRange;
      headers['Accept-Ranges'] = 'bytes';
    }

    return new NextResponse(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    console.error('[Asset Proxy] Error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range, Accept',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length',
    },
  });
}
