"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Star,
  Calendar,
  Tv,
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
import { useQueryClient } from "@tanstack/react-query";
import { Suspense } from "react";
import { SkeletonPlayer } from "@/components/SkeletonLoader";
import { useRouter, useSearchParams } from "next/navigation";
import DownloadBadge from "@/components/download/DownloadBadge";
import DownloadButton from "@/components/download/DownloadButton";
import { CastCarousel } from "@/components/CastCarousel";
import { TrailerModal } from "@/components/TrailerModal";

const VideoPlayer = dynamic(
  () =>
    import("@/components/VideoPlayer").then((mod) => ({
      default: mod.VideoPlayer,
    })),
  { ssr: false, loading: () => <SkeletonPlayer /> },
);

export default function TVDetailClient({ show }: { show: any }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const trailerKey = getTrailerKey(show.videos);
  const resume = useResumeTarget(
    String(show.id),
    "tv",
    `/watch?type=tv&id=${show.id}`,
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
  const firstAirYear = show.first_air_date
    ? new Date(show.first_air_date).getFullYear()
    : null;

  // Prefetch watch page data on hover — warms the cache before navigation
  const handleWatchPrefetch = () => {
    queryClient.prefetchQuery({
      queryKey: ["tv", show.id],
      queryFn: () =>
        import("@/lib/tmdb").then((m) => m.tmdbApi.getTVDetails(show.id)),
      staleTime: 1000 * 60 * 60 * 24 * 7,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="pt-16">
        {/* ════════════════════════════════════════════════════════════════
            PHONE HERO  (<sm only)
           ══════════════════════════════════════════════════════════════ */}
        <div className="sm:hidden">
          <div className="relative">
            <div className="relative w-full aspect-[3/4] max-h-[62vh] overflow-hidden">
              {(show.backdrop_path || show.poster_path) && (
                <Image
                  src={getImageUrl(
                    show.backdrop_path ?? show.poster_path ?? "",
                    "w1280",
                  )}
                  alt={show.name}
                  fill
                  priority
                  quality={85}
                  sizes="100vw"
                  className="object-cover"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#070708] via-[#070708]/10 to-black/40" />
              <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#070708] to-transparent" />

              <Link href="/" className="absolute top-3 left-3 z-10">
                <span className="flex items-center justify-center h-10 w-10 rounded-full bg-black/40 backdrop-blur-md ring-1 ring-white/10 active:scale-95 transition-transform">
                  <ArrowLeft className="h-5 w-5 text-white" />
                </span>
              </Link>

              <div className="absolute top-3 right-3 z-10">
                <SaveButton
                  movie={show}
                  size="lg"
                  className="bg-black/40 backdrop-blur-md ring-1 ring-white/10"
                />
              </div>

              <div className="absolute inset-x-0 bottom-0 px-4 pb-4 flex items-end gap-3">
                {show.poster_path && (
                  <div className="relative w-20 aspect-[2/3] rounded-lg overflow-hidden shadow-2xl shadow-black/60 ring-1 ring-white/[0.12] flex-shrink-0">
                    <Image
                      src={getImageUrl(show.poster_path ?? "", "w342")}
                      alt={show.name}
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
                    {show.name}
                  </h1>
                  {firstAirYear && (
                    <span className="text-muted-foreground/70 font-medium text-sm">
                      {firstAirYear}
                    </span>
                  )}
                  {show.tagline && (
                    <p className="text-xs italic text-muted-foreground/70 mt-0.5 line-clamp-1">
                      {show.tagline}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="px-4 pt-4 pb-2 space-y-4">
              <div className="flex flex-wrap items-center gap-2.5">
                {show.vote_average > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-accent/15 text-amber-accent text-xs font-bold">
                    <Star className="h-3 w-3 fill-amber-accent" />
                    {show.vote_average.toFixed(1)}
                  </span>
                )}
                {show.first_air_date && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {new Date(show.first_air_date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                )}
                {show.number_of_seasons && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Tv className="h-3 w-3" />
                    {show.number_of_seasons} Season
                    {show.number_of_seasons !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {show.genres && show.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5 -mt-1">
                  {show.genres.slice(0, 4).map((genre: any) => (
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

              <div className="flex items-center gap-2 pt-1">
                <Button
                  onClick={() => router.push(watchHref)}
                  onMouseEnter={handleWatchPrefetch}
                  onFocus={handleWatchPrefetch}
                  className="flex-1 gap-2 h-12 rounded-full font-bold text-sm text-[#070708] bg-gradient-to-b from-[#E8BC4F] to-[#D4A237] shadow-[0_8px_24px_rgba(212,162,55,0.35)] active:scale-[0.98] active:brightness-95 transition-all duration-150"
                >
                  <Play className="w-5 h-5 fill-current" />
                  {resume.point ? "Resume" : "Watch Now"}
                </Button>
                <DownloadButton tmdbId={show.id} mediaType="tv" />
              </div>
              <DownloadBadge />

              {show.overview && (
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
                    {show.overview}
                  </p>
                </div>
              )}

              {show.credits?.cast?.length > 0 && (
                <div className="pt-1 -mx-4 px-4">
                  <CastCarousel cast={show.credits.cast} />
                </div>
              )}

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
                  <Suspense fallback={<SkeletonPlayer />}>
                    <div className="rounded-xl overflow-hidden ring-1 ring-white/[0.06] shadow-xl">
                      <VideoPlayer videoKey={trailerKey} title={show.name} />
                    </div>
                  </Suspense>
                </div>
              )}
            </div>
          </div>

          {show.similar?.results && show.similar.results.length > 0 && (
            <div className="relative py-8">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
              <MediaCarousel
                title="Similar TV Shows"
                items={show.similar.results}
                mediaType="tv"
              />
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════════════
            DESKTOP / WEB-TABLET (sm: and up)
           ══════════════════════════════════════════════════════════════ */}
        <div className="hidden sm:block">
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

                    {show.tagline && (
                      <p className="text-base italic text-muted-foreground/70 leading-relaxed mt-4">
                        &quot;{show.tagline}&quot;
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={() => router.push(watchHref)}
                      onMouseEnter={handleWatchPrefetch}
                      onFocus={handleWatchPrefetch}
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

                  {show.credits?.cast?.length > 0 && (
                    <div className="pt-4">
                      <CastCarousel cast={show.credits.cast} />
                    </div>
                  )}

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
                      <Suspense fallback={<SkeletonPlayer />}>
                        <div className="rounded-2xl overflow-hidden ring-1 ring-white/[0.06] shadow-xl">
                          <VideoPlayer
                            videoKey={trailerKey}
                            title={show.name}
                          />
                        </div>
                      </Suspense>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

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
