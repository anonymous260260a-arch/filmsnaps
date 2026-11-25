"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Play, Info, Star } from "lucide-react";
import { GlassButton } from "@/components/ui/glass-button";
import { SaveButton } from "@/components/SaveButton";
import { MediaCarouselClient as MediaCarousel } from "@/components/MediaCarouselClient";
import { ContinueWatchingWrapper } from "@/components/ContinueWatchingWrapper";
import { SkeletonHero } from "@/components/SkeletonLoader";
import { getImageUrl } from "@/lib/tmdb";
import { useRouter } from "next/navigation";

interface TmdbResult {
  results: Array<Record<string, any>>;
}

interface MarqueeHomeProps {
  trendingMovies?: TmdbResult;
  trendingTV?: TmdbResult;
  popularMovies?: TmdbResult;
  upcomingMovies?: TmdbResult;
  featuredMovies?: Array<Record<string, any>>;
}

export function MarqueeHome({
  trendingMovies,
  trendingTV,
  popularMovies,
  upcomingMovies,
  featuredMovies,
}: MarqueeHomeProps) {
  return (
    <div className="space-y-8 sm:space-y-12 lg:space-y-14 pb-10 sm:pb-14">
      <MarqueeHero movies={featuredMovies ?? []} />
      <ContinueWatchingWrapper />
      <WideRail
        title="Trending Movies"
        mediaType="movie"
        data={trendingMovies}
      />
      <WideRail title="Trending TV Shows" mediaType="tv" data={trendingTV} />
      <WideRail title="Popular Movies" mediaType="movie" data={popularMovies} />
      <WideRail
        title="Upcoming Movies"
        mediaType="movie"
        data={upcomingMovies}
      />
    </div>
  );
}

/* ── Marquee hero ─────────────────────────────────────────────────── */

function dayIndex(): number {
  return Math.floor(Date.now() / 86400000);
}

function formatRuntime(minutes: number) {
  if (!minutes) return "";
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function MarqueeHero({ movies }: { movies: any[] }) {
  const router = useRouter();
  const initial = useMemo(
    () => (movies.length ? dayIndex() % movies.length : 0),
    [movies],
  );
  const [selected, setSelected] = useState<number>(initial);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!movies.length) return <SkeletonHero />;

  const idx = Math.min(selected, movies.length - 1);
  const movie = movies[idx];
  const title = movie.title || movie.name;
  const overview = movie.overview || "";
  // Same rule as the swipe hero: w1280 instead of the full-size original.
  const backdrop = getImageUrl(movie.backdrop_path, "w1280");
  const year = (movie.release_date || movie.first_air_date || "").slice(0, 4);
  const rating = movie.vote_average || 0;
  const runtime = movie.runtime;
  const type = movie.media_type === "tv" ? "tv" : "movie";
  const strip = movies.slice(0, 8);

  return (
    <section className="relative w-full h-[86vh] min-h-[560px] overflow-hidden">
      {backdrop && (
        <Image
          key={movie.id}
          src={backdrop}
          alt={title}
          fill
          priority={idx === initial}
          loading={idx === initial ? "eager" : "lazy"}
          sizes="100vw"
          quality={idx === initial ? 90 : 75}
          className={`object-cover brightness-[0.6] ${
            mounted && idx === initial ? "animate-ken-burns" : ""
          }`}
        />
      )}

      <div className="absolute inset-0 gradient-overlay" />
      <div className="absolute inset-0 gradient-hero-text" />

      <div className="absolute inset-0 flex items-center">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl animate-fade-in">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-accent/90">
              Tonight&apos;s feature
            </p>

            <div className="flex items-center gap-3 mb-4">
              {rating > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-accent/15 text-amber-accent text-xs font-semibold">
                  <Star className="h-3.5 w-3.5 fill-amber-accent" />
                  {rating.toFixed(1)}
                </span>
              )}
              {year && (
                <span className="text-sm text-white/60 font-medium">
                  {year}
                </span>
              )}
              {runtime && (
                <>
                  <span className="text-white/30">·</span>
                  <span className="text-sm text-white/60 font-medium">
                    {formatRuntime(runtime)}
                  </span>
                </>
              )}
            </div>

            <h2 className="text-4xl sm:text-5xl md:text-7xl font-black tracking-tight text-white text-shadow-hero mb-4 text-balance leading-[1.1]">
              {title}
            </h2>

            {overview && (
              <p className="text-base sm:text-lg text-white/70 text-shadow-soft line-clamp-2 max-w-xl mb-8 leading-relaxed">
                {overview}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <GlassButton
                size="lg"
                className="gap-2.5 font-bold px-8 py-3.5 h-auto text-base text-background bg-gradient-to-b from-primary-bright to-primary border-0 shadow-[0_8px_24px_rgba(212,162,55,0.35)] hover:shadow-[0_10px_32px_rgba(212,162,55,0.5)] hover:brightness-[1.05] active:brightness-95 active:scale-[0.98] transition-all duration-200"
                onClick={() =>
                  router.push(`/watch?type=${type}&id=${movie.id}`)
                }
              >
                <Play className="w-5 h-5 fill-current" />
                Watch Now
              </GlassButton>

              <SaveButton
                movie={movie}
                size="lg"
                variant="secondary"
                className="px-5 py-3 h-auto text-sm font-medium hover:bg-white/[0.08] transition-all"
              />

              <Link href={`/${type}?id=${movie.id}`}>
                <GlassButton
                  size="lg"
                  variant="secondary"
                  className="gap-2 px-5 py-3 h-auto text-sm font-medium hover:bg-white/[0.08] transition-all"
                >
                  <Info className="w-4 h-4" />
                  Details
                </GlassButton>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 inset-x-0 z-20">
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background via-background/70 to-transparent pointer-events-none" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-5">
          <div className="flex items-end gap-2.5 sm:gap-3 overflow-x-auto scrollbar-hide">
            {strip.map((m, i) => (
              <button
                key={m.id}
                onClick={() => setSelected(i)}
                aria-label={`Feature ${(m.title || m.name) as string}`}
                className={`relative shrink-0 w-12 sm:w-16 md:w-20 aspect-[2/3] rounded-md overflow-hidden transition-all duration-300 ${
                  i === idx
                    ? "ring-1 ring-primary ring-offset-1 ring-offset-background -translate-y-1"
                    : "opacity-50 hover:opacity-100"
                }`}
              >
                <Image
                  src={getImageUrl(m.poster_path, "w185")}
                  alt={m.title || m.name}
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Full-width rails ─────────────────────────────────────────────── */

function WideRail({
  title,
  mediaType,
  data,
}: {
  title: string;
  mediaType: string;
  data?: TmdbResult;
}) {
  if (data === undefined) {
    return (
      <section className="px-5 sm:px-6 lg:px-8">
        <div className="h-7 w-44 rounded-md skeleton mb-5" />
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="shrink-0 w-[38vw] sm:w-[22vw] lg:w-[16vw] aspect-[2/3] rounded-xl skeleton"
            />
          ))}
        </div>
      </section>
    );
  }
  if (!data.results.length) return null;
  return (
    <MediaCarousel title={title} items={data.results} mediaType={mediaType} />
  );
}
