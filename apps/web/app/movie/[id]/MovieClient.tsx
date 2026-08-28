"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Star,
  Clock,
  ArrowLeft,
  Play,
  Youtube,
  ChevronDown,
} from "lucide-react";
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
  const [overviewOpen, setOverviewOpen] = useState(false);
  const trailerKey = getTrailerKey(movie.videos);
  const resume = useResumeTarget(
    String(movie.id),
    "movie",
    `/watch/movie/${movie.id}`,
  );
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
        {/* ════════════════════════════════════════════════════════════════
            PHONE HERO  (<sm only) — P0/P2: full-bleed backdrop, tight
            title block, single dominant Watch action, collapsible overview.
            Reference: Apple TV / Netflix mobile detail pages.
           ══════════════════════════════════════════════════════════════ */}
        <div className="sm:hidden">
          <div className="relative">
            {/* Full-bleed backdrop art */}
            <div className="relative w-full aspect-[3/4] max-h-[62vh] overflow-hidden">
              {(movie.backdrop_path || movie.poster_path) && (
                <Image
                  src={getImageUrl(
                    movie.backdrop_path ?? movie.poster_path ?? "",
                    "w1280",
                  )}
                  alt={movie.title}
                  fill
                  priority
                  quality={85}
                  sizes="100vw"
                  className="object-cover"
                />
              )}
              {/* Cinematic gradients: top for legibility of back button, bottom to merge into body */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#070708] via-[#070708]/10 to-black/40" />
              <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#070708] to-transparent" />

              <Link href="/" className="absolute top-3 left-3 z-10">
                <span className="flex items-center justify-center h-10 w-10 rounded-full bg-black/40 backdrop-blur-md ring-1 ring-white/10 active:scale-95 transition-transform">
                  <ArrowLeft className="h-5 w-5 text-white" />
                </span>
              </Link>

              <div className="absolute top-3 right-3 z-10">
                <SaveButton
                  movie={movie}
                  size="lg"
                  className="bg-black/40 backdrop-blur-md ring-1 ring-white/10"
                />
              </div>

              {/* Poster chip + title anchored to bottom of art */}
              <div className="absolute inset-x-0 bottom-0 px-4 pb-4 flex items-end gap-3">
                {movie.poster_path && (
                  <div className="relative w-20 aspect-[2/3] rounded-lg overflow-hidden shadow-2xl shadow-black/60 ring-1 ring-white/[0.12] flex-shrink-0">
                    <Image
                      src={getImageUrl(movie.poster_path ?? "", "w342")}
                      alt={movie.title}
                      fill
                      priority
                      className="object-cover"
                    />
                  </div>
                )}
                <div className="min-w-0 pb-0.5">
                  <h1
                    className="font-black tracking-tight text-foreground leading-[1.08] [text-wrap:balance]"
                    style={{ fontSize: "clamp(1.35rem, 6.5vw, 1.9rem)" }}
                  >
                    {movie.title}
                  </h1>
                  {releaseYear && (
                    <span className="text-muted-foreground/70 font-medium text-sm">
                      {releaseYear}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="px-4 pt-4 pb-2 space-y-4">
              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-2.5">
                {movie.vote_average > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-accent/15 text-amber-accent text-xs font-bold">
                    <Star className="h-3 w-3 fill-amber-accent" />
                    {movie.vote_average.toFixed(1)}
                  </span>
                )}
                {runtime && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {runtime}
                  </span>
                )}
                {movie.release_date && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(movie.release_date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                )}
              </div>

              {movie.genres && movie.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5 -mt-1">
                  {movie.genres.slice(0, 4).map((genre: any) => (
                    <Badge
                      key={genre.id}
                      variant="secondary"
                      className="bg-white/[0.04] border border-white/[0.06] text-muted-foreground px-2.5 py-0.5 text-[11px] font-medium"
                    >
                      {genre.name}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Primary action row — thumb-friendly, full width Watch button */}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  onClick={() => router.push(watchHref)}
                  className="flex-1 gap-2 h-12 rounded-full font-bold text-sm text-[#070708] bg-gradient-to-b from-[#E8BC4F] to-[#D4A237] shadow-[0_8px_24px_rgba(212,162,55,0.35)] active:scale-[0.98] active:brightness-95 transition-all duration-150"
                >
                  <Play className="w-5 h-5 fill-current" />
                  {resume.point ? "Resume" : "Watch Now"}
                </Button>
                <DownloadButton tmdbId={movie.id} mediaType="movie" />
              </div>
              <DownloadBadge />

              {/* Overview — collapsible so it doesn't dominate the fold */}
              {movie.overview && (
                <div className="pt-1">
                  <button
                    onClick={() => setOverviewOpen((v) => !v)}
                    className="flex items-center justify-between w-full text-left"
                    aria-expanded={overviewOpen}
                  >
                    <h2 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/60">
                      Overview
                    </h2>
                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground/60 transition-transform duration-200 ${overviewOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  <p
                    className={`text-sm text-foreground/80 leading-relaxed mt-2 ${overviewOpen ? "" : "line-clamp-3"}`}
                  >
                    {movie.overview}
                  </p>
                </div>
              )}

              {/* Cast Carousel */}
              {movie.credits?.cast?.length > 0 && (
                <div className="pt-1 -mx-4 px-4">
                  <CastCarousel cast={movie.credits.cast} />
                </div>
              )}

              {/* Trailer */}
              {trailerKey && (
                <div className="pt-1">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/60">
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
                    <div className="rounded-xl overflow-hidden ring-1 ring-white/[0.06] shadow-xl">
                      <VideoPlayer videoKey={trailerKey} title={movie.title} />
                    </div>
                  </Suspense>
                </div>
              )}
            </div>
          </div>

          {/* Similar Section (phone) */}
          {movie.similar?.results?.length > 0 && (
            <div className="relative py-8">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
              <MediaCarousel
                title="Similar Movies"
                items={movie.similar.results}
                mediaType="movie"
              />
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════════════
            DESKTOP / WEB-TABLET (sm: and up) — UNCHANGED from prior design
           ══════════════════════════════════════════════════════════════ */}
        <div className="hidden sm:block">
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
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
              <MediaCarousel
                title="Similar Movies"
                items={movie.similar.results}
                mediaType="movie"
              />
            </div>
          )}
        </div>

        <TrailerModal
          videoKey={trailerKey}
          open={trailerOpen}
          onClose={() => setTrailerOpen(false)}
        />
      </main>
    </div>
  );
}
