/**
 * FalixPlayer — direct video player for the Falix provider.
 *
 * Unlike all other providers (which use iframe embeds), Falix provides
 * direct video file URLs via a REST API. This component:
 * 1. Fetches metadata from the Falix API proxy (/api/player/falix)
 * 2. Parses telegram download links for the current movie/episode
 * 3. Renders a video.js player with quality and audio track selectors
 * 4. Uses the native HTML5 AudioTrackList API for language switching
 *    (video.js's abstraction often hides MKV native tracks)
 *
 * The MKV files contain H.264 video + multiple AAC audio tracks
 * (Hindi, Tamil, Telugu, etc.). Chrome/WebView plays these natively.
 */

'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import { Clapperboard, RefreshCw } from 'lucide-react';
import { WebCodecsPlayer } from './WebCodecsPlayer';
import { checkHevcSupport } from '@/lib/streamingMkvParser';

// ── Types ─────────────────────────────────────────────────────────

interface TelegramEntry {
  quality: string;
  id: string;
  name: string;
  size: string;
}

interface FalixEpisode {
  episode_number: number;
  title: string;
  episode_backdrop?: string;
  telegram: TelegramEntry[];
}

interface FalixSeason {
  season_number: number;
  episodes: FalixEpisode[];
}

interface FalixApiData {
  tmdb_id: number;
  media_type: string;
  telegram?: TelegramEntry[];
  seasons?: FalixSeason[];
}

interface FalixPlayerProps {
  /** TMDB content ID */
  tmdbId: string;
  /** Media type */
  mediaType: 'movie' | 'tv';
  /** Current season (TV only) */
  selectedSeason?: number;
  /** Current episode (TV only) */
  activeEpisode?: number;
  /** Called when video starts playing */
  onLoad?: () => void;
  /** Called on error */
  onError?: () => void;
}

// ── Language mapping (from filename patterns like "HIN-TAM-TEL") ──

const LANG_MAP: Record<string, string> = {
  HIN: 'Hindi',
  TAM: 'Tamil',
  TEL: 'Telugu',
  ENG: 'English',
  JAP: 'Japanese',
  KOR: 'Korean',
  SPA: 'Spanish',
  FRE: 'French',
  GER: 'German',
  POR: 'Portuguese',
  RUS: 'Russian',
  ARA: 'Arabic',
  BEN: 'Bengali',
  PUN: 'Punjabi',
  MAR: 'Marathi',
  GUJ: 'Gujarati',
  KAN: 'Kannada',
  MAL: 'Malayalam',
};

/**
 * Parse audio language names from a Falix telegram filename.
 * Filenames contain patterns like "HIN-TAM-TEL" or "ENG" that indicate
 * the available audio tracks in the MKV container.
 */
function parseAudioLanguages(name: string): string[] {
  // Multi-language pattern: "HIN-TAM-TEL" (3+ codes joined by dashes)
  const multi = name.match(/(?:^|[\s(])([A-Z]{3}(?:-[A-Z]{3})+)(?:\s|$|\))/);
  if (multi) {
    const langs = multi[1].split('-').map((abbr) => LANG_MAP[abbr] || abbr);
    console.log(`[Falix] parseAudioLanguages: multi match "${multi[1]}" →`, langs);
    return langs;
  }
  // Single language
  const single = name.match(/(?:^|[\s(])([A-Z]{3})(?:\s|$|\))/);
  if (single) {
    const lang = LANG_MAP[single[1]] || single[1];
    console.log(`[Falix] parseAudioLanguages: single match "${single[1]}" → ${lang}`);
    return [lang];
  }
  console.log(`[Falix] parseAudioLanguages: no language pattern found in "${name.slice(0, 60)}"`);
  return ['Default'];
}

/** Check if a file name indicates H.264 (vs HEVC) encoding. */
const isH264Encoding = (name: string) => !/x265|HEVC|hevc|10bit/i.test(name);

// ── Component ─────────────────────────────────────────────────────

