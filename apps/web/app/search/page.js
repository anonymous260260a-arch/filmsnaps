"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import { Search, Film, ArrowLeft, Sparkles } from "lucide-react";
import {
  tmdbApi,
  getImageUrl,
  rankSearchResults,
  smartSearch,
} from "@/lib/tmdb";
import { animeSearch, rankAnimeSearchResults } from "@/lib/anime/search";
import { useDebounce } from "@/hooks/useDebounce";
import { Header } from "@/components/Header";
import { MovieCard } from "@/components/MovieCard";
import { AnimeCard } from "@/components/AnimeCard";
import Link from "next/link";

// ── Anime toggle persistence (F9): survives reloads, travels via ?anime=1 ──
const ANIME_TOGGLE_KEY = "fs:search-anime";

function readInitialAnime(sp) {
  const url = sp.get("anime");
  if (url === "1") return true;
  if (url === "0") return false;
  if (typeof window !== "undefined") {
    try {
      return localStorage.getItem(ANIME_TOGGLE_KEY) === "1";
    } catch {
      /* private mode etc. */
    }
  }
  return false;
}

export default function SearchPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQuery = searchParams.get("q") || "";
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const debouncedQuery = useDebounce(searchQuery, 500);
  const [animeMode, setAnimeMode] = useState(() =>
    readInitialAnime(searchParams),
  );

  // Sync URL query param to input on mount
  useEffect(() => {
    if (initialQuery) {
      setSearchQuery(initialQuery);
    }
  }, [initialQuery]);

  // Persist the toggle + reflect it in the URL so deep links carry mode
  useEffect(() => {
    try {
      localStorage.setItem(ANIME_TOGGLE_KEY, animeMode ? "1" : "0");
    } catch {
      /* non-fatal */
    }
  }, [animeMode]);

  // ── Dual queries. Both stay enabled so toggling flips instantly between
  // cached result sets (no re-fetch flash). AniList traffic is server-side
  // and edge-cached 24h, so keeping this warm costs nothing upstream.
  const tmdbQuery = useQuery({
    queryKey: ["search", debouncedQuery],
    queryFn: () => smartSearch(debouncedQuery),
    enabled: debouncedQuery.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const animeQuery = useQuery({
    queryKey: ["anime-search", debouncedQuery],
    queryFn: () => animeSearch(debouncedQuery),
    enabled: debouncedQuery.length > 0,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    // Upstream ceiling is ~90 req/min on AniList — no client retry storm
    // when the proxy reports an outage; the next keystroke re-fires anyway.
    retry: false,
  });

  // Update URL when user types (after debounce)
  useEffect(() => {
    if (debouncedQuery && debouncedQuery !== initialQuery) {
      const params = new URLSearchParams();
      params.set("q", debouncedQuery);
      if (animeMode) params.set("anime", "1");
      router.replace(`/search?${params.toString()}`, { scroll: false });
    }
  }, [debouncedQuery, initialQuery, router, animeMode]);

  const isLoading = animeMode ? animeQuery.isLoading : tmdbQuery.isLoading;
  const isFetching = animeMode ? animeQuery.isFetching : tmdbQuery.isFetching;

  const results = animeMode
    ? animeQuery.data?.results
      ? rankAnimeSearchResults(animeQuery.data.results, debouncedQuery)
      : []
    : tmdbQuery.data?.results
      ? rankSearchResults(tmdbQuery.data.results, debouncedQuery)
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
                placeholder={
                  animeMode
                    ? "Search MyAnimeList..."
                    : "Search movies, TV shows..."
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-14 pr-6 h-14 bg-secondary/30 border border-white/[0.06] rounded-2xl text-foreground text-base placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/20 transition-all backdrop-blur-sm"
                autoFocus
              />
            </div>

            {/* Anime toggle */}
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                role="switch"
                aria-checked={animeMode}
                onClick={() => setAnimeMode((v) => !v)}
                className={`group flex items-center gap-3 h-10 px-4 rounded-full border text-sm font-medium transition-all ${
                  animeMode
                    ? "border-[#D4A237]/40 bg-[#D4A237]/10 text-[#D4A237]"
                    : "border-white/[0.06] bg-secondary/30 text-muted-foreground hover:text-foreground"
                }`}
              >
                <span
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    animeMode ? "bg-[#D4A237]" : "bg-white/10"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      animeMode ? "translate-x-[18px]" : "translate-x-0.5"
                    }`}
                  />
                </span>
                <Sparkles className="h-4 w-4" />
                Anime search
              </button>
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
              <p className="text-lg">
                Start typing to discover movies and TV shows
              </p>
            </div>
          )}

          {/* Anime upstream outage — distinct from "no results" (upstream
              outages surface as proxy 502s; retry fires on the next keystroke) */}
          {animeMode && animeQuery.isError && (
            <div className="text-center text-muted-foreground py-16">
              <Film className="h-14 w-14 mx-auto mb-4 opacity-30" />
              <p className="text-lg">Anime search is temporarily unavailable</p>
              <p className="text-sm mt-2">
                The MyAnimeList directory can&apos;t be reached right now — try
                again in a few minutes
              </p>
            </div>
          )}

          {/* No results */}
          {searchQuery &&
            !isLoading &&
            !animeQuery.isError &&
            results.length === 0 && (
              <div className="text-center text-muted-foreground py-16">
                <Film className="h-14 w-14 mx-auto mb-4 opacity-30" />
                <p className="text-lg">
                  No results found for &quot;{searchQuery}&quot;
                </p>
                <p className="text-sm mt-2">
                  {animeMode
                    ? "Only titles with a TMDB entry are shown — try the standard search"
                    : "Try a different search term"}
                </p>
              </div>
            )}

          {/* Results */}
          {results && results.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-6 px-1">
                <span className="text-sm text-muted-foreground">
                  Found {results.length} result{results.length !== 1 ? "s" : ""}
                </span>
                <span className="w-px h-4 bg-white/[0.06]" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50 truncate max-w-[200px]">
                  {searchQuery}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-5 lg:gap-6">
                {results.map((item) =>
                  animeMode ? (
                    <AnimeCard key={`a-${item.malId}`} item={item} />
                  ) : (
                    <div
                      key={`${item.media_type}-${item.id}`}
                      className="w-full"
                    >
                      <MovieCard item={item} mediaType={item.media_type} />
                    </div>
                  ),
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
