import { NextRequest, NextResponse } from 'next/server';
import { getCorsHeaders, handleOptions } from '@/lib/cors';

const BASE_URL = 'https://api.themoviedb.org/3';

const cacheHeaders = {
  'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
};

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

function corsResponse(data: unknown, requestOrigin: string | null, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: { ...cacheHeaders, ...init?.headers, ...getCorsHeaders(requestOrigin) },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tmdb: string[] }> }
) {
  const { tmdb } = await params;
  const query = req.nextUrl.searchParams.toString();
  const origin = req.headers.get('origin');

  const API_KEY = process.env.TMDB_API_KEY;
  if (!API_KEY) {
    return corsResponse(
      { error: 'TMDB_API_KEY not configured on this server' },
      origin,
      { status: 500 }
    );
  }

  const endpoint = `/${tmdb.join('/')}${query ? '?' + query : ''}`;

  const res = await fetch(
    `${BASE_URL}${endpoint}${query ? '&' : '?'}api_key=${API_KEY}`,
    {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return corsResponse(
      { error: `TMDB request failed (${res.status}): ${body.slice(0, 200)}` },
      origin,
      { status: res.status }
    );
  }

  const data = await res.json();
  return corsResponse(data, origin);
}
