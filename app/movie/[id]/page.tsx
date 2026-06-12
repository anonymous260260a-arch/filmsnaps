import { tmdbApi } from '@/lib/tmdb';
import MovieClient from './MovieClient';
import { tmdb, tmdbMovieFull } from '@/lib/tmdb.server';

export default async function MoviePage({ params }: { params: any }) {
  const { id } = await params;
  const movie = await tmdbMovieFull(id);
  if (!movie) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-muted-foreground">Movie not found</div>
      </div>
    );
  }

  return <MovieClient movie={movie} />;
}
