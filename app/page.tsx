// app/page.tsx
import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { SkeletonHero, SkeletonRow } from '@/components/SkeletonLoader';

// Lazy load heavy components
const Hero = dynamic(
  () => import('@/components/Hero').then((mod) => ({ default: mod.Hero })),
  { loading: () => <SkeletonHero />, ssr: true }
);

import { MediaCarouselClient as MediaCarousel } from '@/components/MediaCarouselClient';
import { tmdb } from '@/lib/tmdb.server';

export default async function Home() {
  const [trendingMovies, trendingTV, popularMovies, upcomingMovies] =
    await Promise.all([
      tmdb('/trending/movie/week'),
      tmdb('/trending/tv/week'),
      tmdb('/movie/popular'),
      tmdb('/movie/upcoming'),
    ]);

  const featuredMovies = trendingMovies.results.slice(0, 5) || [];

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-700">
      <Header />
      <main className="pt-16">
        <Suspense fallback={<SkeletonHero />}>
          {featuredMovies.length > 0 && <Hero movies={featuredMovies} />}
        </Suspense>

        <div className="space-y-12 sm:space-y-16 py-10 sm:py-14">
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
      </main>
    </div>
  );
}
