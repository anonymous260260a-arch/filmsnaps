/**
 * ShowBox Experiment — API route handler
 *
 * Catch-all route that maps URL paths to ShowBox API functions.
 * All routes are server-side proxies to hide the upstream API.
 *
 * Routes:
 *   /api/exp/showbox                                 → API info
 *   /api/exp/showbox/home                            → Browse movies & TV (paginated)
 *   /api/exp/showbox/movies?page=1&cat=xxx           → Movies list
 *   /api/exp/showbox/tv?page=1&cat=xxx               → TV shows list
 *   /api/exp/showbox/categories                      → Category names
 *   /api/exp/showbox/detail/movie/{id}               → Movie detail
 *   /api/exp/showbox/detail/tv/{id}?season={n}       → TV season detail
 *   /api/exp/showbox/trailers                        → Trailers list
 *   /api/exp/showbox/trailer/{id}                    → Trailer detail
 *   /api/exp/showbox/search?q=xxx                    → Search movies & TV
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getMovies,
  getTVShows,
  getCategories,
  getMovieDetail,
  getTVSeason,
  getTrailers,
  getTrailerDetail,
} from '@/lib/showbox';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const searchParams = request.nextUrl.searchParams;

  try {
    // /api/exp/showbox — info
    if (!path || path.length === 0) {
      return NextResponse.json({
        name: 'ShowBox Experiment',
        version: '1.0.0',
        description: 'Original MovieBox backend (sbfunapi.cc)',
        endpoints: {
          home: '/api/exp/showbox/home',
          movies: '/api/exp/showbox/movies?page=1&cat=all',
          tv: '/api/exp/showbox/tv?page=1&cat=all',
          categories: '/api/exp/showbox/categories',
          detail: '/api/exp/showbox/detail/movie/<id>',
          tvDetail: '/api/exp/showbox/detail/tv/<id>?season=1',
          trailers: '/api/exp/showbox/trailers',
          search: '/api/exp/showbox/search?q=<query>',
        },
      });
    }

    const [resource, ...rest] = path;
    const secondArg = rest.join('/');

    switch (resource) {
      // /api/exp/showbox/home — browse all movies & TV (paginated, combined)
      case 'home': {
        const page = parseInt(searchParams.get('page') || '1', 10);
        const cat = searchParams.get('cat') || 'all';
        const perPage = 24;

        const [allMovies, allTv, cats] = await Promise.all([
          getMovies(),
          getTVShows(),
          getCategories(),
        ]);

        // Filter by category if specified
        let filteredMovies = allMovies.filter((m) => m.active === '1');
        let filteredTv = allTv.filter((t) => t.active === '1');

        if (cat !== 'all') {
          filteredMovies = filteredMovies.filter(
            (m) => m.cats && m.cats.split(',').includes(cat),
          );
          filteredTv = filteredTv.filter(
            (t) => t.cats && t.cats.split(',').includes(cat),
          );
        }

        // Combine and paginate
        const combined = [
          ...filteredMovies.map((m) => ({
            id: m.id,
            title: m.title,
            imdb_id: m.imdb_id,
            rating: m.rating,
            year: m.year,
            type: 'movie' as const,
          })),
          ...filteredTv.map((t) => ({
            id: t.id,
            title: t.title,
            imdb_id: t.imdb_id,
            rating: parseFloat(t.rating) || 0,
            year: '',
            poster: t.poster,
            seasons: t.seasons,
            type: 'tv' as const,
          })),
        ].sort((a, b) => b.rating - a.rating);

        const total = combined.length;
        const start = (page - 1) * perPage;
        const items = combined.slice(start, start + perPage);

        return NextResponse.json({
          page,
          per_page: perPage,
          total,
          items,
          cats,
        });
      }

      // /api/exp/showbox/movies?page=1&cat=xxx
      case 'movies': {
        const page = parseInt(searchParams.get('page') || '1', 10);
        const cat = searchParams.get('cat') || 'all';
        const perPage = 24;

        let movies = await getMovies();
        movies = movies.filter((m) => m.active === '1');

        if (cat !== 'all') {
          movies = movies.filter(
            (m) => m.cats && m.cats.split(',').includes(cat),
          );
        }

        const total = movies.length;
        const start = (page - 1) * perPage;
        const items = movies
          .sort((a, b) => b.rating - a.rating)
          .slice(start, start + perPage);

        return NextResponse.json({
          page,
          per_page: perPage,
          total,
          items,
        });
      }

      // /api/exp/showbox/tv?page=1&cat=xxx
      case 'tv': {
        const page = parseInt(searchParams.get('page') || '1', 10);
        const cat = searchParams.get('cat') || 'all';
        const perPage = 24;

        let tvShows = await getTVShows();
        tvShows = tvShows.filter((t) => t.active === '1');

        if (cat !== 'all') {
          tvShows = tvShows.filter(
            (t) => t.cats && t.cats.split(',').includes(cat),
          );
        }

        const total = tvShows.length;
        const start = (page - 1) * perPage;
        const items = tvShows
          .sort((a, b) => parseFloat(b.rating || '0') - parseFloat(a.rating || '0'))
          .slice(start, start + perPage);

        return NextResponse.json({
          page,
          per_page: perPage,
          total,
          items,
        });
      }

      // /api/exp/showbox/categories
      case 'categories': {
        const cats = await getCategories();
        return NextResponse.json(cats);
      }

      // /api/exp/showbox/detail/movie/{id}
      // /api/exp/showbox/detail/tv/{id}?season=1
      case 'detail': {
        const detailType = rest[0]; // 'movie' or 'tv'
        const detailId = rest[1];

        if (!detailId) {
          return NextResponse.json(
            { error: 'Missing ID. Use: /api/exp/showbox/detail/movie/<id>' },
            { status: 400 },
          );
        }

        if (detailType === 'movie') {
          const data = await getMovieDetail(detailId);
          return NextResponse.json(data);
        } else if (detailType === 'tv') {
          const season = searchParams.get('season') || '1';
          const data = await getTVSeason(detailId, season);
          return NextResponse.json(data);
        }

        return NextResponse.json(
          { error: 'Unknown detail type. Use "movie" or "tv".' },
          { status: 400 },
        );
      }

      // /api/exp/showbox/trailers
      case 'trailers': {
        const data = await getTrailers();
        return NextResponse.json(data);
      }

      // /api/exp/showbox/trailer/{id}
      case 'trailer': {
        if (!secondArg) {
          return NextResponse.json({ error: 'Missing trailer ID' }, { status: 400 });
        }
        const data = await getTrailerDetail(secondArg);
        return NextResponse.json(data);
      }

      // /api/exp/showbox/search?q=xxx
      case 'search': {
        const q = searchParams.get('q');
        if (!q) {
          return NextResponse.json({ error: 'Missing query param: q' }, { status: 400 });
        }

        const query = q.toLowerCase().trim();
        const [allMovies, allTv] = await Promise.all([
          getMovies(),
          getTVShows(),
        ]);

        const movieResults = allMovies
          .filter(
            (m) =>
              m.active === '1' &&
              (m.title.toLowerCase().includes(query) ||
                m.imdb_id?.toLowerCase() === query),
          )
          .slice(0, 20)
          .map((m) => ({
            id: m.id,
            title: m.title,
            rating: m.rating,
            year: m.year,
            type: 'movie' as const,
          }));

        const tvResults = allTv
          .filter(
            (t) =>
              t.active === '1' &&
              (t.title.toLowerCase().includes(query) ||
                t.imdb_id?.toLowerCase() === query),
          )
          .slice(0, 20)
          .map((t) => ({
            id: t.id,
            title: t.title,
            rating: parseFloat(t.rating) || 0,
            poster: t.poster,
            seasons: t.seasons,
            type: 'tv' as const,
          }));

        return NextResponse.json({
          query: q,
          movies: movieResults,
          tv: tvResults,
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown resource: ${resource}` },
          { status: 404 },
        );
    }
  } catch (error: any) {
    console.error('[ShowBox] API error:', error?.message);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 502 },
    );
  }
}
