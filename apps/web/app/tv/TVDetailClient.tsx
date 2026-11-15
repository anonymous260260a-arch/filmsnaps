"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Star,
  Calendar,
  Tv,
  ArrowLeft,
  ChevronLeft,
  Film,
  Play,
  Share2,
  Youtube,
} from "lucide-react";
import { getImageUrl, getTrailerKey } from "@/lib/tmdb";
import { MediaCarousel } from "@/components/MediaCarousel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SaveButton } from "@/components/SaveButton";
import { useResumeTarget } from "@/hooks/useResumeTarget";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { warmMpv } from "@/lib/mpvWarm";
import { useToast } from "@/hooks/use-toast";
import { prefetchDirectMedia } from "@/lib/directPrefetch";
import { pickMoreLikeThis } from "@/lib/moreLikeThis";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import DownloadBadge from "@/components/download/DownloadBadge";
import DownloadButton from "@/components/download/DownloadButton";
import { CastCarousel } from "@/components/CastCarousel";
import { TrailerModal } from "@/components/TrailerModal";
import { DetailEpisodes } from "@/components/detail/DetailEpisodes";
import { LazyTrailer } from "@/components/LazyTrailer";

export default function TVDetailClient({ show }: { show: any }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const trailerKey = getTrailerKey(show.videos);
  // More Like This: TMDB's /recommendations engine (site-quality) with
  // /similar fallback — same policy as mobile detail pages.
  const moreLikeThis = pickMoreLikeThis(show);
  // ≥sm (640) matches where the desktop variant takes over visually. The
  // episodes section mounts exactly ONCE (phone flow below sm, desktop flow
  // at sm+) — two simultaneous mounts trip the shared watch-history cache
  // into an infinite update loop (Maximum update depth exceeded).
  const isSmDesktop = useIsDesktop(640);
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

  // App-parity CTA copy: Watch Again / Resume S# E# / Play S1 E1.
  const ctaLabel = resume.point
    ? resume.point.percent >= 0.95
      ? "Watch Again"
      : `Resume S${resume.point.season ?? 1} E${resume.point.episode ?? 1}`
    : "Play S1 E1";

  const handleBack = () => {
    if (window.history.state?.idx) router.back();
    else router.push("/");
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: show.name, url });
      } catch {
        /* user dismissed the share sheet */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied" });
    } catch {
      /* clipboard unavailable */
    }
  };

  // Prefetch watch page data on hover — warms the cache before navigation
  const handleWatchPrefetch = () => {
    queryClient.prefetchQuery({
      queryKey: ["tv", show.id],
      queryFn: () =>
        import("@/lib/tmdb").then((m) => m.tmdbApi.getTVDetails(show.id)),
      staleTime: 1000 * 60 * 60 * 24 * 7,
    });
    prefetchDirectMedia(
      "tv",
      String(show.id),
      resume.point?.season ?? 1,
      resume.point?.episode ?? 1,
      Boolean(mid || aid),
    );
  };

  // ── Detail-page prefetch (mobile parity) ──
  // Prewarms the RESUME episode (that's what the user will actually play).
  // The resume point resolves async from history — wait briefly for it so TV
  // prefetches the right episode, falling back to S1E1 when there's none.
  const directPrefetchedRef = useRef(false);
  useEffect(() => {
    if (directPrefetchedRef.current) return;
    const timer = setTimeout(() => {
      directPrefetchedRef.current = true;
      prefetchDirectMedia(
        "tv",
        String(show.id),
        resume.point?.season ?? 1,
        resume.point?.episode ?? 1,
        Boolean(mid || aid),
      );
    }, 600);
    return () => clearTimeout(timer);
  }, [show.id, resume.point?.season, resume.point?.episode]);

  // Desktop: warm the mpv pipeline on mount (no resume wait needed — the
  // warm spawns an idle process; loadfile comes later with whatever episode
  // the user picks). With the chain prefetch delivering metadata instantly,
  // the 1-3s mpv spawn is the last cold cost on the play path.
  useEffect(() => {
    warmMpv();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <main className="detail-top pt-16">
        {/* ════════════════════════════════════════════════════════════════
            PHONE HERO  (<sm only) — mobile-app detail parity: short
            backdrop + glass nav, poster/info row, gold CTA + Trailer/
            Download row, Read more overview, season/episode list.
           ══════════════════════════════════════════════════════════════ */}
        <div className="sm:hidden">
          <div className="relative">
            {/* Backdrop — app parity: min(42vh, 350px), permanent fade
                into the page background */}
            <div className="relative w-full h-[42vh] max-h-[350px] overflow-hidden bg-subtle">
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
              <div className="absolute inset-x-0 bottom-0 h-[70%] bg-gradient-to-t from-background via-background/55 to-transparent" />

              {/* Floating glass nav — back / bookmark / share */}
              <div className="absolute inset-x-4 top-4 z-20 flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleBack}
                  aria-label="Go back"
                  className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-white/[0.15] bg-surface/75 text-foreground backdrop-blur-md transition active:scale-95"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="flex items-center gap-2.5">
                  <SaveButton
                    movie={show}
                    showLabel={false}
                    className="h-[38px] w-[38px] rounded-full border border-white/[0.15] p-0 backdrop-blur-md"
                  />
                  <button
                    type="button"
                    onClick={handleShare}
                    aria-label="Share"
                    className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-white/[0.15] bg-surface/75 text-foreground backdrop-blur-md transition active:scale-95"
                  >
                    <Share2 className="h-[18px] w-[18px]" />
                  </button>
                </div>
              </div>
            </div>

            {/* Content — poster overlaps the backdrop by 52px (app parity) */}
            <div className="relative z-10 -mt-[52px] px-4">
              <div className="flex items-center">
                {show.poster_path ? (
                  <div className="relative h-[156px] w-[104px] shrink-0 overflow-hidden rounded-xl border border-white/[0.06] shadow-[0_8px_28px_rgba(0,0,0,0.55)]">
                    <Image
                      src={getImageUrl(show.poster_path ?? "", "w342")}
                      alt={show.name}
                      fill
                      priority
                      sizes="104px"
                      className="object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex h-[156px] w-[104px] shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-subtle">
                    <Film className="h-7 w-7 text-faint" />
                  </div>
                )}

                <div className="ml-[18px] min-w-0 flex-1 self-center">
                  <h1 className="mb-1.5 line-clamp-2 text-lg font-semibold leading-[22px] text-foreground">
                    {show.name}
                  </h1>
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    {show.vote_average > 0 && (
                      <span className="rounded-md border border-primary/30 bg-primary/15 px-[7px] py-0.5 text-[11px] font-semibold text-primary">
                        ★ {show.vote_average.toFixed(1)}
                      </span>
                    )}
                    {firstAirYear && (
                      <span className="rounded-md bg-white/[0.08] px-[7px] py-0.5 text-[11px] font-medium text-muted-foreground">
                        {firstAirYear}
                      </span>
                    )}
                    {show.number_of_seasons > 0 && (
                      <span className="inline-flex items-center gap-[3px] rounded-md bg-white/[0.08] px-[7px] py-0.5 text-[11px] font-medium text-muted-foreground">
                        <Tv className="h-3 w-3 text-faint" />
                        {show.number_of_seasons} Season
                        {show.number_of_seasons !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  {show.genres && show.genres.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {show.genres.slice(0, 3).map((genre: any) => (
                        <span
                          key={genre.id}
                          className="rounded-md border border-white/[0.06] bg-subtle px-[7px] py-0.5 text-[10px] font-medium text-muted-foreground"
                        >
                          {genre.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Actions — primary CTA + Trailer / Download row */}
              <div className="mt-[18px]">
                <Button
                  onClick={() => router.push(watchHref)}
                  onMouseEnter={handleWatchPrefetch}
                  onFocus={handleWatchPrefetch}
                  className="w-full gap-2 h-auto py-3.5 rounded-xl font-semibold text-[15px] text-background bg-gradient-to-b from-primary-bright to-primary shadow-[0_8px_24px_rgba(212,162,55,0.35)] active:scale-[0.98] active:brightness-95 transition-all duration-150"
                >
                  <Play className="h-[18px] w-[18px] fill-current" />
                  {ctaLabel}
                </Button>
                <div className="mt-3 flex items-center gap-2.5">
                  {trailerKey && (
                    <button
                      type="button"
                      onClick={() => setTrailerOpen(true)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/[0.06] bg-surface/80 py-[11px] text-[13px] font-medium text-foreground transition active:scale-[0.98]"
                    >
                      <Youtube size={16} className="text-destructive" />
                      Trailer
                    </button>
                  )}
                  <DownloadButton
                    tmdbId={show.id}
                    mediaType="tv"
                    wrapperClassName="flex-1"
                    buttonClassName="w-full justify-center rounded-xl border-white/[0.06] bg-surface/80 py-[11px] text-[13px] font-medium"
                  />
                </div>
                <div className="mt-3 empty:hidden">
                  <DownloadBadge />
                </div>
              </div>

              {/* Overview */}
              {show.overview && (
                <div className="mt-6">
                  <h2 className="mb-2 text-[15px] font-semibold text-foreground">
                    Overview
                  </h2>
                  <p
                    className={`text-sm leading-[21px] text-muted-foreground ${overviewOpen ? "" : "line-clamp-3"}`}
                  >
                    {show.overview}
                  </p>
                  {show.overview.length > 120 && (
                    <button
                      type="button"
                      onClick={() => setOverviewOpen((v) => !v)}
                      aria-expanded={overviewOpen}
                      className="mt-1 text-xs font-medium text-primary"
                    >
                      {overviewOpen ? "Show less" : "Read more"}
                    </button>
                  )}
                </div>
              )}

              {/* Episodes — season pills + list (SeasonPicker parity).
                  Mounted only below sm: the desktop variant renders its own
                  single instance (mounting both trips the shared watch-history
                  cache into an update loop). */}
              {!isSmDesktop && (
                <DetailEpisodes
                  tmdbId={show.id}
                  seasons={show.seasons ?? []}
                  initialSeason={resume.point?.season ?? null}
                  extraQuery={animeQs}
                />
              )}

              {/* Cast */}
              {show.credits?.cast?.length > 0 && (
                <div className="mt-6 -mx-4 px-4">
                  <CastCarousel cast={show.credits.cast} />
                </div>
              )}
            </div>
          </div>

          {moreLikeThis && (moreLikeThis.results?.length ?? 0) > 0 && (
            <div className="relative py-8">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
              <MediaCarousel
                title="More Like This"
                items={moreLikeThis.results as any}
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
                      className="group gap-2.5 px-7 py-3.5 h-auto rounded-full font-bold text-sm text-background bg-gradient-to-b from-primary-bright to-primary shadow-[0_8px_24px_rgba(212,162,55,0.35)] hover:shadow-[0_10px_32px_rgba(212,162,55,0.5)] hover:brightness-[1.05] active:brightness-95 active:scale-[0.98] transition-all duration-200"
                    >
                      <Play className="w-5 h-5 fill-current" />
                      {ctaLabel}
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

                  {/* Episodes — season pills + list (mobile SeasonPicker
                      parity). Same slot as the mobile app: right after the
                      overview, before the cast. Mounted only at sm+; the
                      phone variant renders its own single instance below. */}
                  {isSmDesktop && (
                    <div className="pt-4">
                      <DetailEpisodes
                        tmdbId={show.id}
                        seasons={show.seasons ?? []}
                        initialSeason={resume.point?.season ?? null}
                        extraQuery={animeQs}
                      />
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
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-semibold transition-all"
                          aria-label="Open trailer in modal"
                        >
                          <Youtube size={14} />
                          Fullscreen
                        </button>
                      </div>
                      <LazyTrailer videoKey={trailerKey} title={show.name} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {moreLikeThis && (moreLikeThis.results?.length ?? 0) > 0 && (
            <div className="relative py-14">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
              <MediaCarousel
                title="More Like This"
                items={moreLikeThis.results as any}
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
