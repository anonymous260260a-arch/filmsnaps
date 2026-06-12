export interface Movie {
  id: number;
  title?: string;
  name?: string;
  poster_path?: string;
  poster?: string;
  backdrop_path?: string;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  runtime?: number;
  tagline?: string;
  media_type?: string;
  videos?: {
    results: {
      key: string;
      name: string;
      site: string;
      type: string;
    }[];
  };
  similar?: {
    results: Movie[];
  };
}