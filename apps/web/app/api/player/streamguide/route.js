/**
 * StreamGuide Embed Proxy
 *
 * StreamGuide's embed pages set `frame-ancestors 'self'` in their CSP, which
 * blocks embedding in an iframe from a different origin. This route proxies
 * the embed HTML through our own server:
 *
 *   1. Fetches the embed page HTML from streamguide.cfd server-side
 *   2. Injects <base href="https://streamguide.cfd/"> so all relative JS/CSS
 *      URLs resolve correctly (the browser loads them directly)
 *   3. Injects our domains into __EMBED_PARENTS so the embed JS doesn't
 *      refuse to function when the parent origin isn't in the allow-list
 *   4. Returns the HTML with a permissive CSP (no frame-ancestors) so the
 *      browser allows the iframe
 *
 * This effectively converts a frame-ancestors-restricted page into a
 * proxy-served page that can be embedded anywhere.
 *
 * Usage:
 *   /api/player/streamguide?id=1339713
 *   /api/player/streamguide?tvId=95004&season=1&episode=1
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The absolute base URL for streamguide.cfd resources */
const SG_BASE = 'https://streamguide.cfd';

/**
 * Domains we serve on — these get injected into __EMBED_PARENTS so the
 * embed JS allows our parent frame.
 */
const OUR_ORIGINS = [
  'http://localhost:3000',
  'https://filmsnaps.netlify.app',
  'https://filmsnaps.netlify.com',
];

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const movieId = searchParams.get('id');
  const tvId = searchParams.get('tvId');
  const season = searchParams.get('season');
  const episode = searchParams.get('episode');

  // ── Build the streamguide embed URL ──────────────────────────────
  let embedUrl;
  if (tvId && season && episode) {
    embedUrl = `${SG_BASE}/embed/?type=t&id=t-api-${tvId}&ep=t-api-${tvId}-s${season}e${episode}`;
  } else if (movieId) {
    embedUrl = `${SG_BASE}/embed/?type=m&id=m-api-${movieId}&ep=m-api-${movieId}`;
  } else {
    return new Response('Missing id or tvId parameter', { status: 400 });
  }

  try {
    // ── Fetch the real embed page HTML server-side ─────────────────
    const sgResponse = await fetch(embedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!sgResponse.ok) {
      const text = await sgResponse.text().catch(() => '');
      console.error(
        `[StreamGuide Proxy] Upstream ${sgResponse.status}:`,
        text.slice(0, 200),
      );
      return new Response(
        `Upstream server error (${sgResponse.status})`,
        { status: sgResponse.status },
      );
    }

    let html = await sgResponse.text();

    // ── Inject <base> tag so relative URLs (data.js, styles.css, …) ─
    //     resolve against streamguide.cfd instead of our origin.
    html = html.replace(
      '<head>',
      `<head><base href="${SG_BASE}/">`,
    );

    // ── Inject our domains into __EMBED_PARENTS ─────────────────────
    //     The embed JS checks if the parent frame's origin is in this
    //     list. If not, it may block playback.
    //     We wrap the original assignment so ours come first:
    //       __EMBED_PARENTS=OUR_ORIGINS.concat(THEIR_ORIGINS)
    const originsJson = JSON.stringify(OUR_ORIGINS);
    html = html.replace(
      /(window\.__EMBED_PARENTS=)\[([^\]]*)\]/,
      `$1${originsJson}.concat([$2])`,
    );

    // ── Return with permissive headers (no frame-ancestors block) ──
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Allow everything — we're proxying third-party content in an
        // iframe, so the security boundary is the iframe itself.
        'Content-Security-Policy':
          "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;",
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('[StreamGuide Proxy] Fetch error:', error);
    return new Response('Proxy error: ' + error.message, {
      status: 502,
    });
  }
}
