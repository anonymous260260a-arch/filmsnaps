'use client';

import { useState, useEffect, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useInView } from 'react-intersection-observer';
import { Header } from '@/components/Header';
import { MediaGrid } from '@/components/MediaGrid';
import { ChevronUp, Filter } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { GlassButton } from '@/components/ui/glass-button';

import { MediaFilter } from '@/components/MediaFilter';

interface MoviesClientProps {
  initialData: any;
  genres: any[];
  initialFilters: {
    genreIds?: number[];
    sortBy?: string;
    yearRange?: [number, number];
    ratingRange?: [number, number];
    language?: string;
  };
}

export default function MoviesClient({
  initialData,
  initialFilters,
  genres,
}: MoviesClientProps) {
  const getInitialFilters = () => {
    if (typeof window === 'undefined') return initialFilters;

    const stored = localStorage.getItem('movieFilters');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        return initialFilters;
      }
    }
    return initialFilters;
  };

  const [selectedGenres, setSelectedGenres] = useState<number[]>(
    getInitialFilters().genreIds || []
  );
  const [sortBy, setSortBy] = useState<string>(
    getInitialFilters().sortBy || 'popularity.desc'
  );
  const [yearRange, setYearRange] = useState<[number, number]>(
    getInitialFilters().yearRange || [1900, new Date().getFullYear()]
  );
  const [ratingRange, setRatingRange] = useState<[number, number]>(
    getInitialFilters().ratingRange || [0, 10]
  );
  const [language, setLanguage] = useState<string>(
    getInitialFilters().language || ''
  );
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { toast } = useToast();
  const { ref, inView } = useInView();

  const queryKey = useMemo(
    () => ['movies', selectedGenres, sortBy, yearRange, ratingRange, language],
    [selectedGenres, sortBy, yearRange, ratingRange, language]
  );

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    useInfiniteQuery<any, Error>({
      queryKey,
      queryFn: async ({ pageParam }) => {
        const params = new URLSearchParams();
        params.set('page', (pageParam as number).toString());
        params.set('sortBy', sortBy);
        params.set('yearStart', yearRange[0].toString());
        params.set('yearEnd', yearRange[1].toString());
        params.set('minRating', ratingRange[0].toString());
        params.set('maxRating', ratingRange[1].toString());
        if (selectedGenres.length)
          params.set('genres', selectedGenres.join(','));
        if (language) params.set('language', language);

        const res = await fetch(`/api/movies?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch movies');
        return res.json();
      },
      getNextPageParam: (lastPage) =>
        lastPage.page < lastPage.total_pages ? lastPage.page + 1 : undefined,
      initialPageParam: 1,
      initialData: { pages: [initialData], pageParams: [1] },
      staleTime: 10 * 60 * 1000,
    });

  const movies = useMemo(
    () => data?.pages.flatMap((p) => p.results) ?? [],
    [data]
  );

  useEffect(() => {
    const filters = {
      genreIds: selectedGenres,
      sortBy,
      yearRange,
      ratingRange,
      language,
    };
    localStorage.setItem('movieFilters', JSON.stringify(filters));
  }, [selectedGenres, sortBy, yearRange, ratingRange, language]);

  useEffect(() => {
    if (inView && hasNextPage) fetchNextPage();
  }, [inView, hasNextPage, fetchNextPage]);

  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  const handleGenreToggle = (genreId: number) => {
    setSelectedGenres((prev) =>
      prev.includes(genreId)
        ? prev.filter((id) => id !== genreId)
        : [...prev, genreId]
    );
  };

  const resetFilters = () => {
    const defaultFilters = {
      genreIds: [] as number[],
      sortBy: 'popularity.desc',
      yearRange: [1900, new Date().getFullYear()] as [number, number],
      ratingRange: [0, 10] as [number, number],
      language: '',
    };

    setSelectedGenres(defaultFilters.genreIds);
    setSortBy(defaultFilters.sortBy);
    setYearRange(defaultFilters.yearRange);
    setRatingRange(defaultFilters.ratingRange);
    setLanguage(defaultFilters.language);

    localStorage.removeItem('movieFilters');

    toast({ title: 'Filters reset', description: 'All filters cleared' });
    refetch();
  };

  const applyFilters = () => {
    refetch();
    setDrawerOpen(false);
    toast({ title: 'Filters applied', description: 'Movie list updated' });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="pt-24 px-4 sm:px-6 md:px-12 space-y-10">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight">Movies</h1>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Explore the cinematic universe
            </p>
          </div>

          <MediaFilter
            genres={genres}
            selectedGenres={selectedGenres}
            onGenreToggle={handleGenreToggle}
            sortBy={sortBy}
            onSortChange={setSortBy}
            yearRange={yearRange}
            onYearRangeChange={setYearRange}
            ratingRange={ratingRange}
            onRatingRangeChange={setRatingRange}
            language={language}
            onLanguageChange={setLanguage}
            onReset={resetFilters}
            onApply={applyFilters}
          />
        </div>

        {/* Movies Grid */}
        <MediaGrid items={movies} mediaType="movie" />

        {/* Infinite Scroll Loader */}
        <div ref={ref} className="flex justify-center py-12">
          {isFetchingNextPage && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <div className="w-5 h-5 border-2 border-t-transparent border-primary rounded-full animate-spin" />
              <span>Loading more movies...</span>
            </div>
          )}
        </div>

        {/* Scroll To Top Button */}
        {showScrollTop && (
          <button
            onClick={scrollToTop}
            className="fixed bottom-8 right-8 z-40 w-12 h-12 flex items-center justify-center rounded-full glass-light text-white/60 hover:text-white hover:scale-105 transition-all shadow-lg border border-white/[0.06]"
            aria-label="Scroll to top"
          >
            <ChevronUp className="w-5 h-5" />
          </button>
        )}
      </main>
    </div>
  );
}
