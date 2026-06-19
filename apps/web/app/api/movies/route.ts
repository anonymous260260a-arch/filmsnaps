// app/api/movies/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getMovies } from '@/lib/tmdb.server'; // server-only

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const page = Number(searchParams.get('page') || 1);
  const sortBy = searchParams.get('sortBy') || 'popularity.desc';
  const yearStart = Number(searchParams.get('yearStart') || 1900);
  const yearEnd = Number(
    searchParams.get('yearEnd') || new Date().getFullYear()
  );
  const minRating = Number(searchParams.get('minRating') || 0);
  const maxRating = Number(searchParams.get('maxRating') || 10);
  const genres = searchParams.get('genres')?.split(',').map(Number);
  const language = searchParams.get('language') || undefined;

  try {
    const movies = await getMovies({
      page,
      sortBy,
      genreIds: genres,
      yearStart,
      yearEnd,
      minRating,
      maxRating,
      language,
    });
    return NextResponse.json(movies);
  } catch (err) {
    return NextResponse.json(
      { results: [], page, total_pages: 0 },
      { status: 500 }
    );
  }
}
