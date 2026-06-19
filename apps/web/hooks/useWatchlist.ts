"use client";

import { useState, useCallback, useEffect } from "react";
import type { Movie } from "@filmsnaps/shared";

const STORAGE_KEY = "filmsnaps-watchlist";

interface WatchlistEntry {
  id: number;
  title?: string;
  name?: string;
  poster_path?: string;
  vote_average?: number;
  media_type?: string;
}

function loadWatchlist(): WatchlistEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveWatchlist(entries: WatchlistEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage unavailable
  }
}

export function useWatchlist() {
  const [entries, setEntries] = useState<WatchlistEntry[]>(loadWatchlist);
  const [loading, setLoading] = useState(false);

  // Sync across tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setEntries(loadWatchlist());
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const isMovieSaved = useCallback(
    (id: number) => entries.some((e) => e.id === id),
    [entries],
  );

  const toggleSaveMovie = useCallback(
    async (movie: Movie): Promise<boolean> => {
      const id = movie.id;
      if (entries.some((e) => e.id === id)) {
        const next = entries.filter((e) => e.id !== id);
        setEntries(next);
        saveWatchlist(next);
      } else {
        const entry: WatchlistEntry = {
          id,
          title: movie.title,
          name: movie.name,
          poster_path: movie.poster_path,
          vote_average: movie.vote_average,
          media_type: movie.media_type,
        };
        const next = [entry, ...entries];
        setEntries(next);
        saveWatchlist(next);
      }
      return true;
    },
    [entries],
  );

  const removeMovie = useCallback(
    async (id: number): Promise<boolean> => {
      const next = entries.filter((e) => e.id !== id);
      setEntries(next);
      saveWatchlist(next);
      return true;
    },
    [entries],
  );

  return {
    savedMovies: entries,
    loading,
    isMovieSaved,
    toggleSaveMovie,
    removeMovie,
  };
}
