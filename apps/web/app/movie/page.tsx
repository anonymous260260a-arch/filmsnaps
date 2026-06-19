import { getMovieGenres, tmdb } from '@/lib/tmdb.server';
import MoviesClient from './MoviesClient';

interface MoviesPageProps {
  searchParams: Promise<{
    genres?: string;
    sortBy?: string;
    yearStart?: string;
    yearEnd?: string;
    minRating?: string;
    maxRating?: string;
    language?: string;
  }>;
}

export default async function MoviesPage({ searchParams }: MoviesPageProps) {
  const {
    genres,
    sortBy = 'popularity.desc',
    yearStart = '1900',
    yearEnd = `${new Date().getFullYear()}`,
    minRating = '0',
    maxRating = '10',
    language = '',
  } = await searchParams;

  const genreIds = genres ? genres.split(',').map(Number) : undefined;

  // Fetch first page server-side
  const firstPageMovies = await tmdb(
    `/discover/movie?page=1&sort_by=${sortBy}&primary_release_date.gte=${yearStart}-01-01&primary_release_date.lte=${yearEnd}-12-31&vote_average.gte=${minRating}&vote_average.lte=${maxRating}${
      language ? `&with_original_language=${language}` : ''
    }${genreIds ? `&with_genres=${genreIds.join(',')}` : ''}`
  );
  const AvailbleGenres = await getMovieGenres();
  return (
    <MoviesClient
      initialData={firstPageMovies}
      genres={AvailbleGenres.genres}
      initialFilters={{
        genreIds,
        sortBy,
        yearRange: [parseInt(yearStart), parseInt(yearEnd)],
        ratingRange: [parseFloat(minRating), parseFloat(maxRating)],
        language,
      }}
    />
  );
}
