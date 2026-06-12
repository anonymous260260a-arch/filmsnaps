'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { Movie } from '@/types';

const LOCAL_STORAGE_KEY = 'filmsnaps_saved_movies';

export interface SavedMovie extends Movie {
  created_at?: any;
  movie_id?: number;
}

export function useWatchlist() {
  const queryClient = useQueryClient();

  // -----------------------------
  // Fetch saved movies
  // -----------------------------
  const { data: savedMovies = [], isLoading } = useQuery<SavedMovie[]>({
    queryKey: ['saved_movies'],
    queryFn: async () => {
      const localSaved = localStorage.getItem(LOCAL_STORAGE_KEY);
      return localSaved ? JSON.parse(localSaved) : [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // -----------------------------
  // Save movie
  // -----------------------------
  const saveMovieMutation = useMutation({
    mutationFn: async (movie: Movie) => {
      const savedMovie: SavedMovie = {
        ...movie,
        id: movie.id,
        movie_id: movie.id,
        created_at: new Date().toISOString(),
      };

      const local = [...savedMovies, savedMovie];
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(local));

      return savedMovie;
    },
    onSuccess: (movie) => {
      queryClient.setQueryData<SavedMovie[]>(
        ['saved_movies'],
        (old) => (old ? [...old, movie] : [movie])
      );
    },
  });

  // -----------------------------
  // Remove movie
  // -----------------------------
  const removeMovieMutation = useMutation({
    mutationFn: async (movieId: number) => {
      const local = savedMovies.filter((m) => m.id !== movieId);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(local));
      return movieId;
    },
    onSuccess: (movieId) => {
      queryClient.setQueryData<SavedMovie[]>(
        ['saved_movies'],
        (old) => old?.filter((m) => m.id !== movieId) ?? []
      );
    },
  });

  // -----------------------------
  // Helpers
  // -----------------------------
  const isMovieSaved = (movieId: number) =>
    savedMovies.some((m) => m.id === movieId);

  const toggleSaveMovie = (movie: Movie) =>
    isMovieSaved(movie.id)
      ? removeMovieMutation.mutateAsync(movie.id)
      : saveMovieMutation.mutateAsync(movie);

  return {
    savedMovies,
    loading: isLoading,
    isMovieSaved,
    saveMovie: saveMovieMutation.mutateAsync,
    removeMovie: removeMovieMutation.mutateAsync,
    toggleSaveMovie,
  };
}
