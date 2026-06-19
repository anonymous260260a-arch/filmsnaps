import { getTvGenres, tmdb } from '@/lib/tmdb.server';
import TVClient from './TVClient';

interface TVPageProps {
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

export default async function TVPage({ searchParams }: TVPageProps) {
  const {
    genres,
    sortBy = 'popularity.desc',
    yearStart = '1950',
    yearEnd = `${new Date().getFullYear()}`,
    minRating = '0',
    maxRating = '10',
    language = '',
  } = await searchParams;

  const genreIds = genres ? genres.split(',').map(Number) : undefined;

  // Fetch first page server-side
  const firstPageTV = await tmdb(
    `/discover/tv?page=1&sort_by=${sortBy}&first_air_date.gte=${yearStart}-01-01&first_air_date.lte=${yearEnd}-12-31&vote_average.gte=${minRating}&vote_average.lte=${maxRating}${
      language ? `&with_original_language=${language}` : ''
    }${genreIds ? `&with_genres=${genreIds.join(',')}` : ''}`
  );
  const AvailbleGenres = await getTvGenres();
  return (
    <TVClient
      initialData={firstPageTV}
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
