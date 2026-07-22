/**
 * WebCodecsPlayer — HEVC/x265 playback using the WebCodecs API.
 *
 * Pipeline:
 *   fetch(videoUrl) → ReadableStream → StreamingMkvParser
 *     → Tracks parsed → configure VideoDecoder + AudioDecoder
 *     → Blocks arrive → decode → VideoFrame → <canvas>
 *                          → AudioData → AudioContext → speakers
 *   → A/V sync via audio-clock vs frame timestamps
 *   → Custom controls overlay (play/pause, seek, volume, fullscreen)
 *
 * Used by FalixPlayer when the selected entry is HEVC-encoded.
 * Falls back to standard <video> for H.264.
 */

'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Languages,
} from 'lucide-react';
import {
  StreamingMkvParser,
  type TrackMeta,
  type ParsedBlock,
  getVideoCodecCandidates,
  mapAudioCodec,
} from '@/lib/streamingMkvParser';

// ── ISO 639-2 → display language ──────────────────────────────────

const ISO_LANG_MAP: Record<string, string> = {
  hin: 'Hindi',
  tam: 'Tamil',
  tel: 'Telugu',
  eng: 'English',
  jpn: 'Japanese',
  kor: 'Korean',
  spa: 'Spanish',
  fre: 'French',
  ger: 'German',
  por: 'Portuguese',
  rus: 'Russian',
  ara: 'Arabic',
  ben: 'Bengali',
  pun: 'Punjabi',
  mar: 'Marathi',
  guj: 'Gujarati',
  kan: 'Kannada',
  mal: 'Malayalam',
};

function displayLang(code: string): string {
  return ISO_LANG_MAP[code] || code.toUpperCase();
}

// ── Types ──────────────────────────────────────────────────────────

type PlayerStatus = 'loading' | 'ready' | 'playing' | 'paused' | 'error';

interface WebCodecsPlayerProps {
  videoUrl: string;
  /** Pre-parsed language names from filename (used if MKV metadata lacks them) */
  audioLanguages?: string[];
  onLoad?: () => void;
  onError?: () => void;
}

// ── Component ──────────────────────────────────────────────────────

