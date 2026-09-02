/**
 * ContinueWatching — home-page rail of in-progress titles.
 *
 * Visual parity with MediaCarousel/MovieCard: same Swiper chrome (header row,
 * edge fades, hover nav arrows, identical breakpoints) and the same poster-card
 * anatomy (hover overlay + pill button, under-poster progress bar, title/meta
 * lines). The one deliberate difference: each card deep-links straight to the
 * watch page with ?t=<seconds>&season=&episode= so clicking resumes playback
 * instead of visiting the detail page.
 */

"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Navigation, A11y } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import "swiper/css/navigation";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { getImageUrl, tmdbApi } from "@/lib/tmdb";
import type { WatchProgress } from "@filmsnaps/shared";

interface ContinueWatchingProps {
  entries: WatchProgress[];
}

/** Minimal TMDB fields the cards need. */
interface EntryMeta {
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  year: string;
}

const MAX_CARDS = 12;

export function ContinueWatching({ entries }: ContinueWatchingProps) {
  const router = useRouter();
  const [metaMap, setMetaMap] = useState<Record<string, EntryMeta>>({});

  const prevRef = useRef<HTMLButtonElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);

  // Fetch title + poster + year for each entry (deduped by mediaType:id,
  // capped at the same cards we render). Failures leave the placeholder.
  useEffect(() => {
    let cancelled = false;
    const visible = entries.slice(0, MAX_CARDS);
    for (const entry of visible) {
      const key = `${entry.mediaType}:${entry.tmdbId}`;
      if (metaMap[key]) continue;
      const fetchMeta =
        entry.mediaType === "tv"
          ? tmdbApi.getTVDetails(entry.tmdbId)
          : tmdbApi.getMovieDetails(entry.tmdbId);
      fetchMeta
        .then((m: any) => {
          if (cancelled || !m) return;
          const releaseDate = m.release_date || m.first_air_date;
          setMetaMap((prev) => ({
            ...prev,
            [key]: {
              title: m.name || m.title || "",
              posterPath: m.poster_path ?? null,
              backdropPath: m.backdrop_path ?? null,
              year: releaseDate
                ? String(new Date(releaseDate).getFullYear())
                : "",
            },
          }));
        })
        .catch(() => {
          /* meta is cosmetic — placeholder covers it */
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  // Refs aren't set when Swiper initializes → hand them over pre-init
  // (same pattern as MediaCarousel).
  const handleBeforeInit = useCallback((swiper: any) => {
    if (
      typeof swiper.params.navigation === "object" &&
      swiper.params.navigation !== null
    ) {
      swiper.params.navigation.prevEl = prevRef.current;
      swiper.params.navigation.nextEl = nextRef.current;
    }
  }, []);

  const slides = useMemo(
    () =>
      entries.slice(0, MAX_CARDS).map((entry, i) => {
        const key = `${entry.mediaType}:${entry.tmdbId}`;
        const meta = metaMap[key];
        const tParam = Math.floor(entry.currentTime);
        const href =
          entry.mediaType === "tv"
            ? `/watch?type=tv&id=${entry.tmdbId}&season=${entry.season ?? 1}&episode=${entry.episode ?? 1}&t=${tParam}`
            : `/watch?type=movie&id=${entry.tmdbId}&t=${tParam}`;
        const pct = Math.min(Math.round((entry.percent ?? 0) * 100), 100);
        const sub =
          entry.mediaType === "tv"
            ? `S${entry.season ?? "?"} E${entry.episode ?? "?"} · ${pct}%`
            : `${pct}% watched`;

        return (
          <SwiperSlide
            key={`${entry.tmdbId}-${entry.season ?? ""}-${entry.episode ?? ""}-${i}`}
            className="py-2"
          >
            <div className="group relative">
              {/* Thumbnail */}
              <Link
                prefetch
                href={href}
                onMouseEnter={() =>
                  router.prefetch(
                    entry.mediaType === "tv"
                      ? `/watch?type=tv&id=${entry.tmdbId}`
                      : `/watch?type=movie&id=${entry.tmdbId}`,
                  )
                }
                className="block"
              >
                <div className="relative aspect-video rounded-xl overflow-hidden bg-secondary border border-white/[0.06] shadow-lg transition-all duration-300 group-hover:shadow-xl group-hover:shadow-primary/10 group-hover:border-white/[0.12]">
                  {meta?.backdropPath || meta?.posterPath ? (
                    <Image
                      src={
                        getImageUrl(
                          meta?.backdropPath ?? meta?.posterPath ?? undefined,
                          "w780",
                        ) || ""
                      }
                      alt={meta?.title || "Poster"}
                      fill
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 30vw, 22vw"
                      loading="lazy"
                      quality={85}
                      className="object-cover transition-all duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full bg-gradient-to-br from-secondary to-background text-muted-foreground">
                      <Play className="w-8 h-8 opacity-40" />
                    </div>
                  )}

                  {/* Dark overlay */}
                  <div className="absolute inset-0 bg-black/30" />

                  {/* Central play button (always visible) */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-black/70 border border-white/20 flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-hover:bg-black/80">
                      <Play className="w-4.5 h-4.5 fill-[#E8BC4F] text-[#E8BC4F] ml-0.5" />
                    </div>
                  </div>

                  {/* TV episode pill badge */}
                  {entry.mediaType === "tv" &&
                    entry.season != null &&
                    entry.episode != null && (
                      <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/75 border border-white/10">
                        <span className="text-[10px] font-semibold text-[#E8BC4F]">
                          S{entry.season}:E{entry.episode}
                        </span>
                      </div>
                    )}

                  {/* Bottom progress bar (overlaid) */}
                  <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/25 rounded-b-xl overflow-hidden">
                    <div
                      className="h-full bg-[#E8BC4F]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              </Link>

              {/* Info below card */}
              <Link href={href} className="block mt-2 px-0.5">
                <h3 className="font-sans text-sm font-semibold text-foreground/90 line-clamp-1 group-hover:text-primary transition-colors duration-200">
                  {meta?.title ||
                    (entry.mediaType === "tv"
                      ? `S${entry.season ?? "?"} E${entry.episode ?? "?"}`
                      : "Untitled")}
                </h3>
                <p className="text-xs text-muted-foreground/60 mt-0.5">{sub}</p>
              </Link>
            </div>
          </SwiperSlide>
        );
      }),
    [entries, metaMap, router],
  );

  if (!entries || entries.length === 0) return null;

  return (
    <section className="relative group/row">
      {/* Title */}
      <div className="flex items-center justify-between px-5 sm:px-6 lg:px-8 mb-4">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
          Continue Watching
        </h2>
        <Link
          href="/history"
          className="text-[12px] font-semibold text-muted-foreground/60 hover:text-primary transition-colors duration-200"
        >
          See all →
        </Link>
      </div>

      <div className="group/carousel relative px-5 sm:px-6 lg:px-8">
        {/* Edge fade indicators */}
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none hidden sm:block" />
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none hidden sm:block" />

        {/* Navigation */}
        <button
          ref={prevRef}
          aria-label="Previous"
          className="hidden sm:flex absolute -left-1 top-1/2 -translate-y-1/2 z-20 w-11 h-11 items-center justify-center rounded-full glass-light text-white/50 hover:text-white hover:scale-105 transition-all duration-300 opacity-0 group-hover/carousel:opacity-100 shadow-lg"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <button
          ref={nextRef}
          aria-label="Next"
          className="hidden sm:flex absolute -right-1 top-1/2 -translate-y-1/2 z-20 w-11 h-11 items-center justify-center rounded-full glass-light text-white/50 hover:text-white hover:scale-105 transition-all duration-300 opacity-0 group-hover/carousel:opacity-100 shadow-lg"
        >
          <ChevronRight className="h-5 w-5" />
        </button>

        {/* Swiper — no autoplay: a resume rail must not scroll itself */}
        <Swiper
          modules={[Navigation, A11y]}
          grabCursor
          speed={700}
          navigation={{
            prevEl: prevRef.current,
            nextEl: nextRef.current,
          }}
          onBeforeInit={handleBeforeInit}
          spaceBetween={16}
          slidesPerView={1.3}
          breakpoints={{
            480: {
              slidesPerView: 1.6,
              spaceBetween: 16,
            },
            640: {
              slidesPerView: 2.2,
              spaceBetween: 18,
            },
            768: {
              slidesPerView: 2.8,
              spaceBetween: 20,
            },
            1024: {
              slidesPerView: 3.5,
              spaceBetween: 20,
            },
            1280: {
              slidesPerView: 4.2,
              spaceBetween: 22,
            },
          }}
          className="pb-8"
        >
          {slides}
        </Swiper>
      </div>
    </section>
  );
}
