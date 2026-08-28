// app/page.tsx
import { Suspense } from "react";
import { Header } from "@/components/Header";
import { SkeletonHero } from "@/components/SkeletonLoader";
import { LegalFooter } from "@/components/legal/LegalFooter";
import { HomeModeFeed } from "@/components/HomeModeFeed";
import { tmdb } from "@/lib/tmdb.server";

export default async function Home() {
  let trendingMovies: any = { results: [] };
  let trendingTV: any = { results: [] };
  let popularMovies: any = { results: [] };
  let upcomingMovies: any = { results: [] };

  try {
    [trendingMovies, trendingTV, popularMovies, upcomingMovies] =
      await Promise.all([
        tmdb("/trending/movie/week"),
        tmdb("/trending/tv/week"),
        tmdb("/movie/popular"),
        tmdb("/movie/upcoming"),
      ]);
  } catch (e) {
    console.error("[Home] Failed to fetch TMDB data:", e);
  }

  const featuredMovies = trendingMovies.results.slice(0, 5) || [];

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-700">
      <Header />
      <main>
        {/* Single branded h1 for the home page — visually hidden so the hero
            (an h2) and section titles carry the visual hierarchy while
            crawlers/ATs still get a clean, keyword-rich top-level heading. */}
        <h1 className="sr-only">FilmSnaps — Discover Movies &amp; TV Shows</h1>
        <Suspense fallback={<SkeletonHero />}>
          <HomeModeFeed
            trendingMovies={trendingMovies}
            trendingTV={trendingTV}
            popularMovies={popularMovies}
            upcomingMovies={upcomingMovies}
            featuredMovies={featuredMovies}
          />
        </Suspense>
      </main>
      <LegalFooter />
    </div>
  );
}
