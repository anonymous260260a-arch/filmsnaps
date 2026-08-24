"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Star, Calendar, Tv, ArrowLeft, Play, Youtube } from "lucide-react";
import { getImageUrl, getTrailerKey } from "@/lib/tmdb";
import dynamic from "next/dynamic";
import { MediaCarousel } from "@/components/MediaCarousel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import VideoSkeleton from "@/components/VideoSkeleton";
import { Suspense } from "react";
import { SaveButton } from "@/components/SaveButton";
import { useRouter, useSearchParams } from "next/navigation";
import DownloadBadge from "@/components/download/DownloadBadge";
import DownloadButton from "@/components/download/DownloadButton";
import { CastCarousel } from "@/components/CastCarousel";
import { TrailerModal } from "@/components/TrailerModal";
import { useResumeTarget } from "@/hooks/useResumeTarget";

const VideoPlayer = dynamic(
  () =>
    import("@/components/VideoPlayer").then((mod) => ({
      default: mod.VideoPlayer,
    })),
  { ssr: false, loading: () => <VideoSkeleton /> },
);

export default function TVClient({ show }: { show: any }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [trailerOpen, setTrailerOpen] = useState(false);
  const trailerKey = getTrailerKey(show.videos);
  // Resume-aware watch target: when the user has progress here, the primary
  // button relabels to "Resume" and carries the ?t= seek offset.
  const resume = useResumeTarget(String(show.id), "tv", `/watch/tv/${show.id}`);
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
                src={getImageUrl(show.backdrop_path, "original")}
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
              <Button
                variant="ghost"
                className="mb-6 gap-2 text-muted-foreground hover:text-foreground -ml-3"
              >
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
                      src={getImageUrl(show.poster_path, "w500")}
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
                        {new Date(show.first_air_date).toLocaleDateString(
                          "en-US",
                          {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          },
                        )}
                      </span>
                    )}

                    {show.number_of_seasons && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Tv className="h-3.5 w-3.5" />
                        {show.number_of_seasons} Season
                        {show.number_of_seasons !== 1 ? "s" : ""}
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
                    onClick={() => router.push(watchHref)}
                    className="group gap-2.5 px-7 py-3.5 h-auto rounded-full font-bold text-sm text-[#070708] bg-gradient-to-b from-[#E8BC4F] to-[#D4A237] shadow-[0_8px_24px_rgba(212,162,55,0.35)] hover:shadow-[0_10px_32px_rgba(212,162,55,0.5)] hover:brightness-[1.05] active:brightness-95 active:scale-[0.98] transition-all duration-200"
                  >
                    <Play className="w-5 h-5 fill-current" />
                    {resume.point ? "Resume" : "Watch Now"}
                  </Button>
                  <DownloadButton tmdbId={show.id} mediaType="tv" />
                  <DownloadBadge />
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
