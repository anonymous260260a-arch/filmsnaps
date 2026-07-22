/**
 * MovieBox Experiment — Experimental Watch Page
 *
 * Browse moviebox.ph content, search, and watch streams directly.
 * Uses the H.264 MP4 streams from netfilm.world — no HEVC issues.
 *
 * This is a self-contained experimental page, not the main app.
 */

'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Search, Play, Film, X, ChevronDown, ChevronUp, Clapperboard, Loader2 } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────

interface SearchResult {
  name: string;
  poster_url: string;
  slug: string;
  subject_id: string;
  badge?: string;
  rating?: string;
  year?: string;
}

interface DetailData {
  data?: {
    title?: string;
    cover?: { url?: string };
    genres?: Array<{ name?: string }>;
    description?: string;
    episodes?: Array<{ name?: string; seriesNo?: number; episodeNo?: number }>;
    seasons?: Array<{ name?: string; seriesNo?: number; episodes?: Array<any> }>;
    releaseDate?: string;
    imdbRatingValue?: string;
  };
}

interface StreamSource {
  resolution: string;
  format: string;
  url: string;
  size: string;
  codec: string;
  duration: string;
}

interface StreamResult {
  has_resource: boolean;
  sources: StreamSource[];
  note: string | null;
  limited: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatSize(size: string): string {
  if (!size) return '';
  const n = parseInt(size, 10);
  if (isNaN(n)) return size;
  if (n > 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} GB`;
  if (n > 1_000_000) return `${(n / 1_000_000).toFixed(0)} MB`;
  return size;
}

// ── Component ────────────────────────────────────────────────────────

export default function MovieBoxExpPage() {
  // Search state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);

  // Home/trending
  const [homeData, setHomeData] = useState<any[]>([]);
  const [loadingHome, setLoadingHome] = useState(true);

  // Detail state
  const [detailSlug, setDetailSlug] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<DetailData | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Stream state
  const [streamData, setStreamData] = useState<StreamResult | null>(null);
  const [loadingStream, setLoadingStream] = useState(false);
  const [selectedQuality, setSelectedQuality] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [episodeSe, setEpisodeSe] = useState(1);
  const [episodeEp, setEpisodeEp] = useState(1);
  const [activeTab, setActiveTab] = useState<'search' | 'browse'>('browse');
  const [error, setError] = useState<string | null>(null);

  // ── Load home on mount ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/exp/moviebox/home');
        const json = await res.json();
        // Flatten sections into one list (skip Banner)
        const allItems: SearchResult[] = [];
        for (const section of json.sections || []) {
          if (section.section !== 'Banner') {
            for (const item of section.items || []) {
              if (!allItems.find((i) => i.slug === item.slug)) {
                allItems.push(item);
              }
            }
          }
        }
        setHomeData(allItems);
      } catch (e) {
        console.error('[MovieBox] Failed to load home:', e);
      } finally {
        setLoadingHome(false);
      }
    })();
  }, []);

  // ── Search handler ──
  const handleSearch = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearched(true);
    setError(null);
    setDetailSlug(null);
    setDetailData(null);
    setStreamData(null);
    setIsPlaying(false);

    try {
      const res = await fetch(`/api/exp/moviebox/search?q=${encodeURIComponent(query.trim())}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Search failed');
      setResults(json.items || []);
    } catch (e: any) {
      setError(e.message);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  // ── Fetch detail + stream ──
  const openDetail = useCallback(async (item: SearchResult) => {
    setDetailSlug(item.slug);
    setLoadingDetail(true);
    setError(null);
    setStreamData(null);
    setStreamData(null);
    setVideoError(false);
    setIsPlaying(false);
    setSelectedQuality(0);
    setEpisodeSe(1);
    setEpisodeEp(1);

    try {
      const [detailRes, streamRes] = await Promise.all([
        fetch(`/api/exp/moviebox/detail/${item.slug}`),
        fetch(`/api/exp/moviebox/stream/${item.subject_id}?detail_path=${item.slug}&se=1&ep=1`),
      ]);

      if (detailRes.ok) {
        setDetailData(await detailRes.json());
      }
      if (streamRes.ok) {
        const streamJson = await streamRes.json();
        setStreamData(streamJson);
        if (!streamJson.has_resource) {
          setError(streamJson.note);
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  // ── Episode change ──
  const changeEpisode = useCallback(async (se: number, ep: number) => {
    if (!detailSlug || !detailData?.data) return;
    setEpisodeSe(se);
    setEpisodeEp(ep);
    setLoadingStream(true);
    setError(null);
    setVideoError(false);
    setIsPlaying(false);

    // Find subject_id from detail data
    const subjectId = (detailData as any)?.data?.subjectId || '';

    try {
      const res = await fetch(
        `/api/exp/moviebox/stream/${subjectId}?detail_path=${detailSlug}&se=${se}&ep=${ep}`,
      );
      if (!res.ok) throw new Error('Failed to load stream');
      const json = await res.json();
      setStreamData(json);
      if (!json.has_resource) {
        setError(json.note || 'No stream available for this episode');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingStream(false);
    }
  }, [detailSlug, detailData]);

  // ── Quality change ──
  const handleQualityChange = useCallback((idx: number) => {
    setSelectedQuality(idx);
    // If currently playing, switch source
    if (videoRef.current && streamData?.sources[idx]) {
      const wasPlaying = !videoRef.current.paused;
      videoRef.current.src = streamData.sources[idx].url;
      videoRef.current.load();
      if (wasPlaying) {
        videoRef.current.play().catch(() => {});
      }
    }
  }, [streamData]);

  // ── Play ──
  const [videoError, setVideoError] = useState(false);

  const handlePlay = useCallback(() => {
    if (!streamData?.sources[selectedQuality]?.url) return;
    if (videoRef.current) {
      videoRef.current.src = streamData.sources[selectedQuality].url;
      videoRef.current.load();
      videoRef.current.play().catch(() => setVideoError(true));
      setIsPlaying(true);
    }
  }, [streamData, selectedQuality]);

  return (
    <div className="min-h-screen bg-[#07080c] text-white">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-50 bg-[#07080c]/90 backdrop-blur-md border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
          <Film className="text-[#ff3d71]" size={24} />
          <h1 className="text-lg font-bold tracking-tight">
            MovieBox <span className="text-[#52525B] font-normal text-sm">Experiment</span>
          </h1>

          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => setActiveTab('browse')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'browse' ? 'bg-white/10 text-white' : 'text-[#52525B] hover:text-white'
              }`}
            >
              Browse
            </button>
            <button
              onClick={() => setActiveTab('search')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'search' ? 'bg-white/10 text-white' : 'text-[#52525B] hover:text-white'
              }`}
            >
              Search
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* ── Search bar ── */}
        {activeTab === 'search' && (
          <form onSubmit={handleSearch} className="mb-8">
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
                {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Search
              </button>
            </div>
          </form>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* ── Detail/Player view ── */}
        {detailSlug && (
          <div className="mb-8">
            {/* Back button */}
            <button
              onClick={() => {
                setDetailSlug(null);
                setDetailData(null);
                setStreamData(null);
                setIsPlaying(false);
                setVideoError(false);
              }}
              className="mb-4 text-xs text-[#52525B] hover:text-white transition-colors flex items-center gap-1"
            >
              <X size={12} /> Close
            </button>

            {/* Video player */}
            {streamData?.has_resource && (
              <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black mb-4 ring-1 ring-white/[0.08]">
                {!isPlaying ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10">
                    {loadingStream ? (
                      <Loader2 size={32} className="animate-spin text-[#52525B]" />
                    ) : (
                      <button
                        onClick={handlePlay}
                        className="w-16 h-16 rounded-full bg-[#ff3d71] flex items-center justify-center hover:scale-110 transition-transform active:scale-95"
                      >
                        <Play size={28} className="text-white ml-1" />
                      </button>
                    )}
                  </div>
                ) : null}

                <video
                  ref={videoRef}
                  className="w-full h-full object-contain bg-black"
                  controls={isPlaying}
                  playsInline
                  onError={() => {
                    setVideoError(true);
                    setError('Failed to load video stream. Try another quality.');
                  }}
                />

                {videoError && isPlaying && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
                    <div className="text-center">
                      <p className="text-red-400 text-sm mb-2">Video failed to load</p>
                      <button
                        onClick={handlePlay}
                        className="px-4 py-2 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                )}

                {/* Quality selector overlay */}
                {streamData.sources.length > 1 && isPlaying && (
                  <div className="absolute top-3 right-3 z-10 flex gap-1">
                    {streamData.sources.map((s, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleQualityChange(idx)}
                        className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase transition-all ${
                          selectedQuality === idx
                            ? 'bg-[#ff3d71] text-white'
                            : 'bg-black/60 text-white/60 hover:text-white'
                        }`}
                      >
                        {s.resolution}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Detail info ── */}
            {loadingDetail ? (
              <div className="flex items-center gap-2 text-[#52525B] text-sm">
                <Loader2 size={14} className="animate-spin" />
                Loading...
              </div>
            ) : detailData?.data ? (
              <div className="space-y-4">
                <h2 className="text-2xl font-bold">{detailData.data.title}</h2>

                {detailData.data.genres && (
                  <div className="flex flex-wrap gap-2">
                    {detailData.data.genres.map((g: any, i: number) => (
                      <span
                        key={i}
                        className="px-2.5 py-1 rounded-full bg-white/[0.06] text-[10px] font-semibold text-[#A1A1AA] uppercase tracking-wider"
                      >
                        {typeof g === 'string' ? g : g.name}
                      </span>
                    ))}
                  </div>
                )}

                {detailData.data.description && (
                  <p className="text-sm text-[#A1A1AA] leading-relaxed line-clamp-3">
                    {detailData.data.description}
                  </p>
                )}

                {/* ── Episode selector ── */}
                {detailData.data.seasons && detailData.data.seasons.length > 0 && (
                  <div className="pt-2">
                    <h3 className="text-sm font-semibold mb-3 text-[#A1A1AA] uppercase tracking-wider">
                      Episodes
                    </h3>
                    <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                      {detailData.data.seasons.map((season) =>
                        (season.episodes || []).map((ep: any) => (
                          <button
                            key={`${season.seriesNo}-${ep.episodeNo}`}
                            onClick={() => changeEpisode(season.seriesNo || 1, ep.episodeNo || 1)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                              episodeSe === (season.seriesNo || 1) &&
                              episodeEp === (ep.episodeNo || 1)
                                ? 'bg-[#ff3d71] text-white'
                                : 'bg-white/[0.06] text-[#A1A1AA] hover:text-white hover:bg-white/[0.12]'
                            }`}
                          >
                            S{season.seriesNo || 1}:E{ep.episodeNo || 1}
                          </button>
                        )),
                      )}
                    </div>
                  </div>
                )}

                {/* Stream sources info */}
                {streamData?.has_resource && streamData.sources.length > 0 && (
                  <div className="pt-2">
                    <h3 className="text-sm font-semibold mb-2 text-[#A1A1AA] uppercase tracking-wider">
                      Available Qualities
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {streamData.sources.map((s, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleQualityChange(idx)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            selectedQuality === idx
                              ? 'bg-[#ff3d71] text-white ring-1 ring-[#ff3d71]/50'
                              : 'bg-white/[0.06] text-[#A1A1AA] hover:text-white'
                          }`}
                        >
                          {s.resolution} • {s.format} {s.size ? `• ${formatSize(s.size)}` : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* ── Browse / Results grid ── */}
        <div
          className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3`}
        >
          {/* Home browsing */}
          {activeTab === 'browse' && !detailSlug && (
            <>
              {loadingHome ? (
                <div className="col-span-full flex items-center justify-center py-20">
                  <Loader2 size={24} className="animate-spin text-[#52525B]" />
                </div>
              ) : (
                homeData.map((item, idx) => (
                  <Card
                    key={idx}
                    item={item}
                    onClick={() => openDetail(item)}
                  />
                ))
              )}
            </>
          )}

          {/* Search results */}
          {activeTab === 'search' && searched && !detailSlug && (
            <>
              {results.length === 0 && !searching ? (
                <div className="col-span-full flex flex-col items-center justify-center py-20 text-[#52525B]">
                  <Search size={32} className="mb-3 opacity-30" />
                  <p className="text-sm">No results found for &ldquo;{query}&rdquo;</p>
                </div>
              ) : (
                results.map((item, idx) => (
                  <Card key={idx} item={item} onClick={() => openDetail(item)} />
                ))
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="text-center py-12 text-[10px] text-[#52525B] uppercase tracking-widest">
        MovieBox Experiment • Powered by moviebox.ph API
      </footer>
    </div>
  );
}

// ── Card Component ───────────────────────────────────────────────────

function Card({ item, onClick }: { item: SearchResult; onClick: () => void }) {
  const [imgError, setImgError] = useState(false);

  return (
    <button
      onClick={onClick}
      className="group text-left rounded-xl overflow-hidden bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.15] transition-all hover:scale-[1.02] active:scale-[0.98]"
    >
      <div className="aspect-[2/3] relative overflow-hidden bg-[#0E0E11]">
        {item.poster_url && !imgError ? (
          <img
            src={item.poster_url}
            alt={item.name}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film size={24} className="text-[#222226]" />
          </div>
        )}

        {/* Badge */}
        {item.badge && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-[#ff3d71]/90 text-white text-[8px] font-bold uppercase">
            {item.badge}
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
          {item.name}
        </p>
        {item.year && (
          <p className="text-[10px] text-[#52525B] mt-0.5">{item.year}</p>
        )}
      </div>
    </button>
  );
}
