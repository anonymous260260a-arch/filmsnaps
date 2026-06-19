'use client';

import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { Navigation, A11y, Autoplay } from 'swiper/modules';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MovieCard } from '@/components/MovieCard';

import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import 'swiper/css/navigation';

export function MediaCarousel({
  title,
  items,
  mediaType,
  compact = false,
}: {
  title: string;
  items: any[];
  mediaType: string;
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevRef = useRef<HTMLButtonElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const swiperRef = useRef<any>(null);
  const [isInView, setIsInView] = useState(false);

  if (!items?.length) return null;

  /* View-based autoplay */
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsInView(entry.isIntersecting),
      { threshold: 0.5 }
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!swiperRef.current?.autoplay) return;
    isInView
      ? swiperRef.current.autoplay.start()
      : swiperRef.current.autoplay.stop();
  }, [isInView]);

  const handleSwiperInit = useCallback((swiper: any) => {
    swiperRef.current = swiper;
  }, []);

  const handleBeforeInit = useCallback((swiper: any) => {
    if (
      typeof swiper.params.navigation === 'object' &&
      swiper.params.navigation !== null
    ) {
      swiper.params.navigation.prevEl = prevRef.current;
      swiper.params.navigation.nextEl = nextRef.current;
    }
  }, []);

  const memoizedItems = useMemo(
    () =>
      items.map((item) => (
        <SwiperSlide key={item.id} className="py-2">
          <MovieCard item={item} mediaType={mediaType} />
        </SwiperSlide>
      )),
    [items, mediaType]
  );

  return (
    <section ref={containerRef} className="relative">
      {/* Title */}
      <div className="flex items-center justify-between px-5 sm:px-6 lg:px-8 mb-4">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h2>
        <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/50">
          Explore
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
          className="hidden sm:flex absolute -left-1 top-1/2 -translate-y-1/2 z-20 w-11 h-11 items-center justify-center rounded-full glass-light text-white/50 hover:text-white hover:scale-105 transition-all duration-300 opacity-0 group-hover:opacity-100 shadow-lg"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <button
          ref={nextRef}
          aria-label="Next"
          className="hidden sm:flex absolute -right-1 top-1/2 -translate-y-1/2 z-20 w-11 h-11 items-center justify-center rounded-full glass-light text-white/50 hover:text-white hover:scale-105 transition-all duration-300 opacity-0 group-hover:opacity-100 shadow-lg"
        >
          <ChevronRight className="h-5 w-5" />
        </button>

        {/* Swiper */}
        <Swiper
          modules={[Navigation, A11y, Autoplay]}
          speed={700}
          autoplay={{
            delay: 4500,
            disableOnInteraction: false,
            pauseOnMouseEnter: true,
          }}
          navigation={{
            prevEl: prevRef.current,
            nextEl: nextRef.current,
          }}
          onSwiper={handleSwiperInit}
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
          {memoizedItems}
        </Swiper>
      </div>
    </section>
  );
}
