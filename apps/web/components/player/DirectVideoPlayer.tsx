/**
 * DirectVideoPlayer — format-agnostic direct-play video player.
 *
 * Unlike iframe-embed providers, this renders a raw <video> / WebCodecs canvas
 * pipeline for providers that serve direct video file URLs. The URL can point
 * to any format: MP4, HLS (.m3u8), DASH (.mpd), MKV (H.264 or HEVC), WebM,
 * AV1, VP8/9, with AAC, MP3, AC-3, E-AC-3, Opus, FLAC audio.
 *
 * Routing logic (per expert consultation doc §Q1):
 *   - HLS (.m3u8)          → video.js with VHS (hls.js) for Chrome; native <video> for Safari
 *   - DASH (.mpd)          → video.js with videojs-contrib-dash
 *   - MP4 / WebM (H.264)   → native <video> element (cheapest path)
 *   - MKV (H.264)          → native <video> with type="video/x-matroska"
 *   - MKV / MP4 (HEVC)     → WebCodecsPlayer (HEVC not natively supported in Chrome)
 *   - AV1 (hardware)       → native <video> if supported; WebCodecs fallback
 *   - Other / unsupported  → error UI with clear message
 *
 * Platform-aware quality selection:
 *   - Windows: prefer x264 (HEVC hardware decode limited / requires HEVC Video Extensions)
 *   - Android: allow both x264 and HEVC
 *   - macOS: native HEVC support via system codecs
 */

"use client";

