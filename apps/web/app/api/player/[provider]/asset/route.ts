/**
 * Generic Asset Proxy — proxies provider assets with network-level tracking blocking
 * Uses shared security engine from lib/movieProviders/protection
 */

import { NextResponse } from 'next/server';
import { getProvider } from '@filmsnaps/shared/providers';
import {
  shouldBlockUrl,
  getContentTypeFromUrl,
  getEmptyResponseBody,
} from '@/lib/movieProviders/protection';
import { isFilterEngineLoaded } from '@/lib/movieProviders/filterService';
import { getCorsHeaders, handleOptions } from '@/lib/cors';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerKey } = await params;
  const provider = getProvider(providerKey);

  if (!provider) {
    return new NextResponse(`Unknown or disabled provider: ${providerKey}`, {
      status: 404,
    });
  }

  const url = new URL(req.url);
  const urlParam = url.searchParams.get('url');

  if (!urlParam) {
    return new NextResponse('Missing url parameter', { status: 400 });
  }

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(urlParam);
    new URL(targetUrl);
  } catch {
    return new NextResponse('Invalid URL', { status: 400 });
  }

  // ── Block if matches filter patterns ──
  if (shouldBlockUrl(targetUrl, { provider })) {
    const filterEngine = isFilterEngineLoaded() ? 'cliqz' : 'legacy';
    console.log(`[Asset Proxy:${providerKey}] BLOCKED (${filterEngine})  ${targetUrl}`);
    const ct = getContentTypeFromUrl(targetUrl);
    return new NextResponse(getEmptyResponseBody(ct), {
      status: 200,
      headers: {
        'Content-Type': ct,
        'Cache-Control': 'public, max-age=3600',
        'X-Blocked-By': 'Filmsnaps-Filter',
        'X-Filter-Source': filterEngine,
      },
    });
  }

  console.log(`[Asset Proxy:${providerKey}] Fetching:`, targetUrl);

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: provider.baseUrl + '/',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      if (response.status === 404) {
        const ct = getContentTypeFromUrl(targetUrl);
        return new NextResponse(getEmptyResponseBody(ct), {
          status: 200,
          headers: {
            'Content-Type': ct,
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }
      return new NextResponse(`Asset error: ${response.status}`, {
        status: response.status,
      });
    }

    const contentType =
      response.headers.get('content-type') || getContentTypeFromUrl(targetUrl);

    // If we got HTML instead of expected asset, return empty
    if (contentType.includes('text/html')) {
      const ct = getContentTypeFromUrl(targetUrl);
      return new NextResponse(getEmptyResponseBody(ct), {
        status: 200,
        headers: {
          'Content-Type': ct,
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    return new NextResponse(response.body, {
      headers: {
        'Content-Type': contentType,
        ...getCorsHeaders(req.headers.get('origin')),
        'Cache-Control': 'public, max-age=3600',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    console.error(`[Asset Proxy:${providerKey}] Error:`, error);
    const ct = getContentTypeFromUrl(targetUrl);
    return new NextResponse(getEmptyResponseBody(ct), {
      status: 200,
      headers: { 'Content-Type': ct },
    });
  }
}

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

// Reuse the same filtering for POST requests
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerKey } = await params;
  const provider = getProvider(providerKey);

  const { searchParams } = new URL(req.url);
  const urlParam = searchParams.get('url');
  if (urlParam && provider) {
    const targetUrl = decodeURIComponent(urlParam);
    if (shouldBlockUrl(targetUrl, { provider })) {
      console.log(`[Asset Proxy:${providerKey}] Blocked POST:`, targetUrl);
    }
  }

  return new NextResponse(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
  });
}
