/**
 * ShowBox Experiment — Experimental Browse/Watch Page
 *
 * Browse sbfunapi.cc content — the original MovieBox backend.
 * Browse movies & TV shows, view details, and attempt playback
 * via embedded video URLs from the API.
 *
 * This is a self-contained experimental page, separate from the
 * moviebox.ph experiment at /exp/watch.
 */

'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Search,
  Play,
  Film,
  X,
  ChevronDown,
  ChevronUp,
  Tv,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────

interface ListItem {
  id: number;
  title: string;
  rating: number;
  year: string;
  type: 'movie' | 'tv';
  imdb_id?: string;
  poster?: string;
  seasons?: string;
}

interface MovieDetail {
  id: number;
  title: string;
  description: string;
  year: string;
  poster: string;
  rating: string;
  imdb_id: string;
  imdb_rating: string;
  play_time?: string;
  release_time?: string;
  recommend?: number[];
  sources?: Array<{ url: string; quality: string }>;
  videos?: Array<{ url: string; label: string }>;
}

interface TVSeasonDetail {
  banner: string;
  description: string;
  thumbs: Record<string, string>;
  titles: Record<string, string>;
}

// ── Component ────────────────────────────────────────────────────────

export default function ShowBoxExpPage() {
  // Browse state
  const [items, setItems] = useState<ListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'movies' | 'tv'>('movies');

  // Categories
  const [cats, setCats] = useState<Record<string, string>>({});
  const [selectedCat, setSelectedCat] = useState('all');
  const [showCatPicker, setShowCatPicker] = useState(false);

  // Search
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{
    movies: ListItem[];
    tv: ListItem[];
  } | null>(null);
  const [searching, setSearching] = useState(false);

  // Detail state
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailType, setDetailType] = useState<'movie' | 'tv' | null>(null);
  const [movieDetail, setMovieDetail] = useState<MovieDetail | null>(null);
  const [tvDetail, setTvDetail] = useState<TVSeasonDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [tvSeason, setTvSeason] = useState(1);
  const [selectedEpisode, setSelectedEpisode] = useState<string>('1');

  // Player state
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // ── Load data on mount & when tab/page/cat changes ──
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSearchResults(null);

    try {
      const res = await fetch(
        `/api/exp/showbox/${activeTab}?page=${page}&cat=${selectedCat}`,
      );
      if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
      const json = await res.json();
      setItems(json.items || []);
      setTotal(json.total || 0);
    } catch (e: any) {
      setError(e.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab, page, selectedCat]);

  // Load categories on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/exp/showbox/categories');
        const json = await res.json();
        setCats(json || {});
      } catch {}
    })();
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Search handler ──
  const handleSearch = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    setDetailId(null);
    setMovieDetail(null);
    setTvDetail(null);
    setVideoUrl(null);
    setIsPlaying(false);

    try {
      const res = await fetch(
        `/api/exp/showbox/search?q=${encodeURIComponent(query.trim())}`,
      );
      if (!res.ok) throw new Error('Search failed');
      const json = await res.json();
      setSearchResults({ movies: json.movies || [], tv: json.tv || [] });
    } catch (e: any) {
      setError(e.message);
      setSearchResults(null);
    } finally {
      setSearching(false);
    }
  }, [query]);

  // ── Open detail ──
  const openDetail = useCallback(
    async (item: ListItem) => {
      setDetailId(item.id);
      setDetailType(item.type);
      setLoadingDetail(true);
      setError(null);
      setVideoUrl(null);
      setIsPlaying(false);
      setVideoError(false);
      setTvSeason(1);
      setSelectedEpisode('1');
      setMovieDetail(null);
      setTvDetail(null);

      try {
        if (item.type === 'movie') {
          const res = await fetch(`/api/exp/showbox/detail/movie/${item.id}`);
          if (res.ok) {
            const json = await res.json();
            setMovieDetail(json);

            // Auto-select first video source if available
            const firstUrl =
              json.videos?.[0]?.url ||
              json.sources?.[0]?.url ||
              null;
            if (firstUrl) setVideoUrl(firstUrl);
          }
        } else {
          const res = await fetch(
            `/api/exp/showbox/detail/tv/${item.id}?season=1`,
          );
          if (res.ok) {
            const json = await res.json();
            setTvDetail(json);
          }
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoadingDetail(false);
      }
    },
    [],
  );

  // ── Load TV season ──
  const loadTVSeason = useCallback(
    async (season: number) => {
      if (!detailId) return;
      setTvSeason(season);
      setLoadingDetail(true);

      try {
        const res = await fetch(
          `/api/exp/showbox/detail/tv/${detailId}?season=${season}`,
        );
        if (res.ok) {
          const json = await res.json();
          setTvDetail(json);
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoadingDetail(false);
      }
    },
    [detailId],
  );

  // ── Play video ──
  const handlePlay = useCallback((url: string) => {
    if (!url) return;
    setVideoUrl(url);
    if (videoRef.current) {
      videoRef.current.src = url;
      videoRef.current.load();
      videoRef.current.play().catch(() => setVideoError(true));
      setIsPlaying(true);
      setVideoError(false);
    }
  }, []);

  // ── Close detail ──
  const closeDetail = useCallback(() => {
    setDetailId(null);
    setDetailType(null);
    setMovieDetail(null);
    setTvDetail(null);
    setVideoUrl(null);
    setIsPlaying(false);
    setVideoError(false);
  }, []);

  // ── Pagination ──
  const totalPages = Math.ceil(total / 24);

  return (
    <div className="min-h-screen bg-[#07080c] text-white">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-50 bg-[#07080c]/90 backdrop-blur-md border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
          <Film className="text-[#ff3d71]" size={24} />
          <h1 className="text-lg font-bold tracking-tight">
            ShowBox{' '}
            <span className="text-[#52525B] font-normal text-sm">
              Experiment
            </span>
          </h1>

          <div className="flex items-center gap-2 ml-auto">
            {/* Movie/TV tabs */}
            <button
              onClick={() => {
                setActiveTab('movies');
                setPage(1);
                closeDetail();
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'movies'
                  ? 'bg-white/10 text-white'
                  : 'text-[#52525B] hover:text-white'
              }`}
            >
              Movies
            </button>
            <button
              onClick={() => {
                setActiveTab('tv');
                setPage(1);
                closeDetail();
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'tv'
                  ? 'bg-white/10 text-white'
                  : 'text-[#52525B] hover:text-white'
              }`}
            >
              TV Shows
            </button>

            {/* Search toggle — just scroll to search */}
            <button
              onClick={() => {
                const el = document.getElementById('search-section');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/[0.06] text-[#52525B] hover:text-white transition-colors flex items-center gap-1.5"
            >
              <Search size={12} />
              Search
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* ── Search section ── */}
        <div id="search-section" className="mb-8">
          <form onSubmit={handleSearch}>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#52525B] pointer-events-none"
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search movies & TV shows..."
                  className="w-full bg-white/[0.06] border border-white/[0.1] rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-[#52525B] outline-none focus:border-[#ff3d71]/50 focus:bg-white/[0.08] transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={searching || !query.trim()}
                className="px-5 py-3 rounded-xl bg-[#ff3d71] text-white text-sm font-bold hover:bg-[#e03560] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {searching ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Search size={14} />
                )}
                Search
              </button>
            </div>
          </form>

          {/* Search results */}
          {searchResults && (
            <div className="mt-4 space-y-4">
              {searchResults.movies.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-[#52525B] uppercase tracking-wider mb-2">
                    Movies ({searchResults.movies.length})
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                    {searchResults.movies.map((item) => (
                      <Card
                        key={`m-${item.id}`}
                        item={item}
                        onClick={() => openDetail(item)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {searchResults.tv.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-[#52525B] uppercase tracking-wider mb-2">
                    TV Shows ({searchResults.tv.length})
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                    {searchResults.tv.map((item) => (
                      <Card
                        key={`t-${item.id}`}
                        item={item}
                        onClick={() => openDetail(item)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {searchResults.movies.length === 0 &&
                searchResults.tv.length === 0 && (
                  <div className="flex flex-col items-center py-8 text-[#52525B]">
                    <Search size={24} className="mb-2 opacity-30" />
                    <p className="text-sm">
                      No results for &ldquo;{query}&rdquo;
                    </p>
                  </div>
                )}
            </div>
          )}
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* ── Detail/Player view ── */}
        {detailId && (
          <div className="mb-8">
            {/* Back button */}
            <button
              onClick={closeDetail}
              className="mb-4 text-xs text-[#52525B] hover:text-white transition-colors flex items-center gap-1"
            >
              <X size={12} /> Close
            </button>

            {loadingDetail ? (
              <div className="flex items-center gap-2 text-[#52525B] text-sm py-8">
                <Loader2 size={14} className="animate-spin" />
                Loading details...
              </div>
            ) : (
              <>
                {/* ── Movie Detail ── */}
                {detailType === 'movie' && movieDetail && (
                  <div className="space-y-4">
                    <div className="flex flex-col md:flex-row gap-6">
                      {/* Poster */}
                      {movieDetail.poster && (
                        <div className="w-40 shrink-0">
                          <img
                            src={movieDetail.poster}
                            alt={movieDetail.title}
                            className="w-full rounded-xl ring-1 ring-white/[0.08]"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <h2 className="text-2xl font-bold mb-1">
                          {movieDetail.title}
                        </h2>
                        <div className="flex flex-wrap gap-3 text-xs text-[#52525B] mb-3">
                          {movieDetail.year && <span>{movieDetail.year}</span>}
                          {movieDetail.imdb_rating && (
                            <span className="text-[#f5c518]">
                              ★ {movieDetail.imdb_rating}
                            </span>
                          )}
                          {movieDetail.rating && (
                            <span className="text-[#ff3d71]">
                              ShowBox: {movieDetail.rating}
                            </span>
                          )}
                          {movieDetail.play_time && (
                            <span>{movieDetail.play_time} min</span>
                          )}
                        </div>

                        {movieDetail.description && (
                          <p className="text-sm text-[#A1A1AA] leading-relaxed line-clamp-4">
                            {movieDetail.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Video sources */}
                    {movieDetail.videos && movieDetail.videos.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold mb-2 text-[#A1A1AA] uppercase tracking-wider">
                          Available Streams
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {movieDetail.videos.map((v, idx) => (
                            <button
                              key={idx}
                              onClick={() => handlePlay(v.url)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                                videoUrl === v.url
                                  ? 'bg-[#ff3d71] text-white ring-1 ring-[#ff3d71]/50'
                                  : 'bg-white/[0.06] text-[#A1A1AA] hover:text-white'
                              }`}
                            >
                              <Play size={10} />
                              {v.label || `Source ${idx + 1}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {movieDetail.sources && movieDetail.sources.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold mb-2 text-[#A1A1AA] uppercase tracking-wider">
                          Raw Sources
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {movieDetail.sources.map((s, idx) => (
                            <button
                              key={idx}
                              onClick={() => handlePlay(s.url)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                videoUrl === s.url
                                  ? 'bg-[#ff3d71] text-white'
                                  : 'bg-white/[0.06] text-[#A1A1AA] hover:text-white'
                              }`}
                            >
                              {s.quality || `Source ${idx + 1}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {(!movieDetail.videos?.length &&
                      !movieDetail.sources?.length) && (
                      <div className="px-4 py-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm flex items-center gap-2">
                        <AlertTriangle size={14} />
                        No stream sources found in the API response for this
                        movie.
                      </div>
                    )}
                  </div>
                )}

                {/* ── TV Detail ── */}
                {detailType === 'tv' && tvDetail && (
                  <div className="space-y-4">
                    <h2 className="text-2xl font-bold">
                      Season {tvSeason}
                    </h2>

                    {tvDetail.description && (
                      <p className="text-sm text-[#A1A1AA] leading-relaxed line-clamp-3">
                        {tvDetail.description}
                      </p>
                    )}

                    {/* Season selector */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#52525B] font-semibold uppercase tracking-wider">
                        Season:
                      </span>
                      <select
                        value={tvSeason}
                        onChange={(e) =>
                          loadTVSeason(parseInt(e.target.value, 10))
                        }
                        className="bg-white/[0.06] border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-[#ff3d71]/50"
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                          <option key={s} value={s}>
                            Season {s}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Episode grid */}
                    {tvDetail.thumbs && (
                      <div>
                        <h3 className="text-sm font-semibold mb-3 text-[#A1A1AA] uppercase tracking-wider">
                          Episodes
                        </h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                          {Object.entries(tvDetail.thumbs).map(
                            ([epNum, thumbUrl]) => (
                              <button
                                key={epNum}
                                onClick={() => {
                                  setSelectedEpisode(epNum);
                                  // TV episodes might not have direct URLs
                                  // We'd need to derive from the season detail
                                }}
                                className={`text-left rounded-xl overflow-hidden bg-white/[0.03] border transition-all hover:scale-[1.02] active:scale-[0.98] ${
                                  selectedEpisode === epNum
                                    ? 'border-[#ff3d71]/50 ring-1 ring-[#ff3d71]/20'
                                    : 'border-white/[0.06] hover:border-white/[0.15]'
                                }`}
                              >
                                <div className="aspect-video relative overflow-hidden bg-[#0E0E11]">
                                  {thumbUrl ? (
                                    <img
                                      src={thumbUrl}
                                      alt={`Episode ${epNum}`}
                                      className="w-full h-full object-cover"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <Tv
                                        size={20}
                                        className="text-[#222226]"
                                      />
                                    </div>
                                  )}
                                  <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] font-bold">
                                    EP {epNum}
                                  </span>
                                </div>
                                <div className="p-1.5">
                                  <p className="text-[10px] font-medium leading-tight line-clamp-2 text-white/80">
                                    {tvDetail.titles?.[epNum] ||
                                      `Episode ${epNum}`}
                                  </p>
                                </div>
                              </button>
                            ),
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Video player ── */}
                {videoUrl && (
                  <div className="mt-6">
                    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black ring-1 ring-white/[0.08]">
                      <video
                        ref={videoRef}
                        className="w-full h-full object-contain bg-black"
                        controls={isPlaying}
                        playsInline
                        onError={() => {
                          setVideoError(true);
                          setError(
                            'Failed to load video stream. The URL may not be playable in the browser.',
                          );
                        }}
                      />

                      {videoError && isPlaying && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
                          <div className="text-center">
                            <AlertTriangle size={24} className="mx-auto mb-2 text-red-400" />
                            <p className="text-red-400 text-sm mb-2">
                              Video failed to load
                            </p>
                            <button
                              onClick={() => {
                                setVideoError(false);
                                setError(null);
                                if (videoRef.current && videoUrl) {
                                  videoRef.current.src = videoUrl;
                                  videoRef.current.load();
                                  videoRef.current.play().catch(() => {});
                                }
                              }}
                              className="px-4 py-2 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20"
                            >
                              Retry
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* URL info */}
                    <div className="mt-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[10px] text-[#52525B] break-all font-mono">
                      {videoUrl}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Category filter ── */}
        {!detailId && (
          <div className="mb-4 flex items-center gap-2">
            <button
              onClick={() => setShowCatPicker(!showCatPicker)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/[0.06] text-[#A1A1AA] hover:text-white transition-colors flex items-center gap-1"
            >
              {selectedCat === 'all'
                ? 'All Categories'
                : cats[selectedCat] || selectedCat}
              {showCatPicker ? (
                <ChevronUp size={12} />
              ) : (
                <ChevronDown size={12} />
              )}
            </button>

            {/* Result count */}
            <span className="text-[10px] text-[#52525B]">
              {total} results
            </span>
          </div>
        )}

        {/* Category picker dropdown */}
        {showCatPicker && !detailId && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            <button
              onClick={() => {
                setSelectedCat('all');
                setPage(1);
                setShowCatPicker(false);
              }}
              className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                selectedCat === 'all'
                  ? 'bg-[#ff3d71] text-white'
                  : 'bg-white/[0.06] text-[#A1A1AA] hover:text-white'
              }`}
            >
              All
            </button>
            {Object.entries(cats).map(([id, name]) => (
              <button
                key={id}
                onClick={() => {
                  setSelectedCat(id);
                  setPage(1);
                  setShowCatPicker(false);
                }}
                className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                  selectedCat === id
                    ? 'bg-[#ff3d71] text-white'
                    : 'bg-white/[0.06] text-[#A1A1AA] hover:text-white'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        {/* ── Content grid ── */}
        {!detailId && (
          <>
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 size={24} className="animate-spin text-[#52525B]" />
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {items.map((item) => (
                  <Card
                    key={`${item.type}-${item.id}`}
                    item={item}
                    onClick={() => openDetail(item)}
                    showType
                  />
                ))}
              </div>
            )}

            {/* ── Pagination ── */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/[0.06] text-[#A1A1AA] hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-xs text-[#52525B]">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/[0.06] text-[#A1A1AA] hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Footer ── */}
      <footer className="text-center py-12 text-[10px] text-[#52525B] uppercase tracking-widest">
        ShowBox Experiment • Powered by sbfunapi.cc •{' '}
        {total.toLocaleString()} titles indexed
      </footer>
    </div>
  );
}

// ── Card Component ───────────────────────────────────────────────────

function Card({
  item,
  onClick,
  showType,
}: {
  item: ListItem;
  onClick: () => void;
  showType?: boolean;
}) {
  const [imgError, setImgError] = useState(false);

  // TV shows might have a poster field
  const posterUrl = (item as any).poster || null;

  return (
    <button
      onClick={onClick}
      className="group text-left rounded-xl overflow-hidden bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.15] transition-all hover:scale-[1.02] active:scale-[0.98]"
    >
      <div className="aspect-[2/3] relative overflow-hidden bg-[#0E0E11]">
        {posterUrl && !imgError ? (
          <img
            src={posterUrl}
            alt={item.title}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {showType && item.type === 'tv' ? (
              <Tv size={24} className="text-[#222226]" />
            ) : (
              <Film size={24} className="text-[#222226]" />
            )}
          </div>
        )}

        {/* Type badge */}
        {showType && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[8px] font-bold uppercase">
            {item.type === 'tv' ? 'TV' : 'MOVIE'}
          </span>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
          <Play
            size={28}
            className="text-white opacity-0 group-hover:opacity-100 transition-all scale-50 group-hover:scale-100"
          />
        </div>
      </div>

      <div className="p-2">
        <p className="text-xs font-semibold leading-tight line-clamp-2 text-white/90 group-hover:text-white transition-colors">
          {item.title}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {item.year && (
            <span className="text-[10px] text-[#52525B]">{item.year}</span>
          )}
          {item.rating > 0 && (
            <span className="text-[10px] text-[#ff3d71]">
              ★ {item.rating.toFixed(1)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
