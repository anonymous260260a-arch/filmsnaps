/**
 * MovieBox Experiment — API route handler
 *
 * Catch-all route that maps URL paths to MovieBox API functions.
 * All routes are server-side proxies to hide the upstream API
 * and handle authentication (bearer token auto-acquisition).
 *
 * Routes:
 *   /api/exp/moviebox/home                     → Home page sections
 *   /api/exp/moviebox/search?q=...             → Full search
 *   /api/exp/moviebox/suggest?q=...            → Search suggestions
 *   /api/exp/moviebox/detail/{slug}            → Subject detail
 *   /api/exp/moviebox/stream/{subjectId}       → Stream sources
 *   /api/exp/moviebox/captions/{subjectId}     → Subtitles/captions
 *   /api/exp/moviebox/catalog/{type}?page=1    → Catalog (movies/tv/animation)
 *   /api/exp/moviebox                          → API info / redirect to dashboard
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getHome,
  getCatalog,
  searchSuggest,
  search,
  getDetail,
  getStream,
  getCaptions,
} from '@/lib/moviebox';

const TAB_IDS: Record<string, number> = {
  movies: 2,
  tv: 5,
  animation: 8,
  'tv-series': 5,
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const searchParams = request.nextUrl.searchParams;

  try {
    // /api/exp/moviebox — info
    if (!path || path.length === 0) {
      return NextResponse.json({
        name: 'MovieBox Experiment',
        version: '2.1.5',
        endpoints: {
          home: '/api/exp/moviebox/home',
          search: '/api/exp/moviebox/search?q=<query>',
          suggest: '/api/exp/moviebox/suggest?q=<query>',
          detail: '/api/exp/moviebox/detail/<slug>',
          stream: '/api/exp/moviebox/stream/<subjectId>?detail_path=<slug>&se=1&ep=1',
          captions: '/api/exp/moviebox/captions/<subjectId>?detail_path=<slug>',
          catalog: '/api/exp/moviebox/catalog/<movies|tv|animation>?page=1',
        },
      });
    }

    const [resource, ...rest] = path;
    const secondArg = rest.join('/');

    switch (resource) {
      // /api/exp/moviebox/home
      case 'home': {
        const data = await getHome();
        return NextResponse.json(data);
      }

      // /api/exp/moviebox/search?q=...
      case 'search': {
        const q = searchParams.get('q');
        if (!q) {
          return NextResponse.json({ error: 'Missing query param: q' }, { status: 400 });
        }
        const page = parseInt(searchParams.get('page') || '1', 10);
        const data = await search(q, page);
        return NextResponse.json(data);
      }

      // /api/exp/moviebox/suggest?q=...
      case 'suggest': {
        const q = searchParams.get('q');
        if (!q) {
          return NextResponse.json({ error: 'Missing query param: q' }, { status: 400 });
        }
        const data = await searchSuggest(q);
        return NextResponse.json(data);
      }

      // /api/exp/moviebox/detail/{slug}
      case 'detail': {
        if (!secondArg) {
          return NextResponse.json({ error: 'Missing slug' }, { status: 400 });
        }
        const data = await getDetail(secondArg);
        return NextResponse.json(data);
      }

      // /api/exp/moviebox/stream/{subjectId}?detail_path=...&se=1&ep=1
      case 'stream': {
        if (!secondArg) {
          return NextResponse.json({ error: 'Missing subjectId' }, { status: 400 });
        }
        const detailPath = searchParams.get('detail_path') || searchParams.get('detailPath') || '';
        if (!detailPath) {
          return NextResponse.json({ error: 'Missing query param: detail_path' }, { status: 400 });
        }
        const se = parseInt(searchParams.get('se') || '1', 10);
        const ep = parseInt(searchParams.get('ep') || '1', 10);
        const data = await getStream(secondArg, detailPath, se, ep);
        return NextResponse.json(data);
      }

      // /api/exp/moviebox/captions/{subjectId}?detail_path=...&se=1&ep=1
      case 'captions': {
        if (!secondArg) {
          return NextResponse.json({ error: 'Missing subjectId' }, { status: 400 });
        }
        const detailPath = searchParams.get('detail_path') || searchParams.get('detailPath') || '';
        if (!detailPath) {
          return NextResponse.json({ error: 'Missing query param: detail_path' }, { status: 400 });
        }
        const se = parseInt(searchParams.get('se') || '1', 10);
        const ep = parseInt(searchParams.get('ep') || '1', 10);
        const data = await getCaptions(secondArg, detailPath, se, ep);
        return NextResponse.json(data);
      }

      // /api/exp/moviebox/catalog/{type}?page=1
      case 'catalog': {
        const catalogType = secondArg || 'movies';
        const tabId = TAB_IDS[catalogType];
        if (!tabId) {
          return NextResponse.json(
            { error: `Unknown catalog type: ${catalogType}. Use: movies, tv/tv-series, animation` },
            { status: 400 },
          );
        }
        const page = parseInt(searchParams.get('page') || '1', 10);
        const data = await getCatalog(tabId, page);
        return NextResponse.json(data);
      }

      default:
        return NextResponse.json({ error: `Unknown resource: ${resource}` }, { status: 404 });
    }
  } catch (error: any) {
    console.error('[MovieBox] API error:', error?.message);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 502 },
    );
  }
}
