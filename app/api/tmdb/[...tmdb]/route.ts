import { NextRequest, NextResponse } from 'next/server';

const API_KEY = process.env.TMDB_API_KEY!;
const BASE_URL = 'https://api.themoviedb.org/3';

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
    return NextResponse.json(
      { error: 'TMDB request failed' },
      { status: res.status }
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
