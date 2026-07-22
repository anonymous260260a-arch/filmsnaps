'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Star, Calendar, Tv, ArrowLeft, Play, Youtube, Download, CloudDownload } from 'lucide-react';
import { getImageUrl, getTrailerKey } from '@/lib/tmdb';
import dynamic from 'next/dynamic';
import { MediaCarousel } from '@/components/MediaCarousel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import VideoSkeleton from '@/components/VideoSkeleton';
import { Suspense } from 'react';
import { SaveButton } from '@/components/SaveButton';
import { useRouter } from 'next/navigation';
import { CastCarousel } from '@/components/CastCarousel';
import { TrailerModal } from '@/components/TrailerModal';

const VideoPlayer = dynamic(
  () =>
    import('@/components/VideoPlayer').then((mod) => ({
      default: mod.VideoPlayer,
    })),
  { ssr: false, loading: () => <VideoSkeleton /> },
);

export default function TVClient({ show }: { show: any }) {
  const router = useRouter();
  const [trailerOpen, setTrailerOpen] = useState(false);
  const trailerKey = getTrailerKey(show.videos);
  const firstAirYear = show.first_air_date
    ? new Date(show.first_air_date).getFullYear()
    : null;

  return (
    <div className="min-h-screen bg-background">
      <main className="pt-16">
        {/* ── Backdrop Hero ── */}
        <div className="relative">
          {show.backdrop_path && (
            <div className="absolute inset-0 h-[60vh]">
              <Image
                src={getImageUrl(show.backdrop_path, 'original')}
                alt={show.name}
                fill
                priority
                sizes="100vw"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent" />
              <div className="absolute inset-0 gradient-overlay" />
            </div>
          )}

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            <Link href="/">
              <Button variant="ghost" className="mb-6 gap-2 text-muted-foreground hover:text-foreground -ml-3">
                <ArrowLeft className="h-4 w-4" />
                Back to Home
              </Button>
            </Link>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12">
              {/* Poster */}
              <div className="lg:col-span-1">
                {show.poster_path && (
                  <div className="relative aspect-[2/3] rounded-2xl overflow-hidden shadow-2xl shadow-black/40 ring-1 ring-white/[0.06]">
                    <Image
                      src={getImageUrl(show.poster_path, 'w500')}
                      alt={show.name}
                      fill
                      sizes="(max-width: 1024px) 100vw, 33vw"
                      className="object-cover"
                    />
                  </div>
                )}
              </div>

              {/* Details */}
              <div className="lg:col-span-2 space-y-6">
                <div>
                  <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-foreground leading-[1.1]">
                    {show.name}
                    {firstAirYear && (
                      <span className="text-muted-foreground/60 font-normal ml-3 text-2xl lg:text-3xl">
                        ({firstAirYear})
                      </span>
                    )}
                  </h1>

                  {/* Meta row */}
                  <div className="flex flex-wrap items-center gap-4 mt-4">
                    {show.vote_average > 0 && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-accent/15 text-amber-accent text-sm font-semibold">
                        <Star className="h-3.5 w-3.5 fill-amber-accent" />
                        {show.vote_average.toFixed(1)}
                      </span>
                    )}

                    {show.first_air_date && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(show.first_air_date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    )}

                    {show.number_of_seasons && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Tv className="h-3.5 w-3.5" />
                        {show.number_of_seasons} Season{show.number_of_seasons !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  {/* Genres */}
                  {show.genres && show.genres.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4">
                      {show.genres.map((genre: any) => (
                        <Badge
                          key={genre.id}
                          variant="secondary"
                          className="bg-white/[0.04] border border-white/[0.06] text-muted-foreground hover:text-foreground transition-colors px-3 py-1 font-medium"
                        >
                          {genre.name}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Tagline */}
                  {show.tagline && (
                    <p className="text-base italic text-muted-foreground/70 leading-relaxed mt-4">
                      &quot;{show.tagline}&quot;
                    </p>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => router.push(`/watch/tv/${show.id}`)}
                    className="gap-2.5 px-6 py-3 h-auto rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm shadow-lg shadow-primary/20 transition-all"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    Watch Now
                  </Button>
                  <Button
                    onClick={() => router.push(`/download/nxsha/tv/${show.id}/1/1`)}
                    className="gap-2.5 px-5 py-3 h-auto rounded-full border border-primary/50 bg-transparent hover:bg-primary/10 text-primary font-semibold text-sm transition-all"
                  >
                    <Download className="w-4 h-4" />
                    Server 1 DL
                  </Button>
                  <Button
                    onClick={() => router.push(`/download/falix/tv/${show.id}`)}
                    className="gap-2.5 px-5 py-3 h-auto rounded-full border border-blue-500/50 bg-transparent hover:bg-blue-500/10 text-blue-500 font-semibold text-sm transition-all"
                  >
                    <CloudDownload className="w-4 h-4" />
                    Falix DL
                  </Button>
                  <SaveButton
                    movie={show}
                    size="lg"
                    className="border border-white/[0.08]"
                    showLabel
                  />
                </div>

                {/* Overview */}
                {show.overview && (
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground/60 mb-3">
                      Overview
                    </h2>
                    <p className="text-base text-foreground/80 leading-relaxed max-w-prose">
                      {show.overview}
                    </p>
                  </div>
                )}

                {/* Cast Carousel */}
                {show.credits?.cast?.length > 0 && (
                  <div className="pt-4">
                    <CastCarousel cast={show.credits.cast} />
                  </div>
                )}

                {/* Trailer */}
                {trailerKey && (
                  <div className="pt-4">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground/60">
                        Trailer
                      </h2>
                      <button
                        onClick={() => setTrailerOpen(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D4A237]/10 text-[#D4A237] hover:bg-[#D4A237]/20 text-xs font-semibold transition-all"
                        aria-label="Open trailer in modal"
                      >
                        <Youtube size={14} />
                        Fullscreen
                      </button>
                    </div>
                    <Suspense fallback={<VideoSkeleton />}>
                      <div className="rounded-2xl overflow-hidden ring-1 ring-white/[0.06] shadow-xl">
                        <VideoPlayer videoKey={trailerKey} title={show.name} />
                      </div>
                    </Suspense>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Similar Section ── */}
        {show.similar?.results && show.similar.results.length > 0 && (
          <div className="relative py-14">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
            <MediaCarousel
              title="Similar TV Shows"
              items={show.similar.results}
              mediaType="tv"
            />
          </div>
        )}
        {/* ── Trailer Modal ── */}
        <TrailerModal
          videoKey={trailerKey}
          open={trailerOpen}
          onClose={() => setTrailerOpen(false)}
        />
      </main>
    </div>
  );
}