export function FalixPlayer({
  tmdbId,
  mediaType,
  selectedSeason = 1,
  activeEpisode = 1,
  onLoad,
  onError,
}: FalixPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null);
  const loadingRef = useRef(false);

  const [apiData, setApiData] = useState<FalixApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedQualityIdx, setSelectedQualityIdx] = useState(0);
  const [activeAudioIdx, setActiveAudioIdx] = useState(0);
  const [audioLabels, setAudioLabels] = useState<string[]>(['Default']);
  // HEVC WebCodecs support detection
  const [hevcSupported, setHevcSupported] = useState<boolean | null>(null);

  // ── 1. Fetch metadata from Falix API ──
  useEffect(() => {
    let cancelled = false;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    setSelectedQualityIdx(0);
    setActiveAudioIdx(0);
    setAudioLabels(['Default']);

    console.log(`[Falix] Step 1: Fetching metadata for tmdbId=${tmdbId}, mediaType=${mediaType}, season=${selectedSeason}, episode=${activeEpisode}`);

    fetch(`/api/player/falix?id=${tmdbId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Falix API returned ${res.status}`);
        console.log(`[Falix] Step 1a: API responded with status ${res.status}`);
        return res.json() as Promise<FalixApiData>;
      })
      .then((data) => {
        if (cancelled) return;
        console.log(`[Falix] Step 1b: API data received — tmdb_id=${data.tmdb_id}, media_type=${data.media_type}, has_telegram=${!!data.telegram}, has_seasons=${!!data.seasons}, telegram_len=${data.telegram?.length}, seasons_len=${data.seasons?.length}`);
        setApiData(data);
        setLoading(false);
        loadingRef.current = false;
      })
      .catch((err: Error) => {
        if (cancelled) return;
        console.error(`[Falix] Step 1c: API fetch failed —`, err.message);
        setError(err.message);
        setLoading(false);
        loadingRef.current = false;
        onError?.();
      });

    return () => {
      cancelled = true;
    };
  }, [tmdbId, mediaType, selectedSeason, activeEpisode, onError]);

  // ── 1b. Detect HEVC WebCodecs support ──
  useEffect(() => {
    // Allow user override via localStorage (set by "Try Anyway" button)
    const stored = typeof window !== 'undefined' ? localStorage.getItem('falix_force_hevc') : null;
    if (stored === 'true') {
      console.log(`[Falix] HEVC bypass active via localStorage`);
      setHevcSupported(true);
      return;
    }

    let cancelled = false;
    (async () => {
      const supported = await checkHevcSupport();
      console.log(`[Falix] HEVC support detection result:`, supported);
      if (!cancelled) setHevcSupported(supported);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── 2. Resolve telegram entries for current media/episode ──
  const telegramEntries: TelegramEntry[] = useMemo(() => {
    if (!apiData) return [];

    let entries: TelegramEntry[];

    if (mediaType === 'movie' || apiData.media_type === 'movie') {
      entries = apiData.telegram || [];
      console.log(`[Falix] Step 2a: Movie mode — telegram entries=${entries.length}`, entries.map(e => `${e.quality} ${e.size}`).join(', '));
    } else if (apiData.seasons) {
      const season = apiData.seasons.find((s) => s.season_number === selectedSeason);
      if (season) {
        const episode = season.episodes.find((e) => e.episode_number === activeEpisode);
        entries = episode?.telegram || [];
        console.log(`[Falix] Step 2b: TV mode — season=${selectedSeason} ep=${activeEpisode}, entries=${entries.length}`, entries.map(e => `${e.quality} ${e.size}`).join(', '));
      } else {
        console.warn(`[Falix] Step 2c: Season ${selectedSeason} not found. Available:`, apiData.seasons.map(s => s.season_number));
        return [];
      }
    } else {
      console.warn(`[Falix] Step 2d: No seasons array in API data for TV mode`);
      return [];
    }

    // Sort: prefer H.264 (x264/AVC) over HEVC (x265/HEVC) for browser compatibility.
    // HEVC isn't universally supported by browsers. H.264 plays everywhere.
    // Within the same codec family, higher quality (index order) wins.
    const isH264 = (name: string) => !/x265|HEVC|hevc|10bit/i.test(name);
    entries.sort((a, b) => {
      const aH264 = isH264(a.name) ? 0 : 1;
      const bH264 = isH264(b.name) ? 0 : 1;
      if (aH264 !== bH264) return aH264 - bH264; // H.264 first
      return 0; // keep original order within same codec
    });

    console.log(`[Falix] Step 2e: After sorting —`, entries.map(e => `${e.quality} ${e.size}${isH264(e.name) ? ' [H.264]' : ' [HEVC]'}`).join(', '));
    return entries;
  }, [apiData, mediaType, selectedSeason, activeEpisode]);

  // Current telegram entry (based on selected quality)
  const currentEntry = useMemo<TelegramEntry | null>(() => {
    if (telegramEntries.length === 0) return null;
    const idx = Math.min(selectedQualityIdx, telegramEntries.length - 1);
    const entry = telegramEntries[idx];
    console.log(`[Falix] Step 2e: Selected quality idx=${idx}, entry=`, entry?.quality, entry?.name?.slice(0, 60));
    return entry;
  }, [telegramEntries, selectedQualityIdx]);

  // Build video URL from telegram entry
  const videoUrl = useMemo(() => {
    if (!currentEntry) return '';
    const url = `https://download-falix-falixmovies-backend-hf.hf.space/dl/${currentEntry.id}/${encodeURIComponent(currentEntry.name)}`;
    console.log(`[Falix] Step 2f: Video URL built — ${url}`);
    return url;
  }, [currentEntry]);

  // ── 3. Initialize video.js lazily — called when we have a video element and need a player ──
  const initPlayer = useCallback(() => {
    if (playerRef.current) return playerRef.current;
    if (!videoRef.current) {
      console.warn(`[Falix] Step 3a: videoRef.current is null — cannot init video.js yet`);
      return null;
    }

    console.log(`[Falix] Step 3a: Initializing video.js on`, videoRef.current);

    const player = videojs(videoRef.current, {
      autoplay: true,
      controls: true,
      fill: true,
      preload: 'auto',
      html5: {
        nativeAudioTracks: true,
        nativeVideoTracks: true,
      },
    });

    player.ready(() => {
      console.log(`[Falix] Step 3b: video.js ready event fired`);
    });

    playerRef.current = player;
    return player;
  }, []);

  // ── Cleanup video.js on unmount ──
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        console.log(`[Falix] Step 3c: disposing video.js on unmount`);
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, []);

  // ── 4. Discover native audio tracks from the MKV ──
  const discoverAudioTracks = useCallback(
    (entryName: string) => {
      const player = playerRef.current;
      if (!player) {
        console.warn(`[Falix] Step 4a: player null in discoverAudioTracks`);
        return;
      }

      try {
        // Safely access the native HTMLVideoElement
        const tech = (player as any).tech();
        if (!tech || !tech.el) {
          console.warn(`[Falix] Step 4b: tech or tech.el unavailable`);
          return;
        }
        const nativeVideo = tech.el() as HTMLVideoElement;

        // @ts-expect-error — audioTracks is not in HTMLVideoElement TS types
        const nativeTracks: AudioTrackList | undefined = nativeVideo.audioTracks;

        console.log(`[Falix] Step 4c: audioTracks length=${nativeTracks?.length}, entryName=${entryName?.slice(0, 60)}`);

        if (nativeTracks && nativeTracks.length > 0) {
          const parsed = parseAudioLanguages(entryName);
          const labels: string[] = [];

          for (let i = 0; i < nativeTracks.length; i++) {
            const label = parsed[i] || `Track ${i + 1}`;
            console.log(`[Falix] Step 4d: Track ${i}: lang=${nativeTracks[i].language}, label=${nativeTracks[i].label || label}, enabled=${nativeTracks[i].enabled}`);
            labels.push(label);
          }

          setAudioLabels(labels);
          setActiveAudioIdx(0);

          // Enable first track by default, disable others
          for (let i = 0; i < nativeTracks.length; i++) {
            nativeTracks[i].enabled = i === 0;
          }
        } else {
          console.log(`[Falix] Step 4e: No native audio tracks found — fall back to Default`);
          setAudioLabels(['Default']);
        }
      } catch (e) {
        console.warn(`[Falix] Step 4f: audioTracks API error —`, e);
        setAudioLabels(['Default']);
      }
    },
    [],
  );

  // ── 5. Set video source and wire loadedmetadata — lazily inits video.js if needed ──
  useEffect(() => {
    if (!videoUrl) {
      console.log(`[Falix] Step 5a: videoUrl empty — wait for data`);
      return;
    }

    // Lazily initialize video.js if not already done
    const player = playerRef.current || initPlayer();
    if (!player) {
      console.warn(`[Falix] Step 5a: player not available yet`);
      return;
    }

    console.log(`[Falix] Step 5b: Setting video source —`, videoUrl.slice(0, 120));

    // Reset audio state for new source
    setActiveAudioIdx(0);
    setAudioLabels(['Default']);

    const onMeta = () => {
      console.log(`[Falix] Step 5c: loadedmetadata fired — video is ready`);
      onLoad?.();
      discoverAudioTracks(currentEntry?.name || '');
    };

    const onError = () => {
      const videoEl = player.el().querySelector('video');
      const mediaErr = videoEl?.error;
      console.error(`[Falix] Step 5d: video.js error event — code=${mediaErr?.code}, message=${mediaErr?.message}`);
    };

    const onPlay = () => {
      console.log(`[Falix] Step 5e: play event — video started`);
    };

    const onStalled = () => {
      console.warn(`[Falix] Step 5f: stalled event — video buffering`);
    };

    const onWaiting = () => {
      console.warn(`[Falix] Step 5g: waiting event — waiting for data`);
    };

    const onCanPlay = () => {
      console.log(`[Falix] Step 5h: canplay event — enough data to play`);
    };

    player.one('loadedmetadata', onMeta);
    player.one('error', onError);
    player.one('play', onPlay);
    player.on('stalled', onStalled);
    player.on('waiting', onWaiting);
    player.one('canplay', onCanPlay);

    player.src({ src: videoUrl, type: 'video/x-matroska' });

    const playPromise = player.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((e: any) => {
        console.warn(`[Falix] Step 5i: player.play() rejected —`, e?.message || e);
      });
    }

    return () => {
      player.off('loadedmetadata', onMeta);
      player.off('error', onError);
      player.off('play', onPlay);
      player.off('stalled', onStalled);
      player.off('waiting', onWaiting);
      player.off('canplay', onCanPlay);
    };
  }, [videoUrl, onLoad, discoverAudioTracks, currentEntry, initPlayer]);

  // ── 6. Audio track switching ──
  const handleAudioChange = useCallback((index: number) => {
    const player = playerRef.current;
    if (!player) return;

    try {
      const tech = (player as any).tech();
      if (!tech || !tech.el) return;
      const nativeVideo = tech.el() as HTMLVideoElement;

      // @ts-expect-error — audioTracks not typed in HTMLVideoElement
      const nativeTracks: AudioTrackList | undefined = nativeVideo.audioTracks;

      if (nativeTracks && nativeTracks.length > index) {
        for (let i = 0; i < nativeTracks.length; i++) {
          nativeTracks[i].enabled = i === index;
        }
        setActiveAudioIdx(index);

        // Micro-seek to force the browser to apply the new audio track
        const ct = player.currentTime();
        if (typeof ct === 'number' && ct > 0.2) {
          player.currentTime(ct + 0.1);
        }
      }
    } catch {
      // audioTracks API unavailable — no-op
    }
  }, []);

  // ── 7. Quality switching ──
  const handleQualityChange = useCallback((index: number) => {
    setSelectedQualityIdx(index);
  }, []);

  // ── 8. Retry fetch on error ──
  const handleRetry = useCallback(() => {
    console.log(`[Falix] Step 8: Retry triggered for tmdbId=${tmdbId}`);
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    setSelectedQualityIdx(0);
    setActiveAudioIdx(0);
    setAudioLabels(['Default']);

    fetch(`/api/player/falix?id=${tmdbId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Falix API returned ${res.status}`);
        return res.json() as Promise<FalixApiData>;
      })
      .then((data) => {
        setApiData(data);
        setLoading(false);
        loadingRef.current = false;
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
        loadingRef.current = false;
        onError?.();
      });
  }, [tmdbId, onError]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="absolute inset-0 bg-[#070708] z-30 flex flex-col items-center justify-center gap-5">
        <div className="relative w-14 h-14">
          <div className="absolute inset-0 rounded-full border-2 border-[#222226]" />
          <div
            className="absolute inset-0 rounded-full border-t-2 border-[#D4A237] animate-spin"
            style={{ animationDuration: '1.2s' }}
          />
          <div className="absolute inset-3 rounded-full border-2 border-[#222226]" />
          <div className="absolute inset-[18px] rounded-full bg-[#D4A237]/30" />
        </div>
        <p
          className="text-xs font-black text-[#52525B] uppercase tracking-[0.3em] animate-pulse"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Scanning Projection Room
        </p>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#070708] z-40 gap-4 px-6">
        <Clapperboard className="text-[#D4A237]" size={48} strokeWidth={1.5} />
        <p
          className="text-xl text-[#F4F4F5] font-bold text-center"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Projection Reel Snapped
        </p>
        <p className="text-sm text-[#A1A1AA] text-center max-w-xs">
          Couldn&apos;t reach the media source. The server may be offline.
        </p>
        <button
          onClick={handleRetry}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#D4A237] text-[#070708] text-sm font-bold hover:bg-[#B88B2A] transition-colors active:scale-95"
        >
          <RefreshCw size={14} />
          Retry
        </button>
      </div>
    );
  }

  // ── No data state ──
  if (!currentEntry) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0E0E11] z-30 gap-3">
        <p className="text-sm text-[#52525B]">No media available for this selection.</p>
      </div>
    );
  }

  // ── Codec detection gate: HEVC → WebCodecs, H.264 → video.js ──
  const entryIsHevc = currentEntry && !isH264Encoding(currentEntry.name || '');

  // HEVC supported → WebCodecs pipeline
  if (entryIsHevc && hevcSupported === true) {
    return (
      <WebCodecsPlayer
        videoUrl={videoUrl}
        audioLanguages={audioLabels}
        onLoad={onLoad}
        onError={onError}
      />
    );
  }

  // HEVC not supported → show unsupported message with bypass option
  if (entryIsHevc && hevcSupported === false) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#070708] z-40 gap-4 px-6">
        <p
          className="text-xl text-[#F4F4F5] font-bold text-center"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          HEVC Not Supported
        </p>
        <p className="text-sm text-[#A1A1AA] text-center max-w-xs">
          Your browser does not support HEVC decoding. Try selecting an H.264 (x264) quality option instead.
        </p>
        <p className="text-xs text-[#52525B] text-center max-w-sm">
          HEVC WebCodecs is available on macOS Chrome, Android Chrome, and Windows Chrome with the HEVC Video Extensions.
        </p>
        <button
          onClick={() => {
            localStorage.setItem('falix_force_hevc', 'true');
            setHevcSupported(true);
          }}
          className="px-5 py-2.5 rounded-full border border-[#D4A237]/40 text-[#D4A237] text-xs font-bold hover:bg-[#D4A237]/10 transition-colors active:scale-95"
        >
          Try Anyway
        </button>
      </div>
    );
  }

  // HEVC file but still checking support → show loading spinner
  if (entryIsHevc && hevcSupported === null) {
    return (
      <div className="absolute inset-0 bg-[#070708] z-30 flex flex-col items-center justify-center gap-5">
        <div className="relative w-14 h-14">
          <div className="absolute inset-0 rounded-full border-2 border-[#222226]" />
          <div
            className="absolute inset-0 rounded-full border-t-2 border-[#D4A237] animate-spin"
            style={{ animationDuration: '1.2s' }}
          />
          <div className="absolute inset-3 rounded-full border-2 border-[#222226]" />
          <div className="absolute inset-[18px] rounded-full bg-[#D4A237]/30" />
        </div>
        <p
          className="text-xs font-black text-[#52525B] uppercase tracking-[0.3em] animate-pulse"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Checking HEVC Capabilities
        </p>
      </div>
    );
  }

  // Still checking HEVC support (hevcSupported === null) OR H.264 file → use video.js
  // ── Render player with quality + audio overlay ──
  return (
    <>
      {/* video.js player — fills the parent container.
          Wrapped in a positioned div so video.js fill mode gets explicit
          width/height from the container. No absolute positioning on the
          <video> itself — video.js manages that in fill mode. */}
      <div className="absolute inset-0">
        <video
          ref={videoRef}
          className="video-js vjs-big-play-centered vjs-default-skin"
          playsInline
          webkit-playsinline="true"
          onError={(e) => console.error(`[Falix] Native video onError —`, (e.target as HTMLVideoElement)?.error)}
        />
      </div>

      {/* Quality + Audio selector bar — small floating badge, bottom-right */}
      <div className="absolute bottom-14 right-2 z-20 flex flex-col items-end gap-1.5">
        {/* Quality pills */}
        {telegramEntries.length > 1 && (
          <div className="flex items-center gap-1 bg-black/60 backdrop-blur-sm px-2 py-1.5 rounded-lg border border-white/[0.08]">
            <span className="text-[9px] font-bold uppercase tracking-wider text-white/30 mr-1">Q</span>
            {telegramEntries.map((entry, idx) => (
              <button
                key={`q-${idx}`}
                onClick={() => handleQualityChange(idx)}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all active:scale-95 ${
                  selectedQualityIdx === idx
                    ? 'bg-[#D4A237] text-[#070708]'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
              >
                {entry.quality}
              </button>
            ))}
          </div>
        )}

        {/* Audio language pills */}
        {audioLabels.length > 1 && (
          <div className="flex items-center gap-1 bg-black/60 backdrop-blur-sm px-2 py-1.5 rounded-lg border border-white/[0.08]">
            <span className="text-[9px] font-bold uppercase tracking-wider text-white/30 mr-1">A</span>
            {audioLabels.map((lang, idx) => (
              <button
                key={`a-${idx}`}
                onClick={() => handleAudioChange(idx)}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all active:scale-95 ${
                  activeAudioIdx === idx
                    ? 'bg-[#D4A237] text-[#070708]'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
              >
                {lang}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
