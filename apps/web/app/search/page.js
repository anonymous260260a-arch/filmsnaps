'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useRouter } from 'next/navigation';
import { Search, Film, ArrowLeft } from 'lucide-react';
import { tmdbApi, getImageUrl, rankSearchResults, smartSearch } from '@/lib/tmdb';
import { useDebounce } from '@/hooks/useDebounce';
import { Header } from '@/components/Header';
import { MovieCard } from '@/components/MovieCard';
import Link from 'next/link';

export default function SearchPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQuery = searchParams.get('q') || '';
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const debouncedQuery = useDebounce(searchQuery, 500);

  // Sync URL query param to input on mount
  useEffect(() => {
    if (initialQuery) {
      setSearchQuery(initialQuery);
    }
  }, [initialQuery]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () => smartSearch(debouncedQuery),
    enabled: debouncedQuery.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  // Update URL when user types (after debounce)
  useEffect(() => {
    if (debouncedQuery && debouncedQuery !== initialQuery) {
      const params = new URLSearchParams();
      params.set('q', debouncedQuery);
      router.replace(`/search?${params.toString()}`, { scroll: false });
    }
  }, [debouncedQuery, initialQuery, router]);

  const results = data?.results
    ? rankSearchResults(data.results, debouncedQuery)
    : [];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          {/* Search Input */}
          <div className="max-w-2xl mx-auto mb-12">
            <div className="flex items-center gap-3 mb-6">
              <Link
                href="/"
                className="p-2 -ml-2 rounded-xl hover:bg-white/[0.04] transition-colors text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
                Search
              </h1>
            </div>
            <div className="relative">
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search movies, TV shows..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-14 pr-6 h-14 bg-secondary/30 border border-white/[0.06] rounded-2xl text-foreground text-base placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/20 transition-all backdrop-blur-sm"
                autoFocus
              />
            </div>
            {(isLoading || isFetching) && searchQuery && (
              <div className="flex items-center justify-center gap-2 mt-6 text-sm text-muted-foreground">
                <div className="w-4 h-4 border-2 border-t-transparent border-primary rounded-full animate-spin" />
                <span>Searching...</span>
              </div>
            )}
          </div>

          {/* Empty state — no query */}
          {!searchQuery && (
            <div className="text-center text-muted-foreground py-16">
              <Search className="h-16 w-16 mx-auto mb-4 opacity-30" />
              <p className="text-lg">Start typing to discover movies and TV shows</p>
            </div>
          )}

          {/* No results */}
          {searchQuery && !isLoading && results && results.length === 0 && (
            <div className="text-center text-muted-foreground py-16">
              <Film className="h-14 w-14 mx-auto mb-4 opacity-30" />
              <p className="text-lg">No results found for &quot;{searchQuery}&quot;</p>
              <p className="text-sm mt-2">Try a different search term</p>
            </div>
          )}

          {/* Results */}
          {results && results.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-6 px-1">
                <span className="text-sm text-muted-foreground">
                  Found {results.length} result{results.length !== 1 ? 's' : ''}
                </span>
                <span className="w-px h-4 bg-white/[0.06]" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50 truncate max-w-[200px]">
                  {searchQuery}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-5 lg:gap-6">
                {results.map((item) => (
                  <div key={`${item.media_type}-${item.id}`} className="w-full">
                    <MovieCard item={item} mediaType={item.media_type} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