export function WebCodecsPlayer({
  videoUrl,
  audioLanguages,
  onLoad,
  onError,
}: WebCodecsPlayerProps) {
  // ── UI state ──
  const [status, setStatus] = useState<PlayerStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [audioTracks, setAudioTracks] = useState<TrackMeta[]>([]);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [showLangPicker, setShowLangPicker] = useState(false);

  // ── Refs (mutable values shared with callbacks) ──
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoDecoderRef = useRef<VideoDecoder | null>(null);
  const audioDecoderRef = useRef<AudioDecoder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const parserRef = useRef<StreamingMkvParser | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const animFrameRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameQueueRef = useRef<VideoFrame[]>([]);
  const isPausedRef = useRef(true);
  const selectedTrackRef = useRef(0);
  const baseAudioTimeRef = useRef(0);
  const firstAudioTsRef = useRef(-1);
  const nextAudioTimeRef = useRef(0);
  const playStartRef = useRef(0);
  const currentTimeRef = useRef(0);
  const volumeRef = useRef(1);
  const isMutedRef = useRef(false);
  const mountedRef = useRef(true);

  // ── Language mapping from filename (fallback) ──
  const [filenameLanguages, setFilenameLanguages] = useState<string[]>([]);

  // ── Helpers ──────────────────────────────────────────────────────

  const handleError = useCallback(
    (msg: string) => {
      if (!mountedRef.current) return;
      console.error('[WebCodecs] Error:', msg);
      setStatus('error');
      setErrorMessage(msg);
      onError?.();
    },
    [onError],
  );

  // ── Decoder configuration ──

  const configureVideoDecoder = useCallback(
    async (track: TrackMeta) => {
      if (!mountedRef.current) return;

      const codecCandidates = getVideoCodecCandidates(track.codecId);
      let chosenCodec = '';
      let codecConfig: VideoDecoderConfig | null = null;

      // Try codec candidates in order — Chrome/Brave HEVC support depends
      // on the exact codec string matching the installed HEVC Video Extensions
      for (const codec of codecCandidates) {
        if (!mountedRef.current) return;
        const config: VideoDecoderConfig = { codec };

        if (track.codecPrivate && track.codecPrivate.byteLength > 0) {
          config.description = track.codecPrivate;
        }
        if (track.width) config.codedWidth = track.width;
        if (track.height) config.codedHeight = track.height;

        try {
          const supported = await VideoDecoder.isConfigSupported(config);
          console.log(`[WebCodecs] Codec "${codec}" → ${supported.supported}`);
          if (supported.supported) {
            chosenCodec = codec;
            codecConfig = config;
            break;
          }
        } catch (e) {
          console.warn(`[WebCodecs] Codec "${codec}" check threw:`, e);
        }
      }

      if (!chosenCodec) {
        // Fallback: try to configure the decoder directly with the first candidate.
        // Some browser implementations (Brave/Chrome with HEVC extensions)
        // fail isConfigSupported() but succeed at actual configuration
        // when codecPrivate is present.
        console.warn(
          '[WebCodecs] All isConfigSupported() failed — trying direct configure with first candidate + codecPrivate',
          track.codecId,
        );
        const fallbackConfig: VideoDecoderConfig = {
          codec: codecCandidates[0],
        };
        if (track.codecPrivate && track.codecPrivate.byteLength > 0) {
          fallbackConfig.description = track.codecPrivate;
        } else {
          throw new Error(
            `No supported HEVC codec found and no codecPrivate available for fallback. Tried: ${codecCandidates.join(', ')}`,
          );
        }
        if (track.width) fallbackConfig.codedWidth = track.width;
        if (track.height) fallbackConfig.codedHeight = track.height;
        chosenCodec = codecCandidates[0];
        codecConfig = fallbackConfig;
      }

      console.log('[WebCodecs] Configuring VideoDecoder:', chosenCodec, track.width, track.height);

      const decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          frameQueueRef.current.push(frame);
          scheduleRender();
        },
        error: (e) => handleError(`VideoDecoder error: ${e.message}`),
      });

      try {
        decoder.configure(codecConfig!);
      } catch (e) {
        throw new Error(
          `VideoDecoder configure() threw: ${e instanceof DOMException ? e.message : String(e)}`,
        );
      }
      videoDecoderRef.current = decoder;
      console.log('[WebCodecs] VideoDecoder configured');

      // Once video decoder is ready, try auto-play
      if (status === 'loading') {
        setStatus('ready');
        onLoad?.();
      }
    },
    [handleError, onLoad, status],
  );

  const configureAudioDecoder = useCallback(
    async (track: TrackMeta) => {
      if (!mountedRef.current) return;

      const codec = mapAudioCodec(track.codecId);
      const config: AudioDecoderConfig = {
        codec,
        sampleRate: track.sampleRate || 48000,
        numberOfChannels: track.channels || 2,
      };

      if (track.codecPrivate && track.codecPrivate.byteLength > 0) {
        config.description = track.codecPrivate;
      }

      console.log('[WebCodecs] Configuring AudioDecoder:', codec, track.sampleRate, track.channels);

      try {
        const supported = await AudioDecoder.isConfigSupported(config);
        if (!supported.supported) {
          console.warn('[WebCodecs] AudioDecoder not supported, falling back to AudioContext only');
          return;
        }
      } catch {
        console.warn('[WebCodecs] AudioDecoder config check failed, using AudioContext only');
        return;
      }

      const decoder = new AudioDecoder({
        output: (audioData: AudioData) => {
          scheduleAudio(audioData);
        },
        error: (e) => console.warn('[WebCodecs] AudioDecoder error:', e.message),
      });

      try {
        decoder.configure(config);
      } catch (e) {
        console.warn('[WebCodecs] AudioDecoder configure() threw — using AudioContext only:', e);
        return;
      }
      audioDecoderRef.current = decoder;
      console.log('[WebCodecs] AudioDecoder configured');
    },
    [],
  );

  // ── Audio scheduling ──

  const scheduleAudio = useCallback((audioData: AudioData) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    try {
      const source = ctx.createBufferSource();
      const buffer = ctx.createBuffer(
        audioData.numberOfChannels,
        audioData.numberOfFrames,
        audioData.sampleRate,
      );

      for (let ch = 0; ch < audioData.numberOfChannels; ch++) {
        const dst = buffer.getChannelData(ch);
        audioData.copyTo(dst, { planeIndex: ch });
      }

      source.buffer = buffer;

      // Volume
      const gain = ctx.createGain();
      gain.gain.value = isMutedRef.current ? 0 : volumeRef.current;
      source.connect(gain);
      gain.connect(ctx.destination);

      // Calculate schedule time based on the audio data's timestamp
      if (firstAudioTsRef.current < 0) {
        firstAudioTsRef.current = audioData.timestamp;
        baseAudioTimeRef.current = ctx.currentTime;
      }

      const offsetSec = (audioData.timestamp - firstAudioTsRef.current) / 1_000_000;
      const when = baseAudioTimeRef.current + offsetSec;

      // Don't schedule in the past
      const scheduleAt = Math.max(when, ctx.currentTime + 0.005);
      source.start(scheduleAt);
      nextAudioTimeRef.current = scheduleAt + buffer.duration;

      audioData.close();
    } catch (e) {
      console.warn('[WebCodecs] Audio scheduling error:', e);
      audioData.close();
    }
  }, []);

  // ── Render loop ──

  const scheduleRender = useCallback(() => {
    if (animFrameRef.current) return;
    animFrameRef.current = requestAnimationFrame(renderLoop);
  }, []);

  const renderLoop = useCallback(() => {
    animFrameRef.current = 0;

    const ctx = canvasCtxRef.current;
    const canvas = canvasRef.current;
    const frameQueue = frameQueueRef.current;
    if (!ctx || !canvas) return;

    // Compute audio position
    let audioPos = 0;
    const audioCtx = audioCtxRef.current;
    if (audioCtx && firstAudioTsRef.current >= 0) {
      if (audioCtx.state === 'running') {
        audioPos = audioCtx.currentTime - baseAudioTimeRef.current;
      }
    }

    // Drain frame queue — find the frame for current audio position
    let rendered = false;
    while (frameQueue.length > 0) {
      const frame = frameQueue[0];
      const frameSec = frame.timestamp / 1_000_000;

      if (frameSec < audioPos - 0.12) {
        // Frame is too late — drop
        frame.close();
        frameQueue.shift();
        continue;
      }

      if (frameSec > audioPos + 0.08 && audioPos > 0) {
        // Frame is in the future — wait
        break;
      }

      // Render this frame
      canvas.width = frame.codedWidth;
      canvas.height = frame.codedHeight;
      ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      frame.close();
      frameQueue.shift();
      rendered = true;
      break;
    }

    // Update UI time
    currentTimeRef.current = audioPos > 0 ? audioPos : 0;

    // Schedule next frame if playing
    const isPaused = isPausedRef.current;
    if (
      !isPaused &&
      (videoDecoderRef.current?.decodeQueueSize ?? 0) > 0
    ) {
      animFrameRef.current = requestAnimationFrame(renderLoop);
    } else if (frameQueue.length > 0) {
      animFrameRef.current = requestAnimationFrame(renderLoop);
    }

    // Sync currentTime to React state periodically (every ~250ms)
    if (!isPaused && Math.floor(audioPos * 4) !== Math.floor(currentTime * 4)) {
      setCurrentTime(audioPos);
    }
  }, []);

  // ── Play/Pause/Seek ──

  const togglePlay = useCallback(() => {
    if (status === 'ready' || status === 'paused') {
      // Start playing
      isPausedRef.current = false;
      setStatus('playing');

      const ctx = audioCtxRef.current;
      if (ctx?.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      // Start render loop
      scheduleRender();
    } else if (status === 'playing') {
      // Pause
      isPausedRef.current = true;
      setStatus('paused');
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = 0;
      }
    }
  }, [status, scheduleRender]);

  const seek = useCallback((targetSeconds: number) => {
    // Flush decoders
    videoDecoderRef.current?.flush();
    audioDecoderRef.current?.flush();

    // Clear frame queue
    for (const f of frameQueueRef.current) f.close();
    frameQueueRef.current = [];

    // Reset audio sync
    firstAudioTsRef.current = -1;
    baseAudioTimeRef.current = 0;
    nextAudioTimeRef.current = 0;

    const ctx = audioCtxRef.current;
    if (ctx) {
      // Close and recreate AudioContext to clear scheduled audio
      ctx.close();
      const newCtx = new AudioContext();
      audioCtxRef.current = newCtx;
    }

    setCurrentTime(targetSeconds);

    // Note: skipping blocks to reach target timecode requires knowing
    // which blocks we haven't decoded yet. For v1, we accept that
    // forward-seeking within streamed data skips frames until the target.
  }, []);

  // ── Volume ──

  const handleVolumeChange = useCallback((v: number) => {
    volumeRef.current = v;
    setVolume(v);
    if (v > 0) setIsMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    isMutedRef.current = !isMutedRef.current;
    setIsMuted(isMutedRef.current);
  }, []);

  // ── Fullscreen ──

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // ── Controls auto-hide ──

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (status === 'playing') setControlsVisible(false);
    }, 2500);
  }, [status]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onMove = () => showControls();
    el.addEventListener('mousemove', onMove);
    el.addEventListener('touchstart', onMove);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('touchstart', onMove);
    };
  }, [showControls]);

  // ── Main pipeline: fetch → parse → decode ──

  useEffect(() => {
    if (!videoUrl) return;

    let cancelled = false;
    const ac = new AbortController();
    abortRef.current = ac;
    mountedRef.current = true;

    // Reset state
    setStatus('loading');
    setErrorMessage(null);
    setCurrentTime(0);
    setDuration(0);
    setAudioTracks([]);
    setSelectedAudioTrack(0);
    selectedTrackRef.current = 0;
    setFilenameLanguages(audioLanguages || []);
    frameQueueRef.current = [];
    firstAudioTsRef.current = -1;
    isPausedRef.current = true;
    const decoderInitTrack: TrackMeta[] = [];

    // Initialize AudioContext (must be created from user gesture)
    let audioCtx = audioCtxRef.current;
    if (!audioCtx) {
      try {
        audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;
      } catch (e) {
        handleError(`AudioContext creation failed`);
        return;
      }
    }

    (async () => {
      try {
        console.log('[WebCodecs] Fetching:', videoUrl);
        const response = await fetch(videoUrl, { signal: ac.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        if (!response.body) throw new Error('Response has no body stream');

        const reader = response.body.getReader();

        const parser = new StreamingMkvParser();
        parserRef.current = parser;

        parser.onDuration = (dur) => {
          console.log('[WebCodecs] Duration:', dur);
          if (!mountedRef.current) return;
          setDuration(dur);
        };

        parser.onTrack = async (track: TrackMeta) => {
          if (!mountedRef.current) return;
          console.log(`[WebCodecs] Track #${track.trackNumber}: type=${track.trackType}, codec=${track.codecId}, lang=${track.language}`);

          decoderInitTrack.push(track);

          if (track.trackType === 1) {
            // Video track
            try {
              await configureVideoDecoder(track);
            } catch (e) {
              handleError(e instanceof Error ? e.message : String(e));
            }
          } else if (track.trackType === 2) {
            // Audio track — collect for UI
            // Don't configure yet; wait until all tracks are collected
            // so we know which one is the primary audio track
          }
        };

        parser.onBlock = (block: ParsedBlock) => {
          if (!mountedRef.current) return;

          const vDecoder = videoDecoderRef.current;
          const aDecoder = audioDecoderRef.current;

          const track = decoderInitTrack.find((t) => t.trackNumber === block.trackNumber);
          if (!track) return;

          if (track.trackType === 1 && vDecoder) {
            // Feed video block
            if (vDecoder.decodeQueueSize < 30) {
              vDecoder.decode(
                new EncodedVideoChunk({
                  type: block.isKeyframe ? 'key' : 'delta',
                  timestamp: block.timecode,
                  duration: 0, // unknown duration
                  data: block.data,
                }),
              );
            }
          } else if (track.trackType === 2 && aDecoder) {
            // Feed audio block — only for selected track
            if (block.trackNumber !== selectedTrackRef.current) return;
            if (aDecoder.decodeQueueSize < 60) {
              aDecoder.decode(
                new EncodedAudioChunk({
                  type: 'key',
                  timestamp: block.timecode,
                  data: block.data,
                }),
              );
            }
          }
        };

        parser.onError = (e: Error) => {
          console.error('[WebCodecs] Parser error:', e.message);
          if (!mountedRef.current) return;
          handleError(e.message);
        };

        parser.onDone = () => {
          console.log('[WebCodecs] Stream parsing complete');
          // Flush decoders to process remaining queue
          videoDecoderRef.current?.flush();
          audioDecoderRef.current?.flush();
        };

        // Collect audio track info (after all tracks parsed)
        // We do this by waiting for tracks to be discovered
        // Audio decoder will be configured after video decoder is ready
        // But the parser processes synchronously, so we can't easily wait.

        // Instead, we use a MutationObserver-style approach:
        // After track discovery, configure audio decoder
        const checkAudioTracks = setInterval(() => {
          if (decoderInitTrack.length > 0 && videoDecoderRef.current) {
            const audioTracksList = decoderInitTrack.filter((t) => t.trackType === 2);
            if (audioTracksList.length > 0 && !audioDecoderRef.current) {
              clearInterval(checkAudioTracks);
              configureAudioDecoder(audioTracksList[0]);
              setAudioTracks(audioTracksList);
            }
          }
        }, 50);

        // Start parsing (blocks until stream ends or error)
        await parser.parseStream(reader);

        clearInterval(checkAudioTracks);
        console.log('[WebCodecs] Stream ended');
      } catch (e) {
        if (cancelled || ac.signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[WebCodecs] Pipeline error:', msg);
        handleError(msg);
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      abortRef.current = null;

      // Abort fetch
      ac.abort();
      parserRef.current?.abort();

      // Cleanup decoders
      videoDecoderRef.current?.close();
      videoDecoderRef.current = null;
      audioDecoderRef.current?.close();
      audioDecoderRef.current = null;

      // Cleanup audio
      audioCtxRef.current?.close();
      audioCtxRef.current = null;

      // Cancel animation frame
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = 0;
      }

      // Close pending frames
      for (const f of frameQueueRef.current) f.close();
      frameQueueRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  // ── Audio track switching ──

  const handleAudioTrackChange = useCallback((index: number) => {
    const track = audioTracks[index];
    if (!track) return;
    selectedTrackRef.current = track.trackNumber;
    setSelectedAudioTrack(index);
    setShowLangPicker(false);

    // Flush audio decoder to switch tracks
    audioDecoderRef.current?.flush();

    // Reset audio sync since the new track's timestamps may differ
    firstAudioTsRef.current = -1;
    baseAudioTimeRef.current = 0;
  }, [audioTracks]);

  // ── Format time ──

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ── Render ──

  // ---- Loading State ----
  if (status === 'loading') {
    return (
      <div className="absolute inset-0 bg-[#070708] z-30 flex flex-col items-center justify-center gap-5 pointer-events-none">
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
          Loading Metadata
        </p>
      </div>
    );
  }

  // ---- Error State ----
  if (status === 'error') {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#070708] z-40 gap-4 px-6">
        <div className="text-[#D4A237] text-4xl">⚠</div>
        <p
          className="text-xl text-[#F4F4F5] font-bold text-center"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          HEVC Playback Unavailable
        </p>
        <p className="text-sm text-[#A1A1AA] text-center max-w-xs">
          {errorMessage || 'Your browser does not support HEVC decoding via WebCodecs.'}
        </p>
        <p className="text-xs text-[#52525B] text-center max-w-sm">
          Try selecting an H.264 (x264) quality option instead, or use Chrome on macOS/Android.
        </p>
      </div>
    );
  }

  // ---- Player (ready / playing / paused) ----
  const showPlayButton = status === 'ready' || status === 'paused';

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 bg-black z-30 flex flex-col items-stretch"
      onDoubleClick={toggleFullscreen}
    >
      {/* Canvas — rendered video output */}
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain cursor-pointer"
        onClick={togglePlay}
      />

      {/* Large play button overlay */}
      {showPlayButton && (
        <div
          className="absolute inset-0 flex items-center justify-center cursor-pointer z-20"
          onClick={togglePlay}
        >
          <div className="w-16 h-16 rounded-full bg-[#D4A237]/90 flex items-center justify-center transition-transform hover:scale-110 active:scale-95">
            <Play size={30} className="text-[#070708] ml-1" fill="currentColor" />
          </div>
        </div>
      )}

      {/* Controls bar (auto-hide) */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-20 transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none" />

        {/* Controls */}
        <div className="relative flex items-center gap-2 px-3 py-2 pb-3">
          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            className="text-white hover:text-[#D4A237] transition-colors flex-shrink-0"
            aria-label={status === 'playing' ? 'Pause' : 'Play'}
          >
            {status === 'playing' ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>

          {/* Current time */}
          <span className="text-white/80 text-xs font-mono min-w-[3.5rem] tabular-nums">
            {formatTime(currentTimeRef.current)}
          </span>

          {/* Seek bar */}
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={Math.min(currentTimeRef.current, duration || 100)}
            onChange={(e) => seek(Number(e.target.value))}
            className="flex-1 h-1 accent-[#D4A237] bg-white/20 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#D4A237]"
            aria-label="Seek"
          />

          {/* Duration */}
          <span className="text-white/60 text-xs font-mono min-w-[3.5rem] tabular-nums">
            {formatTime(duration)}
          </span>

          {/* Volume */}
          <div className="relative flex items-center">
            <button
              onClick={toggleMute}
              onMouseEnter={() => setShowVolumeSlider(true)}
              className="text-white/80 hover:text-white transition-colors flex-shrink-0"
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted || volume === 0 ? (
                <VolumeX size={18} />
              ) : (
                <Volume2 size={18} />
              )}
            </button>
            {showVolumeSlider && (
              <div
                className="flex items-center ml-1"
                onMouseLeave={() => setShowVolumeSlider(false)}
              >
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  className="w-20 h-1 accent-[#D4A237] bg-white/20 rounded-full appearance-none cursor-pointer
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#D4A237]"
                  aria-label="Volume"
                />
              </div>
            )}
          </div>

          {/* Audio language picker */}
          {audioTracks.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setShowLangPicker((v) => !v)}
                className="text-white/80 hover:text-white transition-colors flex-shrink-0"
                aria-label="Audio language"
              >
                <Languages size={18} />
              </button>
              {showLangPicker && (
                <div className="absolute bottom-full right-0 mb-2 bg-[#1C1C1E] border border-white/[0.08] rounded-lg overflow-hidden shadow-xl min-w-[120px]">
                  {audioTracks.map((track, idx) => (
                    <button
                      key={track.trackNumber}
                      onClick={() => handleAudioTrackChange(idx)}
                      className={`w-full px-3 py-1.5 text-xs text-left transition-colors ${
                        selectedAudioTrack === idx
                          ? 'bg-[#D4A237]/20 text-[#D4A237]'
                          : 'text-white/70 hover:bg-white/10'
                      }`}
                    >
                      {displayLang(track.language)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Fullscreen toggle */}
          <button
            onClick={toggleFullscreen}
            className="text-white/80 hover:text-white transition-colors flex-shrink-0"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