import React, {
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { Clapperboard, RefreshCw } from "lucide-react";
import videojs from "video.js";
import "video.js/dist/video-js.css";
import { PlayerShell } from "./PlayerShell";
import { WebCodecsPlayerWithControls } from "./WebCodecsPlayerWithControls";
import { NativePlayerAdapter, VideoJSPlayerAdapter } from "./player-adapters";
import { MpvPlayerAdapter } from "./MpvPlayerAdapter";
import {
  detectFormat,
  selectDecoder,
  checkHevcSupport,
  checkAV1Support,
  canPlayNatively,
  isHevcEncoding,
  isWindowsPlatform,
  type DetectedFormat,
  type DecoderType,
} from "@/lib/formatDetection";
import { apiUrl } from "@/lib/tmdb";

// ── Types ─────────────────────────────────────────────────────────

interface DirectVideoEntry {
  quality: string;
  id: string;
  name: string;
  size?: string;
  url: string; // Direct video URL — could be .mp4, .m3u8, .mpd, .mkv, etc.
  type: string; // Container type: "mkv" | "mp4" | etc.
  _meta?: {
    codec: string;
    audio: string;
    source: string;
    isDownloadOnly: boolean;
    isWebReady: boolean;
    sizeBytes?: number;
  };
}

interface DirectApiData {
  tmdb_id: number;
  imdb_id?: string;
  media_type: string;
  // For TV — seasons with episodes, each containing direct links
  seasons?: Array<{
    season_number: number;
    episodes: Array<{
      episode_number: number;
      title: string;
      links: DirectVideoEntry[];
    }>;
  }>;
  // For movies — direct links
  links?: DirectVideoEntry[];
}

interface DirectVideoPlayerProps {
  /** TMDB content ID */
  tmdbId: string;
  /** Media type: movie or tv */
  mediaType: "movie" | "tv";
  /** Current season (TV only) */
  selectedSeason?: number;
  /** Current episode (TV only) */
  activeEpisode?: number;
  /** Called when video starts playing */
  onLoad?: () => void;
  /** Called on error */
  onError?: () => void;
}

// ── Component ─────────────────────────────────────────────────────

export function DirectVideoPlayer({
  tmdbId,
  mediaType,
  selectedSeason = 1,
  activeEpisode = 1,
  onLoad,
  onError,
}: DirectVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null);
  const loadingRef = useRef(false);

  // Adapter refs for ControlBar integration
  const nativeAdapterRef = useRef<NativePlayerAdapter | null>(null);
  const videojsAdapterRef = useRef<VideoJSPlayerAdapter | null>(null);
  const mpvAdapterRef = useRef<MpvPlayerAdapter | null>(null);
  const mpvContainerRef = useRef<HTMLDivElement | null>(null);
  const [nativeAdapter, setNativeAdapter] =
    useState<NativePlayerAdapter | null>(null);
  const [videojsAdapter, setVideojsAdapter] =
    useState<VideoJSPlayerAdapter | null>(null);
  const [mpvAdapter, setMpvAdapter] = useState<MpvPlayerAdapter | null>(null);

  const [apiData, setApiData] = useState<DirectApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedQualityIdx, setSelectedQualityIdx] = useState(0);
  const [hevcSupported, setHevcSupported] = useState<boolean | null>(null);
  const [av1Supported, setAv1Supported] = useState<boolean | null>(null);
  const [detectedFormat, setDetectedFormat] = useState<DetectedFormat | null>(
    null,
  );
  const [decoder, setDecoder] = useState<DecoderType | null>(null);

  // ── 1. Fetch metadata from Direct API proxy ──
  useEffect(() => {
    let cancelled = false;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    setSelectedQualityIdx(0);

    console.log(
      `[Direct] Fetching metadata for tmdbId=${tmdbId}, mediaType=${mediaType}, season=${selectedSeason}, episode=${activeEpisode}`,
    );

    const params = new URLSearchParams({ id: tmdbId });
    if (mediaType === "tv") {
      params.set("season", String(selectedSeason));
      params.set("episode", String(activeEpisode));
    }
    fetch(apiUrl(`/api/player/direct?${params.toString()}`))
      .then((res) => {
        if (!res.ok) throw new Error(`Direct API returned ${res.status}`);
        return res.json() as Promise<DirectApiData>;
      })
      .then((data) => {
        if (cancelled) return;
        console.log(`[Direct] API data received`, {
          tmdb_id: data.tmdb_id,
          has_links: !!data.links,
          has_seasons: !!data.seasons,
        });
        setApiData(data);
        setLoading(false);
        loadingRef.current = false;
      })
      .catch((err: Error) => {
        if (cancelled) return;
        console.error(`[Direct] API fetch failed —`, err.message);
        setError(err.message);
        setLoading(false);
        loadingRef.current = false;
        onError?.();
      });

    return () => {
      cancelled = true;
    };
  }, [tmdbId, mediaType, selectedSeason, activeEpisode, onError]);

  // ── 1b. Detect codec support ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [hevc, av1] = await Promise.all([
        checkHevcSupport(),
        checkAV1Support(),
      ]);
      if (!cancelled) {
        setHevcSupported(hevc);
        setAv1Supported(av1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── 2. Resolve video entries for current media/episode ──
  const videoEntries: DirectVideoEntry[] = useMemo(() => {
    if (!apiData) return [];

    let entries: DirectVideoEntry[];

    if (mediaType === "movie" || apiData.media_type === "movie") {
      entries = apiData.links || [];
    } else if (apiData.links) {
      // TV with server-side resolution — API already filters by season/episode
      entries = apiData.links;
    } else if (apiData.seasons) {
      const season = apiData.seasons.find(
        (s) => s.season_number === selectedSeason,
      );
      if (!season) return [];
      const episode = season.episodes.find(
        (e) => e.episode_number === activeEpisode,
      );
      entries = episode?.links || [];
    } else {
      return [];
    }

    // Sort: H.264 (x264/AVC) before HEVC (x265/HEVC) for browser compatibility.
    const onWindows = isWindowsPlatform();

    return entries.sort((a, b) => {
      const aHevc = a._meta
        ? a._meta.codec === "hevc"
          ? 1
          : 0
        : isHevcEncoding(a.name)
          ? 1
          : 0;
      const bHevc = b._meta
        ? b._meta.codec === "hevc"
          ? 1
          : 0
        : isHevcEncoding(b.name)
          ? 1
          : 0;
      if (aHevc !== bHevc) {
        return onWindows ? aHevc - bHevc : bHevc - aHevc;
      }
      return 0;
    });
  }, [apiData, mediaType, selectedSeason, activeEpisode]);

  // Current entry (based on selected quality)
  const currentEntry =
    videoEntries.length > 0
      ? videoEntries[Math.min(selectedQualityIdx, videoEntries.length - 1)]
      : null;

  // ── Native video loading (single effect, decoder-gated) ──
  // Root cause fix: mount effect ran before video element existed (decoder=null),
  // reload effect didn't re-run when decoder finally became "native".
  // Solution: single effect with [decoder, currentEntry?.url] deps.
  const lastLoadedUrlRef = useRef<string>("");
  useEffect(() => {
    // Only run for native decoder path
    if (decoder !== "native") return;

    const vid = videoRef.current;
    if (!vid || !currentEntry) return;

    // Create adapter if missing — not in onCanPlay (may never fire)
    if (!nativeAdapterRef.current) {
      const adapter = new NativePlayerAdapter(vid);
      nativeAdapterRef.current = adapter;
      setNativeAdapter(adapter);
    }

    const newUrl = currentEntry.url;
    if (lastLoadedUrlRef.current === newUrl) return;

    console.log(`[Direct] Loading source: ${currentEntry.name}`);
    console.log(`[Direct] URL: ${newUrl}`);
    vid.src = newUrl;
    vid.load();
    vid.play().catch((err) => {
      console.log("[Direct] Play blocked (needs interaction):", err.message);
    });
    lastLoadedUrlRef.current = newUrl;
  }, [decoder, currentEntry?.url]);

  // ── 3. Format detection + decoder selection ──
  useEffect(() => {
    if (!currentEntry) {
      console.log(`[Direct] format-detect: no currentEntry`);
      return;
    }
    let cancelled = false;
    console.log(
      `[Direct] format-detect: entry="${currentEntry.name}" type="${currentEntry.type}" meta=${!!currentEntry._meta}`,
    );

    (async () => {
      let fmt: DetectedFormat;

      if (currentEntry._meta) {
        const type =
          currentEntry._meta?.codec === "hevc"
            ? "mkv"
            : (currentEntry.type as DetectedFormat["type"]);
        fmt = {
          type: type === "mkv" ? "mkv" : type === "mp4" ? "mp4" : "unknown",
          container:
            type === "mkv" ? "Matroska" : type === "mp4" ? "MP4" : "unknown",
          videoCodec: currentEntry._meta.codec === "hevc" ? "hevc" : "h264",
          audioCodec: undefined,
          confidence: "high",
        };
        console.log(
          `[Direct] format-detect: from meta → type=${fmt.type} codec=${fmt.videoCodec}`,
        );
      } else {
        try {
          fmt = await detectFormat(currentEntry.url);
          console.log(`[Direct] format-detect: from URL → type=${fmt.type}`);
        } catch (e) {
          console.warn("[Direct] Format detection failed:", e);
          fmt = { type: "unknown", container: "unknown", confidence: "low" };
        }
      }

      if (cancelled) return;
      setDetectedFormat(fmt);

      console.log(`[Direct] format-detect: calling selectDecoder...`);
      const dec = await selectDecoder(fmt, currentEntry.name);
      console.log(`[Direct] format-detect: decoder = ${dec}`);
      if (!cancelled) setDecoder(dec);
    })();

    return () => {
      cancelled = true;
    };
  }, [currentEntry?.url, currentEntry?.name]);

  // ── 4. video.js lifecycle (for HLS/DASH) ──
  useEffect(() => {
    if (decoder !== "videojs" || !videoRef.current) return;

    const player = videojs(videoRef.current, {
      autoplay: true,
      controls: true,
      fill: true,
      preload: "auto",
      html5: {
        vhs: {
          overrideNative: true,
        },
        nativeAudioTracks: true,
        nativeVideoTracks: true,
      },
    });

    playerRef.current = player;

    player.ready(() => {
      setVideojsAdapter(new VideoJSPlayerAdapter(player));
      onLoad?.();
    });

    player.on("error", () => {
      onError?.();
    });

    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
        setVideojsAdapter(null);
      }
    };
  }, [decoder, currentEntry?.url, onLoad, onError]);

  // ── 4b. mpv engine lifecycle (desktop only) ──
  useEffect(() => {
    if (decoder !== "mpv" || !currentEntry) return;

    console.log(
      `[Direct] mpv lifecycle: decoder=${decoder} entry=${currentEntry.name} url=${currentEntry.url?.slice(0, 80)}`,
    );
    let cancelled = false;

    (async () => {
      const mpv = (window as any).electronAPI?.mpv;
      if (!mpv) {
        console.error(
          "[Direct] mpv decoder selected but electronAPI.mpv not available",
        );
        return;
      }
      console.log("[Direct] mpv: electronAPI.mpv available");

      // Create adapter if not yet created
      if (!mpvAdapterRef.current) {
        console.log("[Direct] mpv: creating MpvPlayerAdapter");
        const adapter = new MpvPlayerAdapter();
        mpvAdapterRef.current = adapter;
        if (!cancelled) setMpvAdapter(adapter);
      }

      try {
        console.log("[Direct] mpv: calling start()...");
        const startResult = await mpv.start();
        console.log("[Direct] mpv: start() returned:", startResult);
        if (cancelled) return;

        // Set initial bounds BEFORE playing — window must be sized correctly
        const container = mpvContainerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const bounds = {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
          console.log("[Direct] mpv: setting initial bounds:", bounds);
          await mpv.setVideoBounds(bounds);
        }

        console.log(
          `[Direct] mpv: calling play() with url: ${currentEntry.url?.slice(0, 120)}`,
        );
        await mpv.play(currentEntry.url);
        console.log("[Direct] mpv: play() resolved, calling onLoad");
        onLoad?.();
      } catch (err) {
        console.error("[Direct] mpv playback failed:", err);
        if (!cancelled) onError?.();
      }
    })();

    return () => {
      cancelled = true;
      console.log("[Direct] mpv lifecycle cleanup");
      mpvAdapterRef.current?.destroy();
      mpvAdapterRef.current = null;
      setMpvAdapter(null);
    };
  }, [decoder, currentEntry?.url, onLoad, onError]);

  // ── 4c. mpv video window bounds tracking ──
  useEffect(() => {
    if (decoder !== "mpv" || !mpvAdapter) return;

    const container = mpvContainerRef.current;
    if (!container) return;

    const mpv = (window as any).electronAPI?.mpv;
    if (!mpv) return;

    function updateBounds() {
      const rect = container!.getBoundingClientRect();
      const bounds = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      console.log("[Direct] mpv setVideoBounds:", bounds);
      mpv.setVideoBounds(bounds);
    }

    // Initial bounds (and rAF tick for post-reflow alignment)
    updateBounds();
    const rafId = requestAnimationFrame(updateBounds);

    // Track size/position changes
    const ro = new ResizeObserver(updateBounds);
    ro.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [decoder, mpvAdapter]);

  // ── 5. Render ──

  if (loading) {
    return (
      <div className="absolute inset-0 bg-[#070708] z-30 flex flex-col items-center justify-center gap-5">
        <div className="relative w-14 h-14">
          <div className="absolute inset-0 rounded-full border-2 border-[#222226]" />
          <div
            className="absolute inset-0 rounded-full border-t-2 border-[#D4A237] animate-spin"
            style={{ animationDuration: "1.2s" }}
          />
          <div className="absolute inset-3 rounded-full border-2 border-[#222226]" />
          <div className="absolute inset-[18px] rounded-full bg-[#D4A237]/30" />
        </div>
        <p
          className="text-xs font-black text-faint uppercase tracking-[0.3em] animate-pulse"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Scanning Projection Room
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#070708] z-40 gap-4 px-6">
        <Clapperboard className="text-[#D4A237]" size={48} strokeWidth={1.5} />
        <p
          className="text-xl text-foreground font-bold text-center"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Projection Reel Snapped
        </p>
        <p className="text-sm text-muted-foreground text-center max-w-xs">
          Couldn&apos;t reach the media source. The server may be offline.
        </p>
        <button
          onClick={() => {
            loadingRef.current = true;
            setLoading(true);
            setError(null);
            setSelectedQualityIdx(0);
          }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#D4A237] text-[#070708] text-sm font-bold hover:bg-[#B88B2A] transition-colors active:scale-95"
        >
          <RefreshCw size={14} />
          Retry
        </button>
      </div>
    );
  }

  if (!currentEntry) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0E0E11] z-30 gap-3">
        <p className="text-sm text-faint">
          No media available for this selection.
        </p>
      </div>
    );
  }

  // While format is being detected, show a brief sub-loading state
  if (!detectedFormat || decoder === null) {
    return (
      <div className="absolute inset-0 bg-[#070708] z-30 flex flex-col items-center justify-center gap-5">
        <div className="relative w-14 h-14">
          <div className="absolute inset-0 rounded-full border-2 border-[#222226]" />
          <div
            className="absolute inset-0 rounded-full border-t-2 border-[#D4A237] animate-spin"
            style={{ animationDuration: "1.2s" }}
          />
          <div className="absolute inset-3 rounded-full border-2 border-[#222226]" />
          <div className="absolute inset-[18px] rounded-full bg-[#D4A237]/30" />
        </div>
        <p
          className="text-xs font-black text-faint uppercase tracking-[0.3em] animate-pulse"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Scanning Projection Room
        </p>
      </div>
    );
  }

  // ── Decoder routing ──

  const entryIsHevc = currentEntry._meta
    ? currentEntry._meta.codec === "hevc"
    : isHevcEncoding(currentEntry.name);
  const onWindows = isWindowsPlatform();

  // ── mpv engine (desktop — MKV, AVI, MPEG-TS, HEVC) ──
  if (decoder === "mpv" && mpvAdapter) {
    return (
      <div
        className="relative w-full h-full min-h-[360px]"
        ref={mpvContainerRef}
        data-mpv-player
      >
        <PlayerShell
          player={mpvAdapter}
          qualities={videoEntries as any[]}
          onQualityChange={(q) => {
            console.log(`[Direct] Quality changed → ${q.quality} (${q.id})`);
            const idx = videoEntries.findIndex((e) => e.id === q.id);
            if (idx >= 0) setSelectedQualityIdx(idx);
          }}
        >
          {/* mpv renders to a native child window — transparent placeholder for overlay */}
          <div className="absolute inset-0 bg-transparent" />
        </PlayerShell>
        {/* Debug badge */}
        <div className="absolute top-3 left-3 z-50 bg-black/80 text-[10px] text-[#D4A237] font-mono px-2.5 py-1.5 rounded-md border border-[#D4A237]/20 max-w-[90%] pointer-events-none">
          <div className="font-bold truncate">
            mpv · {currentEntry.name || currentEntry.quality}
          </div>
          <div className="text-white/40 truncate">{currentEntry.url}</div>
        </div>
      </div>
    );
  }

  // HEVC + supported → WebCodecs pipeline with PlayerShell
  if (entryIsHevc && hevcSupported === true) {
    return (
      <WebCodecsPlayerWithControls
        videoUrl={currentEntry.url}
        audioLanguages={["Default"]}
        onLoad={onLoad}
        onError={onError}
        qualities={videoEntries as any[]}
        onQualityChange={(q) => {
          const idx = videoEntries.findIndex((e) => e.id === q.id);
          if (idx >= 0) setSelectedQualityIdx(idx);
        }}
      />
    );
  }

  // HEVC + NOT supported → show unsupported message with guidance
  if (entryIsHevc && hevcSupported === false) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#070708] z-40 gap-4 px-6">
        <p
          className="text-xl text-foreground font-bold text-center"
          style={{ fontFamily: "var(--font-display)" }}
        >
          HEVC Not Supported
        </p>
        <p className="text-sm text-muted-foreground text-center max-w-xs">
          Your browser or platform does not support HEVC (x265) decoding.{" "}
          {onWindows
            ? "Install the HEVC Video Extensions from the Microsoft Store, or select an H.264 quality."
            : "Try selecting a different quality or source."}
        </p>
        <p className="text-xs text-faint text-center max-w-sm">
          HEVC WebCodecs is available on macOS Chrome, Android Chrome, and
          Windows Chrome with the HEVC Video Extensions.
        </p>
        <button
          onClick={() => {
            const stored =
              typeof window !== "undefined"
                ? localStorage.getItem("direct_force_hevc")
                : null;
            if (stored === "true") {
              setHevcSupported(true);
            } else {
              localStorage.setItem("direct_force_hevc", "true");
              setHevcSupported(true);
            }
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
            style={{ animationDuration: "1.2s" }}
          />
          <div className="absolute inset-3 rounded-full border-2 border-[#222226]" />
          <div className="absolute inset-[18px] rounded-full bg-[#D4A237]/30" />
        </div>
        <p
          className="text-xs font-black text-faint uppercase tracking-[0.3em] animate-pulse"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Checking HEVC Capabilities
        </p>
      </div>
    );
  }

  // ── MKV (non-Safari) → WebCodecsPlayer ──
  if (
    decoder === "webcodecs" &&
    (detectedFormat.type === "mkv" || entryIsHevc)
  ) {
    return (
      <div className="relative">
        <WebCodecsPlayerWithControls
          videoUrl={currentEntry.url}
          audioLanguages={["Default"]}
          onLoad={onLoad}
          onError={onError}
          qualities={videoEntries as any[]}
          onQualityChange={(q) => {
            console.log(`[Direct] Quality changed → ${q.quality} (${q.id})`);
            const idx = videoEntries.findIndex((e) => e.id === q.id);
            if (idx >= 0) setSelectedQualityIdx(idx);
          }}
        />
        {/* Debug badge */}
        <div className="absolute top-3 left-3 z-50 bg-black/80 text-[10px] text-[#D4A237] font-mono px-2.5 py-1.5 rounded-md border border-[#D4A237]/20 max-w-[90%] pointer-events-none">
          <div className="font-bold truncate">
            {currentEntry.name || currentEntry.quality}
          </div>
          <div className="text-white/40 truncate">{currentEntry.url}</div>
        </div>
      </div>
    );
  }

  // ── HLS → video.js (VHS/hls.js) ──
  if (detectedFormat.type === "hls" && decoder === "videojs") {
    return (
      <PlayerShell
        player={videojsAdapter}
        qualities={videoEntries as any[]}
        onQualityChange={(q) => {
          console.log(`[Direct] Quality changed → ${q.quality} (${q.id})`);
          const idx = videoEntries.findIndex((e) => e.id === q.id);
          if (idx >= 0) setSelectedQualityIdx(idx);
        }}
      >
        <video
          ref={videoRef}
          className="video-js vjs-default-skin"
          playsInline
          webkit-playsinline="true"
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          controls={false}
          autoPlay
        />
        {/* Debug badge */}
        <div className="absolute top-3 left-3 z-50 bg-black/80 text-[10px] text-[#D4A237] font-mono px-2.5 py-1.5 rounded-md border border-[#D4A237]/20 max-w-[90%] pointer-events-none">
          <div className="font-bold truncate">
            {currentEntry.name || currentEntry.quality}
          </div>
          <div className="text-white/40 truncate">{currentEntry.url}</div>
        </div>
      </PlayerShell>
    );
  }

  // ── DASH → video.js (contrib-dash) ──
  if (detectedFormat.type === "dash" && decoder === "videojs") {
    return (
      <PlayerShell
        player={videojsAdapter}
        qualities={videoEntries as any[]}
        onQualityChange={(q) => {
          console.log(`[Direct] Quality changed → ${q.quality} (${q.id})`);
          const idx = videoEntries.findIndex((e) => e.id === q.id);
          if (idx >= 0) setSelectedQualityIdx(idx);
        }}
      >
        <video
          ref={videoRef}
          className="video-js vjs-default-skin"
          playsInline
          webkit-playsinline="true"
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          controls={false}
          autoPlay
        />
        {/* Debug badge */}
        <div className="absolute top-3 left-3 z-50 bg-black/80 text-[10px] text-[#D4A237] font-mono px-2.5 py-1.5 rounded-md border border-[#D4A237]/20 max-w-[90%] pointer-events-none">
          <div className="font-bold truncate">
            {currentEntry.name || currentEntry.quality}
          </div>
          <div className="text-white/40 truncate">{currentEntry.url}</div>
        </div>
      </PlayerShell>
    );
  }

  // ── Unsupported format ──
  if (decoder === "unsupported") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#070708] z-40 gap-4 px-6">
        <Clapperboard className="text-[#D4A237]" size={48} strokeWidth={1.5} />
        <p
          className="text-xl text-foreground font-bold text-center"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Format Not Supported
        </p>
        <p className="text-sm text-muted-foreground text-center max-w-xs">
          Container: {detectedFormat.container}
          {entryIsHevc && " · HEVC (x265)"}.{" "}
          {onWindows
            ? "Windows cannot decode this format natively. Try an H.264 source."
            : "This format is not playable in your browser."}
        </p>
      </div>
    );
  }

  // ── Native <video> for MP4 / WebM / MKV (H.264) ──
  let videoSrcType: string | undefined;
  switch (detectedFormat.type) {
    case "mp4":
      videoSrcType = "video/mp4";
      break;
    case "webm":
      videoSrcType = "video/webm";
      break;
    case "mkv":
      videoSrcType = "video/x-matroska";
      break;
    case "hls":
      videoSrcType = "application/vnd.apple.mpegurl";
      break;
    case "dash":
      videoSrcType = "application/dash+xml";
      break;
  }

  return (
    <PlayerShell
      player={nativeAdapter}
      qualities={videoEntries as any[]}
      onQualityChange={(q) => {
        const idx = videoEntries.findIndex((e) => e.id === q.id);
        console.log(
          `[Direct] Quality changed → "${q.quality}" id="${q.id}" → findIndex=${idx} (entries: ${videoEntries.map((e) => e.id).join(", ")})`,
        );
        if (idx >= 0) setSelectedQualityIdx(idx);
        else console.warn(`[Direct] Could not find entry with id="${q.id}"`);
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <video
          ref={videoRef}
          playsInline
          webkit-playsinline="true"
          onLoadStart={() => {
            console.log("[Direct] Video load started");
            onLoad?.();
          }}
          onError={(e) => {
            console.error("[Direct] Video error:", e);
            onError?.();
          }}
          onCanPlay={() => {
            console.log("[Direct] Video can play");
          }}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          controls={false}
        />
      </div>

      {/* Debug badge — shows which link is playing */}
      <div className="absolute top-3 left-3 z-50 bg-black/80 text-[10px] text-[#D4A237] font-mono px-2.5 py-1.5 rounded-md border border-[#D4A237]/20 max-w-[90%] pointer-events-none">
        <div className="font-bold truncate">
          {currentEntry.name || currentEntry.quality}
        </div>
        <div className="text-white/40 truncate">{currentEntry.url}</div>
      </div>
    </PlayerShell>
  );
}
