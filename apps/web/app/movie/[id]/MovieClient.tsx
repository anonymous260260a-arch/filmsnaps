"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Star, Clock, ArrowLeft, Play, Youtube } from "lucide-react";
import { getImageUrl, getTrailerKey } from "@/lib/tmdb";
import dynamic from "next/dynamic";
import { MediaCarousel } from "@/components/MediaCarousel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SaveButton } from "@/components/SaveButton";
import { useResumeTarget } from "@/hooks/useResumeTarget";
import { Suspense } from "react";
import VideoSkeleton from "@/components/VideoSkeleton";
import { useRouter, useSearchParams } from "next/navigation";

const VideoPlayer = dynamic(
  () => import("@/components/VideoPlayer").then((m) => m.VideoPlayer),
  {
    ssr: false,
    loading: () => (
      <div className="w-full aspect-video bg-black/20 rounded-2xl animate-pulse" />
    ),
  },
);

import { CastCarousel } from "@/components/CastCarousel";
import { TrailerModal } from "@/components/TrailerModal";
import DownloadBadge from "@/components/download/DownloadBadge";
import DownloadButton from "@/components/download/DownloadButton";

export default function MovieClient({ movie }: { movie: any }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [trailerOpen, setTrailerOpen] = useState(false);
  const trailerKey = getTrailerKey(movie.videos);
  // Resume-aware watch target: when the user has progress here, the primary
  // button relabels to "Resume" and carries the ?t= seek offset.
  const resume = useResumeTarget(
    String(movie.id),
    "movie",
    `/watch/movie/${movie.id}`,
  );
  // Anime identity passthrough (TMDB spine): arrivals from anime search carry
  // ?mid=<mal>&aid=<anilist>; thread them into the watch href so the watch
  // session stays anime-profiled (defaults to MegaPlay).
  const mid = searchParams.get("mid");
  const aid = searchParams.get("aid");
  const animeQs = [mid ? `mid=${mid}` : "", aid ? `aid=${aid}` : ""]
    .filter(Boolean)
    .join("&");
  const watchHref =
    !animeQs || resume.href.includes("mid=")
      ? resume.href
      : `${resume.href}${resume.href.includes("?") ? "&" : "?"}${animeQs}`;
  const runtime = movie.runtime
    ? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m`
    : null;

  const releaseYear = movie.release_date
    ? new Date(movie.release_date).getFullYear()
    : null;

  return (
    <div className="min-h-screen bg-background">
      <main className="pt-16">
        {/* ── Backdrop Hero ── */}
        <div className="relative">
          {movie.backdrop_path && (
            <div className="absolute inset-0 h-[60vh]">
              <Image
                src={getImageUrl(movie.backdrop_path ?? "", "w1280")}
                alt={movie.title}
                fill
                priority
                quality={85}
                sizes="100vw"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent" />
              <div className="absolute inset-0 gradient-overlay" />
            </div>
          )}

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            <Link href="/">
              <Button
                variant="ghost"
                className="mb-6 gap-2 text-muted-foreground hover:text-foreground -ml-3"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Home
              </Button>
            </Link>

            <div className="grid lg:grid-cols-3 gap-8 lg:gap-12">
              {/* Poster */}
              <div className="lg:col-span-1">
                {movie.poster_path && (
                  <div className="relative aspect-[2/3] rounded-2xl overflow-hidden shadow-2xl shadow-black/40 ring-1 ring-white/[0.06]">
                    <Image
                      src={getImageUrl(movie.poster_path ?? "", "w500")}
                      alt={movie.title}
                      fill
                      priority
                      className="object-cover"
                    />
                  </div>
                )}
              </div>

              {/* Details */}
              <div className="lg:col-span-2 space-y-6">
                {/* Title & actions row */}
                <div>
                  <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-foreground leading-[1.1]">
                    {movie.title}
                    {releaseYear && (
                      <span className="text-muted-foreground/60 font-normal ml-3 text-2xl lg:text-3xl">
                        ({releaseYear})
                      </span>
                    )}
                  </h1>

                  {/* Meta row */}
                  <div className="flex flex-wrap items-center gap-3 mt-4">
                    {movie.vote_average > 0 && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-accent/15 text-amber-accent text-sm font-semibold">
                        <Star className="h-3.5 w-3.5 fill-amber-accent" />
                        {movie.vote_average.toFixed(1)}
                      </span>
                    )}

                    {runtime && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {runtime}
                      </span>
                    )}

                    {movie.release_date && (
                      <span className="text-sm text-muted-foreground">
                        {new Date(movie.release_date).toLocaleDateString(
                          "en-US",
                          {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          },
                        )}
                      </span>
                    )}
                  </div>

                  {/* Genres */}
                  {movie.genres && movie.genres.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4">
                      {movie.genres.map((genre: any) => (
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
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => router.push(watchHref)}
                    className="group gap-2.5 px-7 py-3.5 h-auto rounded-full font-bold text-sm text-[#070708] bg-gradient-to-b from-[#E8BC4F] to-[#D4A237] shadow-[0_8px_24px_rgba(212,162,55,0.35)] hover:shadow-[0_10px_32px_rgba(212,162,55,0.5)] hover:brightness-[1.05] active:brightness-95 active:scale-[0.98] transition-all duration-200"
                  >
                    <Play className="w-5 h-5 fill-current" />
                    {resume.point ? "Resume" : "Watch Now"}
                  </Button>
                  <DownloadButton tmdbId={movie.id} mediaType="movie" />
                  <DownloadBadge />
                  <SaveButton
                    movie={movie}
                    size="lg"
                    className="border border-white/[0.08]"
                    showLabel
                  />
                </div>

                {/* Overview */}
                {movie.overview && (
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground/60 mb-3">
                      Overview
                    </h2>
                    <p className="text-base text-foreground/80 leading-relaxed max-w-prose">
                      {movie.overview}
                    </p>
                  </div>
                )}

                {/* Cast Carousel */}
                {movie.credits?.cast?.length > 0 && (
                  <div className="pt-4">
                    <CastCarousel cast={movie.credits.cast} />
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
                        <VideoPlayer
                          videoKey={trailerKey}
                          title={movie.title}
                        />
                      </div>
                    </Suspense>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Similar Section ── */}
        {movie.similar?.results?.length > 0 && (
          <div className="relative py-14">
            {/* Section Divider */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
            <MediaCarousel
              title="Similar Movies"
              items={movie.similar.results}
              mediaType="movie"
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
