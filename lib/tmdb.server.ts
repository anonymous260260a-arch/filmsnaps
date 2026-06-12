// lib/tmdb.server.ts
import 'server-only';

const BASE = 'https://api.themoviedb.org/3';
const KEY = process.env.TMDB_API_KEY!;

interface GetMoviesOptions {
  genreIds?: number[];
  sortBy?: string;
  yearStart?: number;
  yearEnd?: number;
  minRating?: number;
  maxRating?: number;
  language?: string;
  page?: number;
}
interface GetTVOptions {
  genreIds?: number[];
  sortBy?: string;
  yearStart?: number;
  yearEnd?: number;
  minRating?: number;
  maxRating?: number;
  language?: string;
  page?: number;
}
export async function tmdb(path: string) {
  const separator = path.includes('?') ? '&' : '?';

  const res = await fetch(`${BASE}${path}${separator}api_key=${KEY}`, {
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('TMDB ERROR:', res.status, text);
    throw new Error('TMDB fetch failed');
  }

  return res.json();
}

export async function tmdbMovieMeta(id: string) {
  return tmdb(`/movie/${id}`);
}

export async function tmdbMovieFull(id: string) {
  return tmdb(`/movie/${id}?append_to_response=videos,credits,similar`);
}
export async function getMovieGenres() {
  return tmdb('/genre/movie/list?language=en-US');
}
export async function getTvGenres() {
  return tmdb('/genre/tv/list?language=en-US');
}
export async function tmdbTvMeta(id: string) {
  return tmdb(`/tv/${id}?append_to_response=images,credits`);
}

export async function tmdbTvFull(id: string) {
  return tmdb(`/tv/${id}?append_to_response=videos,credits,similar`);
}
export async function getMovies({
  genreIds,
  sortBy = 'popularity.desc',
  yearStart,
  yearEnd,
  minRating,
  maxRating,
  language,
  page = 1,
}: GetMoviesOptions) {
  let path = `/discover/movie?sort_by=${sortBy}&page=${page}`;

  if (genreIds?.length) path += `&with_genres=${genreIds.join(',')}`;
  if (yearStart && yearEnd)
    path += `&primary_release_date.gte=${yearStart}-01-01&primary_release_date.lte=${yearEnd}-12-31`;
  if (minRating !== undefined) path += `&vote_average.gte=${minRating}`;
  if (maxRating !== undefined) path += `&vote_average.lte=${maxRating}`;
  if (language) path += `&with_original_language=${language}`;

  return tmdb(path);
}

export async function getTVShows({
  genreIds,
  sortBy = 'popularity.desc',
  yearStart,
  yearEnd,
  minRating,
  maxRating,
  language,
  page = 1,
}: GetTVOptions) {
  let path = `/discover/tv?sort_by=${sortBy}&page=${page}`;

  if (genreIds?.length) path += `&with_genres=${genreIds.join(',')}`;
  if (yearStart && yearEnd)
    path += `&first_air_date.gte=${yearStart}-01-01&first_air_date.lte=${yearEnd}-12-31`;
  if (minRating !== undefined) path += `&vote_average.gte=${minRating}`;
  if (maxRating !== undefined) path += `&vote_average.lte=${maxRating}`;
  if (language) path += `&with_original_language=${language}`;

  return tmdb(path);
}
export async function tmdbTvSeasonMeta(id: string, seasonNumber: number) {
  return tmdb(`/tv/${id}/season/${seasonNumber}`);
}
