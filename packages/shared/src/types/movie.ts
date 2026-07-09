/**
 * TMDB movie / TV show shape used across the app.
 */
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
  credits?: {
    cast: CastMember[];
    crew: CrewMember[];
  };
}

/** A person (actor, director, etc.) */
export interface Person {
  id: number;
  name: string;
  profile_path?: string;
  biography?: string;
  birthday?: string;
  deathday?: string;
  place_of_birth?: string;
  known_for_department?: string;
  also_known_as?: string[];
  gender?: number;
  popularity?: number;
  homepage?: string;
  /** Combined credits returned from person endpoint */
  combined_credits?: {
    cast: PersonCredit[];
    crew: PersonCredit[];
  };
}

/** A cast member on a movie or TV show */
export interface CastMember {
  id: number;
  name: string;
  character: string;
  profile_path?: string;
  order: number;
}

/** Crew member on a movie or TV show */
export interface CrewMember {
  id: number;
  name: string;
  job: string;
  department: string;
  profile_path?: string;
}

/** A person's credit in a movie or TV show (from combined_credits) */
export interface PersonCredit {
  id: number;
  title?: string;
  name?: string;
  media_type: 'movie' | 'tv';
  character?: string;
  job?: string;
  poster_path?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
  popularity?: number;
}
