// app/page.tsx
"use client";

import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { SkeletonHero } from "@/components/SkeletonLoader";
import { LegalFooter } from "@/components/legal/LegalFooter";
import { HomeModeFeed } from "@/components/HomeModeFeed";
import { tmdbApi } from "@/lib/tmdb";

function HomeContent() {
  const { data: trendingMovies } = useQuery({
    queryKey: ["movies", "trending"],
    queryFn: () => tmdbApi.getTrendingMovies(),
    staleTime: 10 * 60 * 1000, // 10 min
  });

  const { data: trendingTV } = useQuery({
    queryKey: ["tv", "trending"],
    queryFn: () => tmdbApi.getTrendingTV(),
    staleTime: 10 * 60 * 1000,
  });

  const { data: popularMovies } = useQuery({
    queryKey: ["movies", "popular"],
    queryFn: () => tmdbApi.getPopularMovies(),
    staleTime: 10 * 60 * 1000,
  });

  const { data: upcomingMovies } = useQuery({
    queryKey: ["movies", "upcoming"],
    queryFn: () => tmdbApi.getUpcomingMovies(),
    staleTime: 1000 * 60 * 60 * 24, // 24 hours — changes rarely
  });

  const featuredMovies = trendingMovies?.results?.slice(0, 5) || [];

  return (
    <>
      <Header />
      <main>
        <h1 className="sr-only">FilmSnaps — Discover Movies &amp; TV Shows</h1>
        <HomeModeFeed
          trendingMovies={trendingMovies}
          trendingTV={trendingTV}
          popularMovies={popularMovies}
          upcomingMovies={upcomingMovies}
          featuredMovies={featuredMovies}
        />
      </main>
      <LegalFooter />
    </>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-700">
      <Suspense fallback={<SkeletonHero />}>
        <HomeContent />
      </Suspense>
    </div>
  );
}
