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

import dynamic from "next/dynamic";
import { useAppMode } from "@/lib/useAppMode";
import { AnimeHomeFeed } from "@/components/AnimeHomeFeed";
import { ContinueWatchingWrapper } from "@/components/ContinueWatchingWrapper";
import { MediaCarouselClient as MediaCarousel } from "@/components/MediaCarouselClient";
import { SkeletonHero } from "@/components/SkeletonLoader";

const Hero = dynamic(
  () => import("@/components/Hero").then((mod) => ({ default: mod.Hero })),
  { loading: () => <SkeletonHero />, ssr: true },
);

interface TmdbResult {
  results: Array<Record<string, any>>;
}

interface HomeModeFeedProps {
  trendingMovies: TmdbResult;
  trendingTV: TmdbResult;
  popularMovies: TmdbResult;
  upcomingMovies: TmdbResult;
  featuredMovies: Array<Record<string, any>>;
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
        {featuredMovies.length > 0 && <ContinueWatchingWrapper />}
        <AnimeHomeFeed />
      </div>
    );
  }

  return (
    <div className="space-y-12 sm:space-y-16 pb-10 sm:pb-14">
      {featuredMovies.length > 0 && <Hero movies={featuredMovies} />}
      {featuredMovies.length > 0 && <ContinueWatchingWrapper />}

      {trendingMovies.results.length > 0 && (
        <>
          <MediaCarousel
            title="Trending Movies"
            items={trendingMovies.results}
            mediaType="movie"
          />
          {trendingTV.results.length > 0 && (
            <div className="mx-auto w-3/4 h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
          )}
        </>
      )}

      {trendingTV.results.length > 0 && (
        <>
          <MediaCarousel
            title="Trending TV Shows"
            items={trendingTV.results}
            mediaType="tv"
          />
          {popularMovies.results.length > 0 && (
            <div className="mx-auto w-3/4 h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
          )}
        </>
      )}

      {popularMovies.results.length > 0 && (
        <>
          <MediaCarousel
            title="Popular Movies"
            items={popularMovies.results}
            mediaType="movie"
          />
        </>
      )}

      {upcomingMovies.results.length > 0 && (
        <>
          <div className="mx-auto w-3/4 h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
          <MediaCarousel
            title="Upcoming Movies"
            items={upcomingMovies.results}
            mediaType="movie"
          />
        </>
      )}
    </div>
  );
}
