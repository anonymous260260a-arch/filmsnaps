import { NextRequest, NextResponse } from 'next/server';

const API_KEY = process.env.TMDB_API_KEY!;
const BASE_URL = 'https://api.themoviedb.org/3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

function corsResponse(data: any, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: { ...init?.headers, ...corsHeaders },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tmdb: string[] }> }
) {
  const { tmdb } = await params;
  const query = req.nextUrl.searchParams.toString();

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
    return corsResponse(
      { error: 'TMDB request failed' },
      { status: res.status }
    );
  }

  const data = await res.json();
  return corsResponse(data);
}
