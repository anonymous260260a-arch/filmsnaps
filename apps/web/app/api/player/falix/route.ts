import { NextRequest, NextResponse } from 'next/server';

const FALIX_BASE = 'https://download-falix-falixmovies-backend-hf.hf.space';

/**
 * Server-side proxy for the Falix metadata API.
 * Fetches movie/TV metadata including telegram download links,
 * and returns the JSON to the client.
 *
 * This proxy exists to:
 * 1. Avoid CORS issues from browser to the HF Space
 * 2. Keep the API endpoint internal
 * 3. Allow future response caching
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tmdbId = searchParams.get('id');

  if (!tmdbId) {
    return NextResponse.json(
      { error: 'Missing required query parameter: id' },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(`${FALIX_BASE}/api/id/${tmdbId}`, {
      headers: {
        Accept: 'application/json',
      },
      // 10 second timeout — the HF Space can be slow on cold start
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Falix API returned ${response.status}: ${response.statusText}` },
        { status: response.status },
      );
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        // Allow browser caching for 5 minutes to reduce HF Space load
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    });
  } catch (error: any) {
    console.error('[Falix API] Failed to fetch metadata:', error?.message);

    // Handle timeout specifically
    if (error?.name === 'TimeoutError') {
      return NextResponse.json(
        { error: 'Falix API timed out. The server may be cold-starting.' },
        { status: 504 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch from Falix API' },
      { status: 502 },
    );
  }
}
