'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/components/AuthProvider';
import { Movie } from '@/types';

const LOCAL_STORAGE_KEY = 'filmsnaps_saved_movies';

export interface SavedMovie extends Movie {
  created_at?: any;
  movie_id?: number;
}

export function useWatchlist() {
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  // -----------------------------
  // Fetch saved movies
  // -----------------------------
  const { data: savedMovies = [], isLoading } = useQuery<SavedMovie[]>({
    queryKey: ['saved_movies', user?.uid],
    queryFn: async () => {
      // Anonymous user → localStorage
      if (!user) {
        const localSaved = localStorage.getItem(LOCAL_STORAGE_KEY);
        return localSaved ? JSON.parse(localSaved) : [];
      }

      // Load local movies first (for sync)
      const localSaved = localStorage.getItem(LOCAL_STORAGE_KEY);
      const localMovies: SavedMovie[] = localSaved
        ? JSON.parse(localSaved)
        : [];

      const colRef = collection(db, 'users', user.uid, 'saved_movies');
      const snapshot = await getDocs(colRef);

      const remoteMovies: SavedMovie[] = snapshot.docs.map((doc) => ({
        id: Number(doc.id),
        ...doc.data(),
      })) as SavedMovie[];

      // Sync local → Firestore
      const remoteIds = new Set(remoteMovies.map((m) => m.id));
      const unsynced = localMovies.filter((m) => !remoteIds.has(m.id));

      if (unsynced.length) {
        await Promise.all(
          unsynced.map((movie) =>
            setDoc(doc(colRef, String(movie.id)), {
              movie_id: movie.id,
              title: movie.title || movie.name,
              poster: movie.poster_path,
              created_at: serverTimestamp(),
            })
          )
        );

        localStorage.removeItem(LOCAL_STORAGE_KEY);
        return [...remoteMovies, ...unsynced];
      }

      return remoteMovies;
    },
    enabled: !authLoading,
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

      if (user) {
        const docRef = doc(
          db,
          'users',
          user.uid,
          'saved_movies',
          String(movie.id)
        );
        await setDoc(docRef, {
          movie_id: movie.id,
          title: movie.title || movie.name,
          poster: movie.poster_path,
          created_at: serverTimestamp(),
        });
      } else {
        const local = [...savedMovies, savedMovie];
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(local));
      }

      return savedMovie;
    },
    onSuccess: (movie) => {
      queryClient.setQueryData<SavedMovie[]>(
        ['saved_movies', user?.uid],
        (old) => (old ? [...old, movie] : [movie])
      );
    },
  });

  // -----------------------------
  // Remove movie
  // -----------------------------
  const removeMovieMutation = useMutation({
    mutationFn: async (movieId: number) => {
      if (user) {
        await deleteDoc(
          doc(db, 'users', user.uid, 'saved_movies', String(movieId))
        );
      } else {
        const local = savedMovies.filter((m) => m.id !== movieId);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(local));
      }
      return movieId;
    },
    onSuccess: (movieId) => {
      queryClient.setQueryData<SavedMovie[]>(
        ['saved_movies', user?.uid],
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
