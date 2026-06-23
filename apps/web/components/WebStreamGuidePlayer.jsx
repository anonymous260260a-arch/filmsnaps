'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

// ── Theme ──
const ACCENT = '#e8a020';
const ACCENT_BRIGHT = '#f5b53a';
const ACCENT_DIM = 'rgba(232, 160, 32, 0.18)';

// ── Logger (dev only) ──
const log = (msg, data) => {
  if (process.env.NODE_ENV !== 'production') {
    if (data) console.log('[WebSG]', msg, typeof data === 'object' ? JSON.stringify(data).slice(0, 200) : data);
    else console.log('[WebSG]', msg);
  }
};

// ── Format time ──
function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Subtitle Parsing ──
function parseSRTTime(t) {
  const m = t.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4], 10) / 1000;
}

function parseSRT(content) {
  const cues = [];
  const blocks = content.trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;
    const timeLine = lines.find((l) => l.includes('-->'));
    if (!timeLine) continue;
    const [startStr, endStr] = timeLine.split('-->').map((s) => s.trim());
    const start = parseSRTTime(startStr);
    const end = parseSRTTime(endStr);
    const timeIdx = lines.indexOf(timeLine);
    const text = lines.slice(timeIdx + 1).join('\n').trim();
    if (text && !isNaN(start) && !isNaN(end)) cues.push({ start, end, text });
  }
  return cues;
}

function parseVTT(content) {
  const clean = content.replace(/^WEBVTT[\s\S]*?\n(?:NOTE[\s\S]*?\n)?/, '').replace(/^WEBVTT\s*\n/, '');
  const blocks = clean.trim().split(/\n\n+/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const timeLine = lines.find((l) => l.includes('-->'));
    if (!timeLine) continue;
    const [startStr, endStr] = timeLine.split('-->').map((s) => s.trim());
    const start = parseSRTTime(startStr.replace('.', ','));
    const end = parseSRTTime(endStr.replace('.', ','));
    const timeIdx = lines.indexOf(timeLine);
    const text = lines.slice(timeIdx + 1).join('\n').trim();
    if (text && !isNaN(start) && !isNaN(end)) cues.push({ start, end, text });
  }
  return cues;
}

async function fetchSubtitles(url) {
  try {
    const res = await fetch(url, { cache: 'force-cache' });
    const text = await res.text();
    if (text.trim().startsWith('WEBVTT')) return parseVTT(text);
    return parseSRT(text);
  } catch (e) {
    console.warn('[WebSG] Subtitle fetch failed:', e);
    return [];
  }
}

// ── Constants ──
const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const SKIP_SECONDS = 10;
const CONTROLS_AUTOHIDE_MS = 3500;
const DOUBLE_CLICK_DELAY = 280;
const HLS_RECOVERY_MAX_RETRIES = 5;
const SEEK_LOW_QUALITY_DELAY_MS = 500; // wait before restoring quality after seek ends

// ── HLS Tuning ──
// Aggressive buffer + ABR + retry config tuned for HLS VOD streaming.
// - Larger forward buffer (60s) absorbs bandwidth fluctuations
// - Smaller back buffer (30s) bounds memory growth while allowing seeks-back
// - Auto startLevel (-1) → hls.js picks lowest for fast startup, ramps up via ABR
// - Faster downswitch EWMA so we react quickly to bandwidth drops
// - Shorter retry delays so transient segment failures don't stall playback
const HLS_CONFIG = {
  enableWorker: true,
  lowLatencyMode: false,

  // Buffer sizing (seconds)
  maxBufferLength: 60,            // default 30 → 60 for smoother playback
  maxMaxBufferLength: 120,        // hard cap; default 600s is wasteful
  backBufferLength: 30,           // keep last 30s for cheap seeks back
  maxBufferSize: 120 * 1000 * 1000, // 120 MB cap (was 60 MB) — more room for forward buffer after seek
  maxBufferHole: 0.1,               // was 0.5 — more tolerant of small gaps so playback starts faster after seek

  // Startup
  startLevel: -1,                 // -1 = auto (let ABR pick, fast start)
  testBandwidth: true,            // measure bandwidth on startup
  autoStartLoad: true,

  // ABR — more aggressive about switching DOWN on bandwidth drops
  abrEwmaDefaultEstimate: 1_000_000, // 1 Mbps initial conservative estimate
  abrEwmaFastEstimateDown: 1.5,   // was 2.0 — react even faster on bandwidth drops (keeps seek downloads fast)
  abrEwmaSlowEstimateDown: 4.0,   // was 6.0
  abrEwmaFastEstimateUp: 4.0,     // was 3.0 — more cautious about upgrading (prefer stability)
  abrEwmaSlowEstimateUp: 10.0,    // was 8.0 — slower upgrade over long window
  abrEwmaDefaultEstimateMaxFactor: 4.0,
  abrBandWidthFactor: 0.85,       // was 0.95 — require 85% (not 95%) before keeping level = faster downswitch
  abrBandWidthUpFactor: 0.85,     // was 0.7 — require 85% of measured bandwidth before upgrading
  maxStarvationDelay: 1,          // was 4 — start playing much faster after seek
  maxLoadingDelay: 1,             // was 4

  // Cap level to player size — don't waste bandwidth on 1080p in a 480p box
  capLevelToPlayerSize: true,

  // Fragment / manifest / level load retries (network resilience)
  fragLoadingMaxRetry: 8,            // default 6 → 8 for tougher networks
  fragLoadingMaxRetryTimeout: 64_000,
  fragLoadingRetryDelay: 500,        // default 1000 → faster first retry
  fragLoadingMaxRetryDelay: 8_000,
  manifestLoadingMaxRetry: 5,
  manifestLoadingRetryDelay: 500,
  manifestLoadingMaxRetryTimeout: 16_000,
  levelLoadingMaxRetry: 5,
  levelLoadingRetryDelay: 500,
  levelLoadingMaxRetryTimeout: 16_000,
};

// Quality picker option kinds
// 'url'   — API-provided URL (switching requires re-init, preserves currentTime)
// 'level' — auto-detected hls.levels variant (switch via hls.currentLevel, no re-init)
// 'auto'  — ABR auto-pick (hls.currentLevel = -1)

