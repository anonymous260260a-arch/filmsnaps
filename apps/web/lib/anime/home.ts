/**
 * useAniListHome — client hook feeding the anime home feed. Pulls the
 * Trending / Popular / This-Season rails from the edge-cached /api/anime/home
 * proxy (AniList upstream, TMDB-spine gated — same contract as search).
 */

"use client";

import { useEffect, useState } from "react";

export interface AniListHomeItem {
  malId: number;
  anilistId: number | null;
  tmdbShowId?: number;
  tmdbMovieId?: number;
  title: string;
  image: string | null;
  year: number | null;
  episodes: number | null;
  type: string | null;
  score: number | null;
  members: number | null;
}

export interface AniListHome {
  trending: AniListHomeItem[];
  popular: AniListHomeItem[];
  seasonal: AniListHomeItem[];
}

export function useAniListHome(limit = 20): {
  data: AniListHome | null;
  isLoading: boolean;
  error: boolean;
} {
  const [data, setData] = useState<AniListHome | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    setIsLoading(true);
    setError(false);
    fetch(`/api/anime/home?limit=${limit}`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((json: AniListHome) => {
        if (cancelled) return;
        setData(json);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [limit]);

  return { data, isLoading, error };
}
