/**
 * HomeModeFeed — mode-branching home content for the Hard Mode Split.
 *
 * In anime mode, swaps the TMDB rails for the AniList-backed AnimeHomeFeed
 * (mirrors mobile's home split at apps/mobile/app/(tabs)/index.tsx:705).
 * In movie_tv mode it renders the unchanged TMDB hero + rails + Continue
 * Watching. Keep the TMDB data passed in as props so the server fetch in
 * app/page.tsx stays where it is.
 */

"use client";

import { useAppMode } from "@/lib/useAppMode";
import { AnimeHomeFeed } from "@/components/AnimeHomeFeed";
import { ContinueWatchingWrapper } from "@/components/ContinueWatchingWrapper";
import { MarqueeHome } from "@/components/home/MarqueeHome";

interface TmdbResult {
  results: Array<Record<string, any>>;
}

interface HomeModeFeedProps {
  trendingMovies?: TmdbResult;
  trendingTV?: TmdbResult;
  popularMovies?: TmdbResult;
  upcomingMovies?: TmdbResult;
  featuredMovies?: Array<Record<string, any>>;
}

export function HomeModeFeed({
  trendingMovies,
  trendingTV,
  popularMovies,
  upcomingMovies,
  featuredMovies,
}: HomeModeFeedProps) {
  const { mode } = useAppMode();

  if (mode === "anime") {
    return (
      <div className="home-anime-feed space-y-12 py-10 sm:space-y-16">
        <ContinueWatchingWrapper />
        <AnimeHomeFeed />
      </div>
    );
  }

  return (
    <MarqueeHome
      trendingMovies={trendingMovies}
      trendingTV={trendingTV}
      popularMovies={popularMovies}
      upcomingMovies={upcomingMovies}
      featuredMovies={featuredMovies}
    />
  );
}