// ── Icon (inline SVG helper to avoid new deps) ──
const Icon = ({ name, size = 20, className = '', strokeWidth = 1.8 }) => {
  const paths = {
    play: <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />,
    pause: <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" fill="currentColor" stroke="none" />,
    skipBack: <path d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" fill="currentColor" stroke="none" />,
    skipForward: <path d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" fill="currentColor" stroke="none" />,
    volumeHigh: <>
      <path d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
      <path d="M17.657 6.343A8 8 0 0121 12a8 8 0 01-3.343 6.657M15.536 8.464a5 5 0 010 7.072" />
    </>,
    volumeLow: <>
      <path d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
      <path d="M15.536 8.464a5 5 0 010 7.072" />
    </>,
    volumeMute: <>
      <path d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
      <path d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
    </>,
    settings: <>
      <path d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
    </>,
    subtitles: <path d="M15.75 5.25v13.5m-7.5-13.5v13.5m-5.25-9h16.5m-16.5 4.5h16.5" />,
    fullscreen: <path d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />,
    fullscreenExit: <path d="M9 9V4.5M9 9H4.5m15 0H15M9 15v4.5M9 15H4.5M15 15h4.5M15 15v4.5" />,
    close: <path d="M6 18L18 6M6 6l12 12" />,
    check: <path d="M4.5 12.75l6 6 9-13.5" />,
    alert: <path d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />,
    debug: <path d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />,
    keyboard: <path d="M6 10.5h.008v.008H6V10.5zm0 0H4.5m1.5 0H9m-3 3.75h.008v.008H6v-.008zm0 0H4.5m1.5 0H9m6-3.75h.008v.008H18V10.5zm0 0h1.5m-1.5 0H15m3 3.75h.008v.008H18v-.008zm0 0h1.5m-1.5 0H15M3 7.5h18M3 7.5a1.5 1.5 0 00-1.5 1.5v6A1.5 1.5 0 003 16.5h18a1.5 1.5 0 001.5-1.5V9A1.5 1.5 0 0021 7.5M3 7.5h18" />,
  };
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] || null}
    </svg>
  );
};

// ── Control Button (web) ──
const ControlButton = ({ children, onClick, title, active = false, className = '' }) => (
  <button
    onClick={onClick}
    title={title}
    aria-label={title}
    className={`w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white/10 active:bg-white/15 transition-colors ${active ? 'text-amber-400' : 'text-zinc-200'} ${className}`}
  >
    {children}
  </button>
);

