'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Play, Info, Star } from 'lucide-react';
import { GlassButton } from '@/components/ui/glass-button';
import { SaveButton } from '@/components/SaveButton';
import { tmdbApi, getImageUrl } from '@/lib/tmdb';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Autoplay, EffectFade, Navigation, Pagination } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/effect-fade';
import 'swiper/css/autoplay';
import 'swiper/css/navigation';
import 'swiper/css/pagination';
import Link from 'next/link';
import { Button } from './ui/button';
import { useRouter } from 'next/navigation';

function formatRuntime(minutes: number) {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function formatRating(vote: number) {
  return (vote / 2).toFixed(1);
}

export function Hero({ movies = [] }: { movies: any[] }) {
  const router = useRouter();
  const [currentMovie, setCurrentMovie] = useState<any>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (movies.length > 0) setCurrentMovie(movies[0]);
  }, [movies]);

  if (!movies.length) return null;

  return (
    <section className="group relative w-full h-[90vh] min-h-[600px] overflow-hidden">
      {/* Ambient glow behind the hero */}
      <div className="absolute inset-0 ambient-glow z-10 pointer-events-none" />
      <div className="absolute inset-0 ambient-glow-warm z-10 pointer-events-none" />

      <Swiper
        modules={[Autoplay, EffectFade, Navigation, Pagination]}
        effect="fade"
        autoplay={{ delay: 6000, disableOnInteraction: false }}
        navigation={{ nextEl: '.hero-next', prevEl: '.hero-prev' }}
        pagination={{ clickable: true, el: '.hero-pagination' }}
        speed={800}
        loop
        className="h-full hero-swiper"
        onSlideChange={(swiper) => {
          setCurrentMovie(movies[swiper.realIndex]);
          setActiveIndex(swiper.realIndex);
        }}
      >
        {movies.map((movie, idx) => {
          const title = movie.title || movie.name;
          const overview = movie.overview || '';
          const backdrop = getImageUrl(movie.backdrop_path, 'original');
          const year = (movie.release_date || movie.first_air_date || '').slice(0, 4);
          const rating = movie.vote_average || 0;
          const genres = movie.genre_ids || [];
          const runtime = movie.runtime;

          return (
            <SwiperSlide key={movie.id}>
              <div className="relative w-full h-full">
                {/* Backdrop with ken burns */}
                {backdrop && (
                  <Image
                    src={backdrop}
                    alt={title}
                    fill
                    priority={idx === 0}
                    loading={idx === 0 ? 'eager' : 'lazy'}
                    sizes="100vw"
                    quality={idx === 0 ? 90 : 75}
                    fetchPriority={idx === 0 ? 'high' : 'auto'}
                    className={`object-cover brightness-[0.6] ${
                      idx === activeIndex ? 'animate-ken-burns' : ''
                    }`}
                  />
                )}

                {/* Warm overlay gradients */}
                <div className="absolute inset-0 gradient-overlay" />
                <div className="absolute inset-0 gradient-hero-text" />

                {/* Content */}
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="max-w-2xl animate-fade-in">
                      {/* Rating + Year + Runtime pill */}
                      <div className="flex items-center gap-3 mb-4">
                        {rating > 0 && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-accent/15 text-amber-accent text-xs font-semibold">
                            <Star className="h-3.5 w-3.5 fill-amber-accent" />
                            {formatRating(rating)}
                          </span>
                        )}
                        {year && (
                          <span className="text-sm text-white/60 font-medium">{year}</span>
                        )}
                        {runtime && (
                          <>
                            <span className="text-white/30">·</span>
                            <span className="text-sm text-white/60 font-medium">{formatRuntime(runtime)}</span>
                          </>
                        )}
                      </div>

                      {/* Title */}
                      <h1 className="text-4xl sm:text-5xl md:text-7xl font-black tracking-tight text-white text-shadow-hero mb-4 text-balance leading-[1.1]">
                        {title}
                      </h1>

                      {/* Overview */}
                      {overview && (
                        <p className="text-base sm:text-lg text-white/70 text-shadow-soft line-clamp-2 max-w-xl mb-8 leading-relaxed">
                          {overview}
                        </p>
                      )}

                      {/* Actions */}
                      <div className="flex flex-wrap items-center gap-3">
                        <GlassButton
                          size="lg"
                          className="gap-2.5 font-bold px-7 py-3 h-auto text-base"
                          onClick={() => router.push(`/watch/movie/${movie.id}`)}
                        >
                          <Play className="w-5 h-5 fill-current" />
                          Watch Now
                        </GlassButton>

                        <SaveButton
                          movie={movie}
                          size="lg"
                          variant="secondary"
                          className="glass-light px-5 py-3 h-auto text-sm font-medium hover:bg-white/[0.08] transition-all"
                        />

                        <Link href={`/movie/${movie.id}`}>
                          <Button
                            variant="outline"
                            className="h-auto px-5 py-3 rounded-xl border-white/[0.12] bg-white/[0.04] text-white/80 text-sm font-medium transition-all duration-200 hover:bg-white/[0.08] hover:text-white hover:border-white/[0.2]"
                          >
                            <Info className="w-4 h-4 mr-2" />
                            Details
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </SwiperSlide>
          );
        })}
      </Swiper>

      {/* Custom Pagination */}
      <div className="hero-pagination absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2" />

      {/* Nav Arrows */}
      <button className="hero-prev absolute top-1/2 left-4 md:left-8 -translate-y-1/2 z-20 w-11 h-11 flex items-center justify-center rounded-full glass-light text-white/60 hover:text-white transition-all duration-300 opacity-0 group-hover:opacity-100 hover:scale-105">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <button className="hero-next absolute top-1/2 right-4 md:right-8 -translate-y-1/2 z-20 w-11 h-11 flex items-center justify-center rounded-full glass-light text-white/60 hover:text-white transition-all duration-300 opacity-0 group-hover:opacity-100 hover:scale-105">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
      </button>
    </section>
  );
}
