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
            ? `/watch/tv/${entry.tmdbId}?season=${entry.season ?? 1}&episode=${entry.episode ?? 1}&t=${tParam}`
            : `/watch/movie/${entry.tmdbId}?t=${tParam}`;
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
              {/* Poster */}
              <Link
                prefetch
                href={href}
                onMouseEnter={() =>
                  router.prefetch(
                    entry.mediaType === "tv"
                      ? `/watch/tv/${entry.tmdbId}`
                      : `/watch/movie/${entry.tmdbId}`,
                  )
                }
                className="block"
              >
                <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-secondary shadow-lg transition-all duration-500 group-hover:shadow-2xl group-hover:shadow-primary/5">
                  {meta?.posterPath ? (
                    <Image
                      src={getImageUrl(meta.posterPath, "w500") || ""}
                      alt={meta.title || "Poster"}
                      fill
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, (max-width: 1280px) 20vw, 16vw"
                      loading="lazy"
                      quality={85}
                      className="object-cover transition-all duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full bg-gradient-to-br from-secondary to-background text-muted-foreground">
                      <Play className="w-8 h-8 opacity-40" />
                    </div>
                  )}

                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                  {/* Hover action */}
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0">
                    <span className="flex items-center gap-2 px-5 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white text-sm font-medium hover:bg-white/20 transition-all">
                      <Play className="w-4 h-4 fill-current" />
                      Resume
                    </span>
                  </div>
                </div>
              </Link>

              {/* Progress bar under poster (MovieCard anatomy) */}
              <div className="mt-1.5 h-1 w-full max-w-[92%] rounded-full overflow-hidden bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-[#5B9CF6]"
                  style={{ width: `${pct}%` }}
                />
              </div>

              {/* Info below card */}
              <Link href={href} className="block mt-2.5 space-y-0.5 px-0.5">
                <h3 className="text-sm font-semibold text-foreground/90 line-clamp-1 group-hover:text-primary transition-colors duration-200">
                  {meta?.title ||
                    (entry.mediaType === "tv"
                      ? `S${entry.season ?? "?"} E${entry.episode ?? "?"}`
                      : "Untitled")}
                </h3>
                <p className="text-xs text-muted-foreground/70">{sub}</p>
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
        <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/50">
          History
        </span>
      </div>

      <div className="relative px-5 sm:px-6 lg:px-8">
        {/* Edge fade indicators */}
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none hidden sm:block" />
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none hidden sm:block" />

        {/* Navigation */}
        <button
          ref={prevRef}
          aria-label="Previous"
          className="hidden sm:flex absolute -left-1 top-1/2 -translate-y-1/2 z-20 w-11 h-11 items-center justify-center rounded-full glass-light text-white/50 hover:text-white hover:scale-105 transition-all duration-300 opacity-0 group-hover/row:opacity-100 shadow-lg"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <button
          ref={nextRef}
          aria-label="Next"
          className="hidden sm:flex absolute -right-1 top-1/2 -translate-y-1/2 z-20 w-11 h-11 items-center justify-center rounded-full glass-light text-white/50 hover:text-white hover:scale-105 transition-all duration-300 opacity-0 group-hover/row:opacity-100 shadow-lg"
        >
          <ChevronRight className="h-5 w-5" />
        </button>

        {/* Swiper — no autoplay: a resume rail must not scroll itself */}
        <Swiper
          modules={[Navigation, A11y]}
          speed={700}
          navigation={{
            prevEl: prevRef.current,
            nextEl: nextRef.current,
          }}
          onBeforeInit={handleBeforeInit}
          spaceBetween={24}
          slidesPerView={1.5}
          breakpoints={{
            480: {
              slidesPerView: 1.8,
              spaceBetween: 24,
            },
            640: {
              slidesPerView: 2.5,
              spaceBetween: 20,
            },
            768: {
              slidesPerView: 3.5,
              spaceBetween: 24,
            },
            1024: {
              slidesPerView: 5,
              spaceBetween: 20,
            },
            1280: {
              slidesPerView: 6,
              spaceBetween: 20,
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