// ── Seek Bar (web) ──
const SeekBar = ({
  progress,
  buffered,
  duration,
  isSeeking,
  hoverPct,
  onSeekStart,
  onSeekMove,
  onSeekEnd,
  onHover,
  containerRef,
}) => {
  const barRef = useRef(null);
  const [barWidth, setBarWidth] = useState(0);

  useEffect(() => {
    if (!barRef.current) return;
    const update = () => {
      if (barRef.current) setBarWidth(barRef.current.clientWidth);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(barRef.current);
    return () => ro.disconnect();
  }, []);

  const playedPct = Math.max(0, Math.min(1, progress)) * 100;
  const bufferedPct = Math.max(0, Math.min(1, buffered)) * 100;
  const hoverPctValue = hoverPct != null ? hoverPct * 100 : null;

  const getPctFromEvent = useCallback((clientX) => {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  // Pointer events (covers mouse + touch)
  const handlePointerDown = useCallback((e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onSeekStart(getPctFromEvent(e.clientX));
  }, [getPctFromEvent, onSeekStart]);

  const handlePointerMove = useCallback((e) => {
    const pct = getPctFromEvent(e.clientX);
    onHover(pct);
    if (isSeeking) onSeekMove(pct);
  }, [getPctFromEvent, isSeeking, onSeekMove, onHover]);

  const handlePointerUp = useCallback((e) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    onSeekEnd(getPctFromEvent(e.clientX));
  }, [getPctFromEvent, onSeekEnd]);

  const handlePointerLeave = useCallback(() => {
    onHover(null);
  }, [onHover]);

  return (
    <div
      ref={barRef}
      className="relative h-6 flex items-center cursor-pointer group/seek touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      {/* Track background */}
      <div className="absolute left-0 right-0 h-1.5 bg-zinc-700/50 rounded-full group-hover/seek:h-2 transition-all">
        {/* Buffered */}
        <div
          className="absolute left-0 top-0 h-full bg-zinc-500/70 rounded-full"
          style={{ width: `${bufferedPct}%` }}
        />
        {/* Played */}
        <div
          className="absolute left-0 top-0 h-full rounded-full"
          style={{
            width: `${playedPct}%`,
            background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_BRIGHT})`,
            boxShadow: `0 0 8px ${ACCENT_DIM}`,
          }}
        />
      </div>

      {/* Hover indicator (vertical line) */}
      {hoverPctValue != null && !isSeeking && (
        <div
          className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 bg-white/40 rounded pointer-events-none"
          style={{ left: `${hoverPctValue}%`, marginLeft: '-1px' }}
        />
      )}

      {/* Thumb */}
      <div
        className="absolute top-1/2 w-4 h-4 bg-white rounded-full shadow-lg shadow-black/50 -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-transform"
        style={{
          left: `${playedPct}%`,
          transform: `translate(-50%, -50%) scale(${isSeeking ? 1.25 : 1})`,
          opacity: isSeeking ? 1 : undefined,
        }}
      />

      {/* Scrubbing / hover preview bubble */}
      {(isSeeking || hoverPctValue != null) && duration > 0 && (
        <div
          className="absolute -top-9 -translate-x-1/2 pointer-events-none"
          style={{
            left: `${isSeeking ? playedPct : hoverPctValue}%`,
          }}
        >
          <div className="px-2.5 py-1 rounded-md bg-zinc-950/95 border border-amber-500/30 text-amber-400 text-xs font-bold tabular-nums whitespace-nowrap shadow-xl">
            {formatTime((isSeeking ? progress : hoverPct) * duration)}
          </div>
          <div className="w-0 h-0 border-l-4 border-l-transparent border-r-4 border-r-transparent border-t-4 border-t-zinc-950/95 mx-auto -mt-px" />
        </div>
      )}
    </div>
  );
};

// ── Component ──

export function WebStreamGuidePlayer({ apiUrl, onLoadStart, onLoadEnd, onError }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const containerRef = useRef(null);
  const controlsTimerRef = useRef(null);
  const hlsRetryRef = useRef(0);
  const doubleClickTimerRef = useRef(null);
  const lastClickSideRef = useRef(null);
  const fetchTokenRef = useRef(0);
  const seekingRef = useRef(false);
  const seekLevelRef = useRef(null); // saved hls.currentLevel before seek-downgrade

  // ── Data state ──
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [debugLines, setDebugLines] = useState([]);
  const [sources, setSources] = useState([]);
  const [subtitles, setSubtitles] = useState([]);
  const [currentQuality, setCurrentQuality] = useState('1080p');

  // ── Subtitle state ──
  const [subtitleCues, setSubtitleCues] = useState([]);
  const [selectedSubIndex, setSelectedSubIndex] = useState(null);
  const [activeSubText, setActiveSubText] = useState(null);

  // ── Playback state (driven by events, not polling) ──
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  // ── Network / ABR state ──
  const [isOnline, setIsOnline] = useState(true);
  const [hlsLevels, setHlsLevels] = useState([]);          // variants auto-detected in current manifest
  const [currentLevelIdx, setCurrentLevelIdx] = useState(-1); // -1 = auto
  const [autoLevelIdx, setAutoLevelIdx] = useState(-1);    // the level ABR has currently chosen
  const [bandwidthEstimate, setBandwidthEstimate] = useState(0); // bits/sec

  // ── UI state ──
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekPreview, setSeekPreview] = useState(0);
  const [hoverPct, setHoverPct] = useState(null);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [skipIndicator, setSkipIndicator] = useState(null);
  const [showDebug, setShowDebug] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [initialPlayDone, setInitialPlayDone] = useState(false);

  const addDebug = useCallback((msg) => {
    setDebugLines((prev) => [...prev.slice(-19), `${new Date().toISOString().slice(11, 19)} ${msg}`]);
  }, []);

  // ── Resolve source ──
  const currentSource = useMemo(() => {
    if (!sources.length) return null;
    const exact = sources.find((s) => s.quality === currentQuality);
    if (exact) return exact;
    const sorted = [...sources].sort((a, b) => (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0));
    return sorted[0];
  }, [sources, currentQuality]);

  const qualityLevels = useMemo(() => {
    return Array.from(new Set(sources.map((s) => s.quality)))
      .sort((a, b) => (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0));
  }, [sources]);

  const progress = duration > 0 ? currentTime / duration : 0;
  const displayProgress = isSeeking ? seekPreview : progress;
  const bufferedPct = duration > 0 ? Math.min(1, buffered / duration) : 0;

  // ── Auto-hide controls ──
  const cancelAutoHide = useCallback(() => {
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = null;
    }
  }, []);

  const scheduleAutoHide = useCallback(() => {
    cancelAutoHide();
    controlsTimerRef.current = setTimeout(() => {
      if (!seekingRef.current && !showQualityMenu && !showSubMenu && !showSpeedMenu && !showVolumeSlider) {
        setControlsVisible(false);
      }
    }, CONTROLS_AUTOHIDE_MS);
  }, [cancelAutoHide, showQualityMenu, showSubMenu, showSpeedMenu, showVolumeSlider]);

  const showControls = useCallback(() => {
    cancelAutoHide();
    setControlsVisible(true);
    scheduleAutoHide();
  }, [cancelAutoHide, scheduleAutoHide]);

  // Re-schedule when menus open/close
  useEffect(() => {
    if (showQualityMenu || showSubMenu || showSpeedMenu) {
      cancelAutoHide();
    } else {
      scheduleAutoHide();
    }
  }, [showQualityMenu, showSubMenu, showSpeedMenu, cancelAutoHide, scheduleAutoHide]);

  // ── Fetch API data ──
  const fetchData = useCallback(async () => {
    const token = ++fetchTokenRef.current;
    setLoading(true);
    setError(null);
    setDebugLines([]);
    setInitialPlayDone(false);
    addDebug(`Fetching: ${(apiUrl || '').slice(0, 100)}`);
    onLoadStart?.();
    try {
      const res = await fetch(apiUrl, { cache: 'force-cache' });
      addDebug(`API status: ${res.status}`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      if (token !== fetchTokenRef.current) return;
      const allSources = [];
      for (const p of data.providers || []) {
        for (const s of p.sources || []) allSources.push(s);
      }
      if (!allSources.length) throw new Error('No video sources available');
      setSources(allSources);
      setSubtitles(data.subtitles || []);
      addDebug(`${allSources.length} sources, ${data.subtitles?.length || 0} subtitles`);
    } catch (e) {
      if (token !== fetchTokenRef.current) return;
      const msg = e?.message || 'Failed to load stream';
      addDebug(`ERROR: ${msg}`);
      setError(msg);
      onError?.(msg);
    } finally {
      if (token === fetchTokenRef.current) {
        setLoading(false);
        onLoadEnd?.();
      }
    }
  }, [apiUrl, addDebug, onLoadStart, onLoadEnd, onError]);

  useEffect(() => {
    fetchData();
    return () => { fetchTokenRef.current++; };
  }, [apiUrl]);

  // ── HLS init (with error recovery) ──
  useEffect(() => {
    if (!currentSource?.url || !videoRef.current) return;
    const video = videoRef.current;
    const url = currentSource.url;
    let destroyed = false;
    hlsRetryRef.current = 0;

    async function initHls() {
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch (e) {}
        hlsRef.current = null;
      }
      try {
        const Hls = (await import('hls.js')).default;
        if (destroyed) return;

        if (Hls.isSupported()) {
          const hls = new Hls(HLS_CONFIG);
          hlsRef.current = hls;
          hls.loadSource(url);
          hls.attachMedia(video);

          hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
            if (destroyed) return;
            const levels = (hls.levels || []).map((lv, i) => ({
              index: i,
              height: lv.height,
              bitrate: lv.bitrate,
              name: lv.height ? `${lv.height}p` : `Level ${i + 1}`,
            })).sort((a, b) => (b.height || 0) - (a.height || 0));
            setHlsLevels(levels);
            addDebug(`Manifest parsed: ${levels.length} levels${levels.length ? ' (' + levels.map(l => l.name).join(', ') + ')' : ''}`);
            if (!initialPlayDone) {
              video.play().catch(e => log('Auto-play:', e?.message));
              setInitialPlayDone(true);
            }
          });

          // Fires when ABR switches to a new level (auto or manual)
          hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
            if (destroyed) return;
            setCurrentLevelIdx(hls.currentLevel);
            setAutoLevelIdx(data.level);
            const lv = hls.levels?.[data.level];
            const bw = hls.bandwidthEstimate || 0;
            setBandwidthEstimate(bw);
            addDebug(`Level → ${lv?.height ? lv.height + 'p' : '#' + data.level} (${(bw / 1e6).toFixed(2)} Mbps est.)`);
          });

          // Fires when a fragment finishes buffering — good bandwidth sample point
          hls.on(Hls.Events.FRAG_BUFFERED, (event, data) => {
            if (destroyed) return;
            const bw = hls.bandwidthEstimate || 0;
            if (bw > 0) setBandwidthEstimate(bw);
          });

          // Non-fatal error — log for debugging but don't surface to user
          hls.on(Hls.Events.ERROR, (event, data) => {
            if (destroyed) return;
            if (!data.fatal) {
              // Transient — log quietly, hls.js will retry per fragLoadingMaxRetry config
              addDebug(`HLS non-fatal: ${data.type}/${data.details}`);
              return;
            }
            addDebug(`HLS FATAL: ${data.type} / ${data.details}`);
            // Try recovery before giving up
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && hlsRetryRef.current < HLS_RECOVERY_MAX_RETRIES) {
              hlsRetryRef.current++;
              addDebug(`HLS network retry ${hlsRetryRef.current}/${HLS_RECOVERY_MAX_RETRIES}`);
              setTimeout(() => { if (!destroyed && hlsRef.current) hlsRef.current.startLoad(); }, 500);
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && hlsRetryRef.current < HLS_RECOVERY_MAX_RETRIES) {
              hlsRetryRef.current++;
              addDebug(`HLS media retry ${hlsRetryRef.current}/${HLS_RECOVERY_MAX_RETRIES}`);
              setTimeout(() => { if (!destroyed && hlsRef.current) hlsRef.current.recoverMediaError(); }, 500);
            } else {
              const msg = `HLS error: ${data.type}`;
              setError('Failed to load video stream');
              onError?.(msg);
            }
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          // Native HLS (Safari)
          video.src = url;
          video.addEventListener('loadeddata', () => {
            if (destroyed) return;
            if (!initialPlayDone) {
              video.play().catch(e => log('Auto-play:', e?.message));
              setInitialPlayDone(true);
            }
          }, { once: true });
          video.addEventListener('error', () => {
            if (destroyed) return;
            setError('Failed to load video stream');
            onError?.('Native HLS error');
          });
        } else {
          setError('HLS not supported in this browser');
          onError?.('HLS not supported');
        }
      } catch (e) {
        if (!destroyed) {
          addDebug(`HLS error: ${e?.message}`);
          setError('Failed to initialize HLS player');
          onError?.(e?.message);
        }
      }
    }

    initHls();

    return () => {
      destroyed = true;
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch (e) {}
        hlsRef.current = null;
      }
      video.removeAttribute('src');
      try { video.load(); } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSource?.url]);

  // ── Real video event listeners (no polling) ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      if (!seekingRef.current) setCurrentTime(video.currentTime || 0);
    };
    const onDurationChange = () => {
      if (video.duration && isFinite(video.duration)) setDuration(video.duration);
    };
    const onLoadedMetadata = () => {
      if (video.duration && isFinite(video.duration)) setDuration(video.duration);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onVolumeChange = () => {
      setVolume(video.volume);
      setIsMuted(video.muted);
    };
    const onRateChange = () => setPlaybackRate(video.playbackRate);
    const onProgress = () => {
      // Buffered end of the range that contains currentTime
      try {
        if (video.buffered && video.buffered.length > 0) {
          // Find the range containing currentTime
          const t = video.currentTime;
          let end = 0;
          for (let i = 0; i < video.buffered.length; i++) {
            if (video.buffered.start(i) <= t && video.buffered.end(i) >= t) {
              end = video.buffered.end(i);
              break;
            }
            end = Math.max(end, video.buffered.end(i));
          }
          setBuffered(end);
        }
      } catch (e) {}
    };
    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const onCanPlay = () => setIsBuffering(false);
    const onEnded = () => {
      setIsPlaying(false);
      setControlsVisible(true);
    };

    // ── Seek quality-downshift ──
    // When the user seeks (anywhere in the video — seek bar, keyboard, or
    // programmatic), temporarily drop to the lowest quality so the target
    // segment loads faster, then restore after seek completes.
    const onSeeking = () => {
      const hls = hlsRef.current;
      if (hls && hls.levels && hls.levels.length > 1 && seekLevelRef.current === null) {
        seekLevelRef.current = hls.currentLevel; // save for restore later
        if (hls.currentLevel !== 0) {
          hls.currentLevel = 0; // lowest quality = fastest segment download
        }
      }
    };
    const onSeeked = () => {
      const hls = hlsRef.current;
      if (hls && seekLevelRef.current !== null) {
        const saved = seekLevelRef.current;
        seekLevelRef.current = null;
        // Let the target segment finish loading before restoring quality
        setTimeout(() => {
          if (hlsRef.current && saved !== hlsRef.current.currentLevel) {
            hlsRef.current.currentLevel = saved;
          }
        }, SEEK_LOW_QUALITY_DELAY_MS);
      }
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('volumechange', onVolumeChange);
    video.addEventListener('ratechange', onRateChange);
    video.addEventListener('progress', onProgress);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('ended', onEnded);
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('seeked', onSeeked);

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('ratechange', onRateChange);
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onSeeked);
    };
  }, []);

  // ── Subtitle sync (driven by timeupdate via rAF fallback) ──
  // We piggyback on the video's timeupdate for subtitle updates
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let lastCueText = null;
    const update = () => {
      if (selectedSubIndex === null || subtitleCues.length === 0) {
        if (lastCueText !== null) { setActiveSubText(null); lastCueText = null; }
        return;
      }
      const t = video.currentTime;
      // Binary search would be faster, but linear is fine for typical subtitle counts
      const active = subtitleCues.find((c) => t >= c.start && t < c.end);
      const text = active?.text || null;
      if (text !== lastCueText) {
        setActiveSubText(text);
        lastCueText = text;
      }
    };
    // Use both timeupdate (cost-effective) and a 200ms interval for smoothness
    video.addEventListener('timeupdate', update);
    const interval = setInterval(update, 200);
    return () => {
      video.removeEventListener('timeupdate', update);
      clearInterval(interval);
    };
  }, [selectedSubIndex, subtitleCues]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e) => {
      // Don't trigger if focus is in an input
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (!containerRef.current?.contains(e.target) && e.code !== 'KeyF') return;
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          handlePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skip(-SKIP_SECONDS);
          break;
        case 'ArrowRight':
          e.preventDefault();
          skip(SKIP_SECONDS);
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (videoRef.current) videoRef.current.volume = Math.min(1, (videoRef.current.volume || 0) + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (videoRef.current) videoRef.current.volume = Math.max(0, (videoRef.current.volume || 0) - 0.1);
          break;
        case 'KeyF':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'KeyM':
          e.preventDefault();
          toggleMute();
          break;
        case 'KeyJ':
          e.preventDefault();
          skip(-SKIP_SECONDS);
          break;
        case 'KeyL':
          e.preventDefault();
          skip(SKIP_SECONDS);
          break;
        case 'KeyK':
          e.preventDefault();
          handlePlayPause();
          break;
        case 'Question':
        case 'Slash':
          if (e.shiftKey) {
            e.preventDefault();
            setShowShortcuts(v => !v);
          }
          break;
        case 'Escape':
          setShowShortcuts(false);
          setShowQualityMenu(false);
          setShowSubMenu(false);
          setShowSpeedMenu(false);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Playback control methods ──
  const handlePlayPause = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(e => log('Play error:', e?.message));
    } else {
      videoRef.current.pause();
    }
    showControls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showControls]);

  const skip = useCallback((sec) => {
    if (!videoRef.current) return;
    const dur = videoRef.current.duration || 0;
    videoRef.current.currentTime = Math.max(0, Math.min(dur, videoRef.current.currentTime + sec));
    setSkipIndicator(sec > 0 ? `+${sec}s` : `${sec}s`);
    setTimeout(() => setSkipIndicator(null), 700);
    showControls();
  }, [showControls]);

  const toggleMute = useCallback(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    showControls();
  }, [showControls]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().catch(e => log('FS error:', e?.message));
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  useEffect(() => {
    const fn = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', fn);
    return () => document.removeEventListener('fullscreenchange', fn);
  }, []);

  // ── Seek handlers ──
  // Seek bar only handles UI state — quality downshift happens via video
  // `seeking` event (see video events useEffect) which catches ALL seeks:
  // seek bar, keyboard (←/→), and programmatic.
  const handleSeekStart = useCallback((pct) => {
    setIsSeeking(true);
    seekingRef.current = true;
    cancelAutoHide();
    setSeekPreview(pct);
  }, [cancelAutoHide]);

  const handleSeekMove = useCallback((pct) => {
    setSeekPreview(pct);
  }, []);

  const handleSeekEnd = useCallback((pct) => {
    if (videoRef.current && duration > 0) {
      videoRef.current.currentTime = pct * duration;
      setCurrentTime(pct * duration);
    }
    setIsSeeking(false);
    seekingRef.current = false;
    setHoverPct(null);
    scheduleAutoHide();
  }, [duration, scheduleAutoHide]);

  const handleHover = useCallback((pct) => {
    setHoverPct(pct);
  }, []);

  // ── Volume ──
  const handleVolumeChange = useCallback((e) => {
    const v = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.volume = v;
      videoRef.current.muted = v === 0;
    }
    setVolume(v);
  }, []);

  // ── Playback speed ──
  const handleSpeedChange = useCallback((rate) => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
    setPlaybackRate(rate);
    setShowSpeedMenu(false);
    showControls();
  }, [showControls]);

  // ── Quality (URL-based — full re-init, preserves currentTime via the HLS effect) ──
  const handleQualityChange = useCallback((quality) => {
    setCurrentQuality(quality);
    setCurrentLevelIdx(-1); // back to auto on URL switch
    setShowQualityMenu(false);
    showControls();
  }, [showControls]);

  // ── Level switch (in-flight, no re-init) ──
  // -1 = ABR auto, otherwise index into hls.levels
  const handleLevelSwitch = useCallback((levelIdx) => {
    const hls = hlsRef.current;
    if (!hls) return;
    try {
      hls.currentLevel = levelIdx; // -1 = auto
      setCurrentLevelIdx(levelIdx);
      // Cancel pending seek-quality restore so manual choice isn't overridden
      seekLevelRef.current = null;
      addDebug(levelIdx === -1 ? 'ABR: auto' : `Manual level: ${levelIdx}`);
    } catch (e) {
      addDebug(`Level switch failed: ${e?.message}`);
    }
    setShowQualityMenu(false);
    showControls();
  }, [showControls, addDebug]);

  // ── Subtitle ──
  const handleSubtitleChange = useCallback(async (index) => {
    setSelectedSubIndex(index);
    setShowSubMenu(false);
    if (index === null || !subtitles[index]) {
      setSubtitleCues([]);
      setActiveSubText(null);
      return;
    }
    addDebug(`Loading subtitle: ${subtitles[index].lang}`);
    const cues = await fetchSubtitles(subtitles[index].url);
    setSubtitleCues(cues);
    addDebug(`Subtitle cues: ${cues.length}`);
  }, [subtitles, addDebug]);

  // ── Click handler (single = toggle controls, double = skip) ──
  const handleVideoClick = useCallback((e) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const side = x < rect.width / 2 ? 'left' : 'right';

    if (lastClickSideRef.current === side && doubleClickTimerRef.current) {
      // Double-click → skip
      clearTimeout(doubleClickTimerRef.current);
      doubleClickTimerRef.current = null;
      lastClickSideRef.current = null;
      skip(side === 'left' ? -SKIP_SECONDS : SKIP_SECONDS);
    } else {
      if (doubleClickTimerRef.current) clearTimeout(doubleClickTimerRef.current);
      lastClickSideRef.current = side;
      doubleClickTimerRef.current = setTimeout(() => {
        doubleClickTimerRef.current = null;
        lastClickSideRef.current = null;
        // Single click → toggle controls
        setControlsVisible(v => {
          if (!v) {
            scheduleAutoHide();
            return true;
          }
          return false;
        });
      }, DOUBLE_CLICK_DELAY);
    }
  }, [skip, scheduleAutoHide]);

  // ── Mouse enter/leave ──
  const handleMouseEnter = useCallback(() => {
    showControls();
  }, [showControls]);
  const handleMouseLeave = useCallback(() => {
    if (isPlaying && !showQualityMenu && !showSubMenu && !showSpeedMenu) {
      setControlsVisible(false);
    }
  }, [isPlaying, showQualityMenu, showSubMenu, showSpeedMenu]);

  // ── Online / offline listeners (network resilience) ──
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      addDebug('Network: online');
      // Resume HLS if it was paused due to offline
      if (hlsRef.current) {
        try { hlsRef.current.startLoad(); } catch (e) {}
      }
      if (videoRef.current && videoRef.current.paused && isPlaying) {
        videoRef.current.play().catch(e => log('Resume:', e?.message));
      }
    };
    const onOffline = () => {
      setIsOnline(false);
      addDebug('Network: offline — pausing HLS');
      // Stop hls.js from hammering failed segment loads while offline
      if (hlsRef.current) {
        try { hlsRef.current.stopLoad(); } catch (e) {}
      }
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    setIsOnline(navigator.onLine);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      if (doubleClickTimerRef.current) clearTimeout(doubleClickTimerRef.current);
    };
  }, []);

  // ── Error state ──
  if (error) {
    return (
      <div className="relative w-full aspect-video bg-black rounded-xl sm:rounded-2xl overflow-hidden flex items-center justify-center">
        <div className="text-center p-6 max-w-md">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
            <Icon name="alert" size={28} className="text-red-500" />
          </div>
          <p className="text-zinc-200 text-lg font-semibold mb-1">Stream Error</p>
          <p className="text-zinc-500 text-sm mb-4">{error}</p>
          {debugLines.length > 0 && (
            <div className="bg-zinc-900/80 rounded-lg p-3 max-h-32 overflow-y-auto mb-4 text-left">
              {debugLines.map((d, i) => (
                <p key={i} className="text-zinc-500 text-xs font-mono leading-5">{d}</p>
              ))}
            </div>
          )}
          <button
            onClick={() => { setError(null); fetchData(); }}
            className="bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm px-6 py-2.5 rounded-xl transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Volume icon based on state ──
  const VolumeIcon = ({ size = 20 }) => {
    const name = (isMuted || volume === 0) ? 'volumeMute' : (volume < 0.5 ? 'volumeLow' : 'volumeHigh');
    return <Icon name={name} size={size} />;
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-video bg-black rounded-xl sm:rounded-2xl overflow-hidden group/player ring-1 ring-white/[0.08] shadow-[0_8px_60px_rgba(0,0,0,0.8)] select-none"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleVideoClick}
    >
      {/* ── Video element ── */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        playsInline
        crossOrigin="anonymous"
        preload="metadata"
      />

      {/* ── Center play button (when paused) ── */}
      {!isPlaying && !loading && duration > 0 && !error && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
          onClick={(e) => { e.stopPropagation(); handlePlayPause(); }}
          style={{ pointerEvents: 'auto' }}
        >
          <button
            className="w-20 h-20 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center transition-all hover:scale-105 hover:bg-black/55 border border-white/10"
            aria-label="Play"
          >
            <Icon name="play" size={36} className="text-white ml-1" />
          </button>
        </div>
      )}

      {/* ── Loading / Buffering overlay (fade-in, never jarring) ── */}
      {/* Always rendered; opacity is driven by (loading || isBuffering). */}
      {/* The 300ms opacity transition + delayed show prevents flicker on short stalls. */}
      <div
        className={`absolute inset-0 flex items-center justify-center bg-black/40 z-25 pointer-events-none transition-opacity duration-300 ${
          (loading || isBuffering) && !error ? 'opacity-100' : 'opacity-0'
        }`}
        aria-hidden={!loading && !isBuffering}
      >
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-12 h-12 rounded-full border-2 border-white/15 animate-spin"
            style={{ borderTopColor: ACCENT }}
          />
          <span className="text-zinc-300 text-xs font-semibold tracking-wider uppercase">
            {!isOnline ? 'Reconnecting' : loading ? 'Loading' : 'Buffering'}
          </span>
          {bandwidthEstimate > 0 && !loading && (
            <span className="text-zinc-500 text-[10px] font-mono">
              {(bandwidthEstimate / 1e6).toFixed(2)} Mbps est.
            </span>
          )}
        </div>
      </div>

      {/* ── Skip indicator ── */}
      {skipIndicator && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
          <div className="bg-black/70 backdrop-blur-md rounded-2xl px-10 py-5 flex flex-col items-center gap-1 border border-white/10">
            <Icon
              name={skipIndicator.startsWith('+') ? 'skipForward' : 'skipBack'}
              size={32}
              className="text-white"
            />
            <span className="text-white text-lg font-bold tabular-nums">{skipIndicator}</span>
          </div>
        </div>
      )}

      {/* ── Quality badge (top-left, always visible briefly) ── */}
      <div className={`absolute top-3 left-3 z-40 transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}>
        <span className="px-2 py-1 rounded-md bg-black/50 backdrop-blur text-white/70 text-[10px] font-bold uppercase tracking-wider border border-white/5">
          {currentQuality}
        </span>
      </div>

      {/* ── Top-right buttons (debug + shortcuts) ── */}
      <div className={`absolute top-3 right-3 z-40 flex gap-1 transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}>
        <button
          onClick={(e) => { e.stopPropagation(); setShowShortcuts(v => !v); }}
          className="w-8 h-8 rounded-full bg-black/40 backdrop-blur flex items-center justify-center hover:bg-black/60 transition-colors text-zinc-300"
          title="Keyboard shortcuts (Shift+?)"
          aria-label="Keyboard shortcuts"
        >
          <Icon name="keyboard" size={14} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setShowDebug(v => !v); }}
          className="w-8 h-8 rounded-full bg-black/40 backdrop-blur flex items-center justify-center hover:bg-black/60 transition-colors text-zinc-300"
          title="Toggle debug info"
          aria-label="Debug info"
        >
          <Icon name="debug" size={14} />
        </button>
      </div>

      {/* ── Keyboard shortcuts overlay ── */}
      {showShortcuts && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur"
          onClick={(e) => { e.stopPropagation(); setShowShortcuts(false); }}
        >
          <div
            className="bg-zinc-950/95 border border-white/10 rounded-2xl p-6 max-w-md w-[90%] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white text-lg font-bold">Keyboard Shortcuts</h3>
              <button onClick={() => setShowShortcuts(false)} className="text-zinc-400 hover:text-white">
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              {[
                ['Space / K', 'Play / Pause'],
                ['J / ←', 'Rewind 10s'],
                ['L / →', 'Forward 10s'],
                ['↑ / ↓', 'Volume up / down'],
                ['M', 'Mute / Unmute'],
                ['F', 'Fullscreen'],
                ['Shift + ?', 'Show this help'],
                ['Esc', 'Close menus'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-zinc-400">{desc}</span>
                  <kbd className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs font-mono">{key}</kbd>
                </div>
              ))}
            </div>
            <p className="text-zinc-600 text-xs mt-4 leading-5">
              Double-click left/right half of the player to skip ±10s. Single click toggles controls.
            </p>
          </div>
        </div>
      )}

      {/* ── Debug panel ── */}
      {showDebug && controlsVisible && (
        <div className="absolute top-12 right-3 bg-zinc-950/95 border border-zinc-800 rounded-xl p-3 max-h-64 overflow-y-auto min-w-[240px] shadow-2xl z-50 backdrop-blur">
          <p className="text-zinc-400 text-[10px] font-mono mb-1 uppercase tracking-wider">Debug Info</p>
          <div className="text-zinc-500 text-[10px] font-mono leading-4 space-y-0.5">
            <p>URL Quality: <span className="text-amber-400">{currentQuality}</span></p>
            <p>Playing: {isPlaying ? 'yes' : 'no'}</p>
            <p>Buffering: {isBuffering ? 'yes' : 'no'}</p>
            <p>Network: {isOnline ? 'online' : 'offline'}</p>
            <p>Time: {formatTime(currentTime)} / {formatTime(duration)}</p>
            <p>Buffered: {formatTime(buffered)} ({duration > 0 ? Math.round(bufferedPct * 100) : 0}%)</p>
            <p>Speed: {playbackRate}x</p>
            <p>Volume: {Math.round(volume * 100)}% {isMuted ? '(muted)' : ''}</p>
            <p>HLS: {hlsRef.current ? 'active' : 'none'}</p>
            <p>HLS Levels: {hlsLevels.length} {hlsLevels.length > 0 && '(' + hlsLevels.map(l => l.name).join(', ') + ')'}</p>
            <p>Current Level: {currentLevelIdx === -1 ? 'auto' : `#${currentLevelIdx}`}{autoLevelIdx >= 0 && currentLevelIdx === -1 ? ` (→ ${hlsLevels.find(l => l.index === autoLevelIdx)?.name || '#' + autoLevelIdx})` : ''}</p>
            <p>Bandwidth: {bandwidthEstimate > 0 ? (bandwidthEstimate / 1e6).toFixed(2) + ' Mbps' : 'measuring…'}</p>
            <p>Fullscreen: {isFullscreen ? 'yes' : 'no'}</p>
            <p>Sources: {sources.length}</p>
            <p>Subtitles: {subtitles.length} ({selectedSubIndex !== null ? subtitles[selectedSubIndex]?.lang : 'off'})</p>
          </div>
          <hr className="border-zinc-800 my-2" />
          <p className="text-zinc-600 text-[9px] font-mono mb-1 uppercase">Log</p>
          {debugLines.map((d, i) => (
            <p key={i} className="text-zinc-600 text-[9px] font-mono leading-4">{d}</p>
          ))}
        </div>
      )}

      {/* ── Controls overlay (bottom gradient + buttons) ── */}
      <div
        className={`absolute inset-x-0 bottom-0 top-0 z-40 flex flex-col justify-end pointer-events-none transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Invisible click-shield across the top to allow click-to-toggle */}
        <div className="flex-1" />

        {/* Bottom gradient + controls */}
        <div className="bg-gradient-to-t from-black/95 via-black/70 to-transparent pt-16 pb-3 px-4 pointer-events-auto">
          {/* Seek bar */}
          <SeekBar
            progress={displayProgress}
            buffered={bufferedPct}
            duration={duration}
            isSeeking={isSeeking}
            hoverPct={hoverPct}
            onSeekStart={handleSeekStart}
            onSeekMove={handleSeekMove}
            onSeekEnd={handleSeekEnd}
            onHover={handleHover}
            containerRef={containerRef}
          />

          {/* Time row */}
          <div className="flex justify-between items-center mt-1 mb-2">
            <span className="text-zinc-300 text-xs font-bold tabular-nums">
              {isSeeking ? formatTime(seekPreview * duration) : formatTime(currentTime)}
            </span>
            <span className="text-zinc-500 text-xs font-medium tabular-nums">
              {duration > 0 ? `-${formatTime(duration - currentTime)}` : '--:--'}
            </span>
          </div>

          {/* Buttons row */}
          <div className="flex items-center justify-between">
            {/* Left group */}
            <div className="flex items-center gap-0.5">
              <ControlButton onClick={handlePlayPause} title={isPlaying ? 'Pause (k)' : 'Play (k)'}>
                <Icon name={isPlaying ? 'pause' : 'play'} size={20} className="text-white" />
              </ControlButton>
              <ControlButton onClick={() => skip(-SKIP_SECONDS)} title="Back 10s (j)">
                <Icon name="skipBack" size={18} className="text-zinc-200" />
              </ControlButton>
              <ControlButton onClick={() => skip(SKIP_SECONDS)} title="Forward 10s (l)">
                <Icon name="skipForward" size={18} className="text-zinc-200" />
              </ControlButton>

              {/* Volume */}
              <div
                className="relative flex items-center"
                onMouseEnter={() => { setShowVolumeSlider(true); cancelAutoHide(); }}
                onMouseLeave={() => { setShowVolumeSlider(false); scheduleAutoHide(); }}
              >
                <ControlButton
                  onClick={toggleMute}
                  title="Mute (m)"
                  active={isMuted}
                >
                  <VolumeIcon size={20} />
                </ControlButton>
                {/* Volume slider popover */}
                <div
                  className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 transition-all duration-200 ${showVolumeSlider ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1 pointer-events-none'}`}
                >
                  <div className="bg-zinc-950/95 border border-zinc-800 rounded-2xl p-3 shadow-2xl backdrop-blur flex flex-col items-center gap-2">
                    <span className="text-amber-400 text-xs font-bold tabular-nums">{Math.round((isMuted ? 0 : volume) * 100)}%</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.02"
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      className="w-1.5 h-24 accent-amber-500 cursor-pointer"
                      style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                      aria-label="Volume"
                    />
                  </div>
                </div>
              </div>

              {/* Time display (mobile-ish, hidden on tiny screens) */}
              <span className="ml-1 text-zinc-400 text-xs font-medium tabular-nums hidden sm:inline">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            {/* Right group */}
            <div className="flex items-center gap-0.5">
              {/* Playback Speed */}
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowSpeedMenu(v => !v); setShowQualityMenu(false); setShowSubMenu(false); }}
                  className={`h-9 px-3 rounded-lg hover:bg-white/10 transition-colors flex items-center gap-1.5 ${playbackRate !== 1 ? 'text-amber-400' : 'text-zinc-200'}`}
                  title="Playback speed"
                >
                  <span className="text-xs font-bold">{playbackRate}x</span>
                </button>
                {showSpeedMenu && (
                  <div className="absolute bottom-full right-0 mb-2 bg-zinc-950/95 border border-zinc-800 rounded-xl shadow-2xl py-1.5 min-w-[110px] z-50 backdrop-blur"
                    onMouseLeave={() => setShowSpeedMenu(false)}>
                    <div className="px-4 py-1.5 border-b border-zinc-800 mb-1">
                      <p className="text-white text-[10px] font-bold uppercase tracking-wider">Speed</p>
                    </div>
                    {PLAYBACK_SPEEDS.map((rate) => (
                      <button
                        key={rate}
                        onClick={() => handleSpeedChange(rate)}
                        className={`w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-white/5 transition-colors ${playbackRate === rate ? 'text-amber-400' : 'text-zinc-300'}`}
                      >
                        {rate}x
                        {playbackRate === rate && <Icon name="check" size={14} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Quality */}
              {qualityLevels.length > 1 && (
                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowQualityMenu(v => !v); setShowSubMenu(false); setShowSpeedMenu(false); }}
                    className="h-9 px-3 rounded-lg hover:bg-white/10 transition-colors flex items-center gap-1.5 text-zinc-200"
                    title="Video quality"
                  >
                    <Icon name="settings" size={16} />
                    <span className="text-xs font-bold">{currentQuality}</span>
                  </button>
                  {showQualityMenu && (
                    <div className="absolute bottom-full right-0 mb-2 bg-zinc-950/95 border border-zinc-800 rounded-xl shadow-2xl py-1.5 min-w-[180px] z-50 backdrop-blur max-h-72 overflow-y-auto"
                      onMouseLeave={() => setShowQualityMenu(false)}>
                      {/* Section 1: Auto-detected HLS levels (in-flight switch via hls.currentLevel) */}
                      {hlsLevels.length > 1 && (
                        <>
                          <div className="px-4 py-1.5 border-b border-zinc-800">
                            <p className="text-white text-[10px] font-bold uppercase tracking-wider">Stream Levels</p>
                            <p className="text-zinc-500 text-[9px] mt-0.5">Switches instantly, no rebuffer</p>
                          </div>
                          <button
                            onClick={() => handleLevelSwitch(-1)}
                            className={`w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-white/5 transition-colors ${currentLevelIdx === -1 ? 'text-amber-400' : 'text-zinc-300'}`}
                          >
                            <span className="flex items-center gap-2">
                              Auto
                              {currentLevelIdx === -1 && autoLevelIdx >= 0 && (
                                <span className="text-zinc-500 text-[10px]">
                                  → {hlsLevels.find(l => l.index === autoLevelIdx)?.name || '#' + autoLevelIdx}
                                </span>
                              )}
                            </span>
                            {currentLevelIdx === -1 && <Icon name="check" size={14} />}
                          </button>
                          {hlsLevels.map((lv) => (
                            <button
                              key={`lv-${lv.index}`}
                              onClick={() => handleLevelSwitch(lv.index)}
                              className={`w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-white/5 transition-colors ${currentLevelIdx === lv.index ? 'text-amber-400' : 'text-zinc-300'}`}
                            >
                              <span className="flex items-center gap-2">
                                {lv.name}
                                {lv.bitrate > 0 && (
                                  <span className="text-zinc-600 text-[10px]">
                                    {(lv.bitrate / 1e6).toFixed(1)} Mbps
                                  </span>
                                )}
                              </span>
                              {currentLevelIdx === lv.index && <Icon name="check" size={14} />}
                            </button>
                          ))}
                        </>
                      )}

                      {/* Section 2: API-provided URL-based qualities (full re-init, preserves currentTime) */}
                      {qualityLevels.length > 1 && (
                        <>
                          <div className={`px-4 py-1.5 border-b border-zinc-800 ${hlsLevels.length > 1 ? 'mt-1 border-t' : ''}`}>
                            <p className="text-white text-[10px] font-bold uppercase tracking-wider">Source URLs</p>
                            {hlsLevels.length > 1 && (
                              <p className="text-zinc-500 text-[9px] mt-0.5">Reloads stream (may briefly buffer)</p>
                            )}
                          </div>
                          {qualityLevels.map((q) => (
                            <button
                              key={q}
                              onClick={() => handleQualityChange(q)}
                              className={`w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-white/5 transition-colors ${currentQuality === q && currentLevelIdx === -1 ? 'text-amber-400' : 'text-zinc-300'}`}
                            >
                              {q}
                              {currentQuality === q && (hlsLevels.length <= 1 || currentLevelIdx === -1) && <Icon name="check" size={14} />}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Subtitles */}
              {subtitles.length > 0 && (
                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowSubMenu(v => !v); setShowQualityMenu(false); setShowSpeedMenu(false); }}
                    className={`w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors ${selectedSubIndex !== null ? 'text-amber-400' : 'text-zinc-200'}`}
                    title="Subtitles"
                    aria-label="Subtitles"
                  >
                    <Icon name="subtitles" size={18} />
                  </button>
                  {showSubMenu && (
                    <div className="absolute bottom-full right-0 mb-2 bg-zinc-950/95 border border-zinc-800 rounded-xl shadow-2xl py-1.5 min-w-[160px] z-50 backdrop-blur"
                      onMouseLeave={() => setShowSubMenu(false)}>
                      <div className="px-4 py-1.5 border-b border-zinc-800 mb-1">
                        <p className="text-white text-[10px] font-bold uppercase tracking-wider">Subtitles</p>
                      </div>
                      <button
                        onClick={() => handleSubtitleChange(null)}
                        className={`w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-white/5 transition-colors ${selectedSubIndex === null ? 'text-amber-400' : 'text-zinc-300'}`}
                      >
                        Off
                        {selectedSubIndex === null && <Icon name="check" size={14} />}
                      </button>
                      {subtitles.map((sub, idx) => (
                        <button
                          key={`${sub.lang}-${idx}`}
                          onClick={() => handleSubtitleChange(idx)}
                          className={`w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-white/5 transition-colors ${selectedSubIndex === idx ? 'text-amber-400' : 'text-zinc-300'}`}
                        >
                          {sub.lang}
                          {selectedSubIndex === idx && <Icon name="check" size={14} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Fullscreen */}
              <ControlButton onClick={toggleFullscreen} title="Fullscreen (f)">
                <Icon name={isFullscreen ? 'fullscreenExit' : 'fullscreen'} size={20} className="text-zinc-200" />
              </ControlButton>
            </div>
          </div>
        </div>
      </div>

      {/* ── Subtitle overlay ── */}
      {activeSubText && (
        <div className="absolute bottom-20 left-4 right-4 flex items-center justify-center pointer-events-none z-25">
          <div className="bg-black/75 backdrop-blur-sm rounded-md px-4 py-1.5 max-w-[90%]">
            <p
              className="text-white text-base md:text-lg text-center leading-6 font-medium"
              style={{ textShadow: '0 1px 4px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9)' }}
            >
              {activeSubText}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default WebStreamGuidePlayer;
