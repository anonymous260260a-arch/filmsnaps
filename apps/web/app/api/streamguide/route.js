/**
 * StreamGuide API Proxy Route
 *
 * Proxies requests to streamguide.cfd to avoid CORS issues.
 * The streamguide server doesn't set Access-Control-Allow-Origin headers,
 * so browser-based fetches from a different origin (Netlify, localhost, etc.)
 * are blocked. This route fetches server-side (no CORS) and returns the
 * response with permissive CORS headers.
 *
 * Handles both text (JSON, subtitles, M3U8 playlists) and binary (TS segments)
 * content types correctly via arrayBuffer.
 *
 * Usage examples:
 *   GET /api/streamguide?url=https://streamguide.cfd/Theia/movie/1339713
 *   GET /api/streamguide?url=https://streamguide.cfd/Theia/subtitles/abc123
 *   GET /api/streamguide?url=https://streamguide.cfd/path/to/file.m3u8
 *   GET /api/streamguide?url=https://streamguide.cfd/path/to/segment.ts
 *
 * Security: only requests to streamguide.cfd are allowed.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // never cache between users

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing ?url= parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Security: only allow streamguide.cfd URLs (prevent open proxy abuse)
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!parsed.hostname.endsWith('streamguide.cfd')) {
    return new Response(JSON.stringify({ error: 'Only streamguide.cfd URLs allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        // Respect the original request headers that might affect content negotiation
        'Accept': request.headers.get('Accept') || '*/*',
        'User-Agent': 'FilmSnaps/1.0',
      },
    });

    // Determine content type from the proxied response
    const contentType = response.headers.get('Content-Type') || 'application/octet-stream';

    // Read as ArrayBuffer to preserve binary content (TS segments, etc.)
    // Using .text() would corrupt binary MPEG-TS data
    const body = await response.arrayBuffer();

    // Build CORS-permissive response
    return new Response(body, {
      status: response.status,
      headers: {
        'Content-Type': contentType,
        // Allow any origin (our deployed domains + dev)
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Cache-Control': 'public, max-age=60', // short cache for freshness
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}

// Handle OPTIONS preflight requests
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    },
  });
}
