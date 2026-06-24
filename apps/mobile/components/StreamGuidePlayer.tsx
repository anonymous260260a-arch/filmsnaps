import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ActivityIndicator,
  Modal,
  ScrollView,
  Animated,
  Platform,
  StatusBar,
  PanResponder,
  Dimensions,
  Easing,
  StyleSheet,
  LayoutChangeEvent,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { VideoPlayer, VideoSource } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';

// React Native global — declared for environments where @types/react-native is not configured
declare const __DEV__: boolean;

// ── Types ──

interface StreamGuideSource {
  url: string;
  language: string;
  type: string;
  quality: string;
  codec: string;
}

interface StreamGuideSubtitle {
  url: string;
  lang: string;
}

interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

interface StreamGuideResponse {
  mediaType: 'movie' | 'tv';
  tmdbId: string;
  title?: string;
  poster?: string;
  subtitles: StreamGuideSubtitle[];
  providers: Array<{
    provider: string;
    sources: StreamGuideSource[];
  }>;
}

interface StreamGuidePlayerProps {
  apiUrl: string;
  onClose?: () => void;
  onLoadStart?: () => void;
  onLoadEnd?: () => void;
  onError?: (msg: string) => void;
}

// ── Theme ──

const ACCENT = '#e8a020';
const ACCENT_BRIGHT = '#f5b53a';
const ACCENT_DIM = 'rgba(232, 160, 32, 0.18)';
const WHITE = '#ffffff';
const ZINC_100 = '#f4f4f5';
const ZINC_300 = '#d4d4d8';
const ZINC_400 = '#a1a1aa';
const ZINC_500 = '#71717a';
const ZINC_700 = '#3f3f46';
const ZINC_800 = '#27272a';
const ZINC_900 = '#18181b';
const ZINC_950 = '#09090b';

// ── Helpers ──

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const debugLog = (msg: string, data?: any) => {
  if (__DEV__) {
    if (data) console.log(`[SG] ${msg}`, typeof data === 'object' ? JSON.stringify(data).slice(0, 200) : data);
    else console.log(`[SG] ${msg}`);
  }
};

// ── Subtitle parsing ──

function parseSRTTime(t: string): number {
  const m = t.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4], 10) / 1000;
}

function parseSRT(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
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

function parseVTT(content: string): SubtitleCue[] {
  const clean = content.replace(/^WEBVTT[\s\S]*?\n(?:NOTE[\s\S]*?\n)?/, '').replace(/^WEBVTT\s*\n/, '');
  const blocks = clean.trim().split(/\n\n+/);
  const cues: SubtitleCue[] = [];
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

async function fetchSubtitles(url: string): Promise<SubtitleCue[]> {
  try {
    const res = await fetch(url, { cache: 'force-cache' });
    const text = await res.text();
    if (text.trim().startsWith('WEBVTT')) return parseVTT(text);
    return parseSRT(text);
  } catch (e) {
    console.warn('[SG] Subtitle fetch failed:', e);
    return [];
  }
}

// ── Constants ──

const SCREEN = Dimensions.get('window');
const DOUBLE_TAP_DELAY = 280;          // ms window between taps
const SKIP_SECONDS = 10;
const CONTROLS_AUTOHIDE_MS = 3500;
const SWIPE_DEAD_ZONE = 12;             // px before we treat a touch as a swipe
const GESTURE_INDICATOR_FADE_MS = 600;

// ── Sub-components ──

interface IconButtonProps {
  name: keyof typeof Ionicons.glyphMap;
  size?: number;
  color?: string;
  onPress?: () => void;
  hitSlop?: number;
  active?: boolean;
  testID?: string;
}

const IconButton: React.FC<IconButtonProps> = ({
  name,
  size = 22,
  color = ZINC_300,
  onPress,
  hitSlop = 12,
  active = false,
  testID,
}) => (
  <TouchableOpacity
    onPress={onPress}
    hitSlop={{ top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop }}
    activeOpacity={0.55}
    className="w-11 h-11 items-center justify-center"
    testID={testID}
  >
    <Ionicons name={name} size={size} color={active ? ACCENT : color} />
  </TouchableOpacity>
);

// ── SeekBar ──

interface SeekBarProps {
  progress: number;          // 0..1 played
  buffered: number;          // 0..1 buffered
  duration: number;
  isSeeking: boolean;
  onSeekStart: () => void;
  onSeekChange: (pct: number) => void;
  onSeekEnd: (pct: number) => void;
}

const SeekBar: React.FC<SeekBarProps> = ({
  progress,
  buffered,
  duration,
  isSeeking,
  onSeekStart,
  onSeekChange,
  onSeekEnd,
}) => {
  const barWidthRef = useRef(0);
  const seekingRef = useRef(false);

  const getPct = (locationX: number) =>
    Math.max(0, Math.min(1, barWidthRef.current > 0 ? locationX / barWidthRef.current : 0));

  const handleTouch = (evt: any) => {
    const pct = getPct(evt.nativeEvent.locationX);
    onSeekChange(pct);
  };

  const playedPct = Math.min(1, Math.max(0, progress)) * 100;
  const bufferedPct = Math.min(1, Math.max(0, buffered)) * 100;

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => { barWidthRef.current = e.nativeEvent.layout.width; }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => {
        seekingRef.current = true;
        onSeekStart();
        handleTouch(e);
      }}
      onResponderMove={handleTouch}
      onResponderRelease={(e) => {
        seekingRef.current = false;
        const pct = getPct(e.nativeEvent.locationX);
        onSeekEnd(pct);
      }}
      onResponderTerminationRequest={() => false}
      className="h-12 justify-center"
      style={{ paddingHorizontal: 0 }}
    >
      {/* Track background */}
      <View
        style={{
          height: isSeeking ? 5 : 3,
          backgroundColor: 'rgba(63, 63, 70, 0.55)',
          borderRadius: 999,
          overflow: 'hidden',
        }}
      >
        {/* Buffered fill */}
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${bufferedPct}%`,
            backgroundColor: 'rgba(113, 113, 122, 0.65)',
          }}
        />
        {/* Played fill with gradient feel */}
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${playedPct}%`,
            backgroundColor: ACCENT,
            shadowColor: ACCENT,
            shadowOpacity: 0.5,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 0 },
          }}
        />
      </View>

      {/* Thumb */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: '50%',
          marginTop: -7,
          marginLeft: -7,
          left: `${playedPct}%`,
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: WHITE,
          opacity: isSeeking ? 1 : 0.85,
          transform: [{ scale: isSeeking ? 1.15 : 1 }],
          shadowColor: '#000',
          shadowOpacity: 0.4,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 2 },
        }}
      />

      {/* Scrubbing preview bubble */}
      {isSeeking && duration > 0 && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -28,
            left: `${playedPct}%`,
            marginLeft: -28,
            width: 56,
            height: 24,
            borderRadius: 8,
            backgroundColor: 'rgba(9, 9, 11, 0.92)',
            borderWidth: 1,
            borderColor: 'rgba(232, 160, 32, 0.35)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: ACCENT, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
            {formatTime(progress * duration)}
          </Text>
        </View>
      )}
    </View>
  );
};

// ── Center Play / Pause Button ──

const CenterPlayButton: React.FC<{ visible: boolean; isPlaying: boolean; onPress: () => void }> = ({
  visible,
  isPlaying,
  onPress,
}) => {
  const scale = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
    } else {
      // Delay unmount until animation completes
      const t = setTimeout(() => setMounted(false), 260);
      return () => clearTimeout(t);
    }
  }, [visible]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration: 240,
        useNativeDriver: true,
        easing: Easing.out(Easing.ease),
      }),
      Animated.spring(scale, {
        toValue: visible ? 1 : 0.6,
        friction: 7,
        tension: 80,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, scale, opacity]);

  if (!mounted) return null;

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        opacity,
        zIndex: 25,
      }}
    >
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        style={{
          width: 76,
          height: 76,
          borderRadius: 38,
          backgroundColor: 'rgba(9, 9, 11, 0.55)',
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.08)',
        }}
      >
        <Ionicons
          name={isPlaying ? 'pause' : 'play'}
          size={34}
          color={WHITE}
          style={isPlaying ? undefined : { marginLeft: 4 }}
        />
      </TouchableOpacity>
    </Animated.View>
  );
};

// ── Skip Indicator (double-tap or button skip) ──

interface SkipIndicatorProps {
  indicator: { label: string; direction: 'forward' | 'backward' } | null;
  side: 'left' | 'right';
}

const SkipIndicator: React.FC<SkipIndicatorProps> = ({ indicator, side }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    if (indicator && ((side === 'left' && indicator.direction === 'backward') || (side === 'right' && indicator.direction === 'forward'))) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }),
      ]).start();
      Animated.timing(opacity, { toValue: 0, duration: 500, delay: 350, useNativeDriver: true }).start();
    } else {
      opacity.setValue(0);
    }
  }, [indicator, side, opacity, scale]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0, bottom: 0,
        [side]: 0,
        width: '40%',
        alignItems: 'center',
        justifyContent: 'center',
        opacity,
        transform: [{ scale }],
        zIndex: 22,
      }}
    >
      <View style={{ alignItems: 'center' }}>
        <Ionicons
          name={side === 'left' ? 'play-back' : 'play-forward'}
          size={42}
          color={WHITE}
        />
        <Text style={{ color: WHITE, fontSize: 13, fontWeight: '700', marginTop: 6, letterSpacing: 0.5 }}>
          {side === 'left' ? `${SKIP_SECONDS}s` : `${SKIP_SECONDS}s`}
        </Text>
      </View>
    </Animated.View>
  );
};

// ── Volume / Brightness Gesture Indicator ──

type GestureType = 'volume' | 'brightness';

interface GestureIndicatorProps {
  visible: boolean;
  type: GestureType;
  value: number; // 0..1
}

const GestureIndicator: React.FC<GestureIndicatorProps> = ({ visible, type, value }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const lastVisibleRef = useRef(false);

  useEffect(() => {
    if (visible) {
      if (!lastVisibleRef.current) {
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      }
      lastVisibleRef.current = true;
    } else if (lastVisibleRef.current) {
      Animated.timing(opacity, { toValue: 0, duration: GESTURE_INDICATOR_FADE_MS, useNativeDriver: true }).start();
      lastVisibleRef.current = false;
    }
  }, [visible, opacity]);

  const pct = Math.round(value * 100);
  const iconName = type === 'volume'
    ? (value === 0 ? 'volume-mute' : value < 0.5 ? 'volume-low' : 'volume-high')
    : 'sunny';

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        opacity,
        zIndex: 28,
      }}
    >
      <View
        style={{
          backgroundColor: 'rgba(9, 9, 11, 0.85)',
          borderRadius: 18,
          paddingHorizontal: 22,
          paddingVertical: 18,
          alignItems: 'center',
          minWidth: 110,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.06)',
        }}
      >
        <Ionicons name={iconName} size={28} color={WHITE} />
        <View style={{ width: '100%', height: 4, backgroundColor: 'rgba(63,63,70,0.6)', borderRadius: 2, marginTop: 12, overflow: 'hidden' }}>
          <View style={{ width: `${pct}%`, height: '100%', backgroundColor: ACCENT }} />
        </View>
        <Text style={{ color: WHITE, fontSize: 11, fontWeight: '600', marginTop: 8, fontVariant: ['tabular-nums'] }}>
          {pct}%
        </Text>
      </View>
    </Animated.View>
  );
};

// ── Main Component ──

export function StreamGuidePlayer({
  apiUrl,
  onClose,
  onLoadStart,
  onLoadEnd,
  onError,
}: StreamGuidePlayerProps) {
  // ── Data state ──
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiDebug, setApiDebug] = useState<string[]>([]);
  const [sources, setSources] = useState<StreamGuideSource[]>([]);
  const [subtitles, setSubtitles] = useState<StreamGuideSubtitle[]>([]);
  const [currentQuality, setCurrentQuality] = useState<string>('1080p');

  // ── Subtitle state ──
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [selectedSubIndex, setSelectedSubIndex] = useState<number | null>(null);
  const [activeSubText, setActiveSubText] = useState<string | null>(null);

  // ── Playback state ──
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0); // seconds
  const [isPlaying, setIsPlaying] = useState(false);
  const [playerStatus, setPlayerStatus] = useState<'idle' | 'loading' | 'readyToPlay' | 'error'>('idle');

  // ── UI state ──
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekProgress, setSeekProgress] = useState(0);
  const [skipIndicator, setSkipIndicator] = useState<{ label: string; direction: 'forward' | 'backward' } | null>(null);
  const [showQualityPicker, setShowQualityPicker] = useState(false);
  const [showSubPicker, setShowSubPicker] = useState(false);
  const [gestureIndicator, setGestureIndicator] = useState<{ type: GestureType; value: number } | null>(null);

  // ── Refs (non-render-critical state) ──
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const brightnessOverlayOpacity = useRef(new Animated.Value(0)).current;
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doubleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapSideRef = useRef<'left' | 'right' | null>(null);
  const playerRef = useRef<VideoPlayer | null>(null);
  const brightnessRef = useRef(0); // 0..0.6 darkening
  const volumeRef = useRef(1);     // 0..1
  const isPlayingRef = useRef(false);
  const playerStatusRef = useRef<'idle' | 'loading' | 'readyToPlay' | 'error'>('idle');
  const seekingRef = useRef(false);
  const seekProgressRef = useRef(0);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const subtitleCuesRef = useRef<SubtitleCue[]>([]);
  const selectedSubRef = useRef<number | null>(null);
  const gestureActiveRef = useRef(false);
  const gestureTypeRef = useRef<GestureType | null>(null);
  const gestureStartYRef = useRef(0);
  const gestureStartValRef = useRef(0);
  const fetchTokenRef = useRef(0);
  const playerErrorRetryRef = useRef(0);          // auto-retry counter on 'error' status
  const startupUpgradeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasStartedPlaybackRef = useRef(false);    // set true once we've reached readyToPlay + played
  const bufferingOpacity = useRef(new Animated.Value(0)).current;
  const startupQualityRef = useRef<string | null>(null); // temp lowest-quality while ramping up
  const sourcesRef = useRef<StreamGuideSource[]>([]);     // keep in sync with sources state for seek recovery
  const seekRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // downgrade timer after seek
  const currentQualityRef = useRef<string>('1080p'); // keep in sync for seek recovery timer

  const addDebug = useCallback((msg: string) => {
    setApiDebug((prev) => [...prev.slice(-9), `${new Date().toISOString().slice(11, 19)} ${msg}`]);
  }, []);

  // Keep refs in sync with state for use inside callbacks/intervals
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { playerStatusRef.current = playerStatus; }, [playerStatus]);
  useEffect(() => { seekingRef.current = isSeeking; }, [isSeeking]);
  useEffect(() => { seekProgressRef.current = seekProgress; }, [seekProgress]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { subtitleCuesRef.current = subtitleCues; }, [subtitleCues]);
  useEffect(() => { selectedSubRef.current = selectedSubIndex; }, [selectedSubIndex]);
  useEffect(() => { sourcesRef.current = sources; }, [sources]);
  useEffect(() => { currentQualityRef.current = currentQuality; }, [currentQuality]);

  // ── Resolve current source ──
  const currentSource = useMemo(() => {
    if (!sources.length) return null;
    const exact = sources.find((s) => s.quality === currentQuality);
    if (exact) return exact;
    const sorted = [...sources].sort((a, b) => (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0));
    return sorted[0];
  }, [sources, currentQuality]);

  const qualityLevels = useMemo(() => {
    const levels = sources.map((s) => s.quality);
    return Array.from(new Set<string>(levels)).sort((a, b) => (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0));
  }, [sources]);

  const videoSource: VideoSource | null = useMemo(() => {
    if (!currentSource?.url) return null;
    return { uri: currentSource.url, contentType: 'hls' };
  }, [currentSource]);

  // ── Player ──
  const player = useVideoPlayer(null, (p) => {
    playerRef.current = p;
    p.timeUpdateEventInterval = 0.25;
  });

  // ── Player event listeners (immediate status updates + auto-retry on error) ──
  useEffect(() => {
    if (!player) return;
    const statusSub = player.addListener('statusChange', (event: any) => {
      const newStatus = event?.status ?? 'idle';
      setPlayerStatus(newStatus);

      if (newStatus === 'error') {
        // Auto-retry: transient network/hls errors can often be recovered by re-replacing
        // the source (which forces a manifest re-fetch). Up to 3 attempts.
        if (playerErrorRetryRef.current < 3 && videoSource) {
          playerErrorRetryRef.current++;
          debugLog(`Player error — auto-retry ${playerErrorRetryRef.current}/3`);
          addDebug(`Player error — auto-retry ${playerErrorRetryRef.current}/3`);
          setTimeout(() => {
            try {
              const preserveTime = currentTimeRef.current;
              player.replace(videoSource);
              if (preserveTime > 1 && durationRef.current > 0) {
                setTimeout(() => {
                  try {
                    const d = preserveTime - (player.currentTime || 0);
                    if (Math.abs(d) > 0.5) player.seekBy(d);
                  } catch (e) {}
                  try { player.play(); } catch (e) {}
                }, 100);
              } else {
                try { player.play(); } catch (e) {}
              }
            } catch (e: any) {
              debugLog(`Retry failed: ${e.message}`);
            }
          }, 600);
        } else {
          const msg = 'Player encountered an error loading the video';
          setError(msg);
          setLoading(false);
          onError?.(msg);
        }
      } else if (newStatus === 'readyToPlay') {
        // Reset retry counter once we successfully reach readyToPlay
        playerErrorRetryRef.current = 0;
      }
    });
    const playingSub = player.addListener('playingChange', (event: any) => {
      setIsPlaying(!!event?.playing);
      if (event?.playing) {
        hasStartedPlaybackRef.current = true;
        // Cancel seek recovery timer — playback has resumed
        if (seekRecoveryTimerRef.current) {
          clearTimeout(seekRecoveryTimerRef.current);
          seekRecoveryTimerRef.current = null;
        }
      }
    });
    return () => {
      statusSub.remove();
      playingSub.remove();
    };
  }, [player, onError, videoSource, addDebug]);

  // ── Consolidated polling: time, duration, buffered, subtitle sync ──
  useEffect(() => {
    if (!player) return;
    const interval = setInterval(() => {
      if (!player) return;
      const t = player.currentTime || 0;
      const d = player.duration;
      if (!seekingRef.current) {
        setCurrentTime(t);
      }
      currentTimeRef.current = t;
      if (d && isFinite(d) && d > 0) {
        setDuration(d);
        durationRef.current = d;
      }
      // Buffered position (seconds)
      const bp = (player as any).bufferedPosition;
      if (typeof bp === 'number' && isFinite(bp)) {
        setBuffered(bp);
      }
      // Subtitle sync (cheap inline lookup)
      const idx = selectedSubRef.current;
      const cues = subtitleCuesRef.current;
      if (idx !== null && cues.length > 0) {
        const active = cues.find((c) => t >= c.start && t < c.end);
        setActiveSubText(active?.text || null);
      } else if (activeSubTextRef.current !== null) {
        setActiveSubText(null);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [player]);

  // ref mirror for activeSubText so the polling effect doesn't need activeSubText in deps
  const activeSubTextRef = useRef<string | null>(null);
  useEffect(() => { activeSubTextRef.current = activeSubText; }, [activeSubText]);

  // ── Apply source (replace + preserve position when switching quality) ──
  // expo-video does not expose per-variant switching (no hls.currentLevel equivalent).
  // The best we can do is call player.replace() with the new URL and seek back to the
  // previous position. We pair this with a smart-startup strategy (see below).
  useEffect(() => {
    if (!player || !videoSource) return;
    const preserveTime = currentTimeRef.current;
    try {
      player.replace(videoSource);
      // After replace, restore position if we had one
      if (preserveTime > 1 && durationRef.current > 0) {
        // Wait one tick for replace to take effect, then seek
        setTimeout(() => {
          try {
            const d = preserveTime - (player.currentTime || 0);
            if (Math.abs(d) > 0.5) player.seekBy(d);
          } catch (e) { /* ignore */ }
        }, 100);
      }
      player.play();
    } catch (e: any) {
      debugLog(`replace FAILED: ${e.message}`);
    }
  }, [player, videoSource]);

  // ── Smart startup: begin at the lowest available quality for fast playback, ──
  // ── then upgrade to the user-selected (default 1080p) quality after a short stable window. ──
  // This dramatically reduces time-to-first-frame on slower networks.
  useEffect(() => {
    if (!sources.length) return;
    // Only run smart startup on the FIRST set of sources (not on subsequent quality switches)
    if (hasStartedPlaybackRef.current) return;
    if (startupUpgradeTimerRef.current) return; // already scheduled

    const sortedAsc = [...sources].sort(
      (a, b) => (parseInt(a.quality, 10) || 0) - (parseInt(b.quality, 10) || 0)
    );
    const lowest = sortedAsc[0];
    const target = sources.find((s) => s.quality === currentQuality);

    // Only do smart startup if we have multiple qualities AND the lowest isn't already the target
    if (sources.length > 1 && lowest && target && lowest.quality !== target.quality) {
      debugLog(`Smart startup: begin @ ${lowest.quality}, upgrade to ${target.quality} after 4s`);
      addDebug(`Smart start: ${lowest.quality} → ${target.quality}`);
      startupQualityRef.current = lowest.quality;
      setCurrentQuality(lowest.quality);

      startupUpgradeTimerRef.current = setTimeout(() => {
        // Only upgrade if user hasn't manually picked something else in the meantime
        if (!hasStartedPlaybackRef.current) return;
        // Check if user manually changed quality (compare to startupQualityRef)
        // — if so, respect their choice.
        debugLog(`Smart startup: upgrading to ${target.quality}`);
        addDebug(`Upgrade → ${target.quality}`);
        startupQualityRef.current = null;
        setCurrentQuality(target.quality);
      }, 4000);
    }

    return () => {
      if (startupUpgradeTimerRef.current) {
        clearTimeout(startupUpgradeTimerRef.current);
        startupUpgradeTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);

  // ── Auto-hide controls ──
  const cancelAutoHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const fadeControls = useCallback((visible: boolean) => {
    Animated.timing(controlsOpacity, {
      toValue: visible ? 1 : 0,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [controlsOpacity]);

  const scheduleAutoHide = useCallback(() => {
    cancelAutoHide();
    hideTimerRef.current = setTimeout(() => {
      if (isPlayingRef.current && !seekingRef.current && !gestureActiveRef.current) {
        fadeControls(false);
        setControlsVisible(false);
      }
    }, CONTROLS_AUTOHIDE_MS);
  }, [cancelAutoHide, fadeControls]);

  const showControlsAnimated = useCallback(() => {
    cancelAutoHide();
    if (!controlsVisible) {
      fadeControls(true);
      setControlsVisible(true);
    }
    scheduleAutoHide();
  }, [cancelAutoHide, fadeControls, scheduleAutoHide, controlsVisible]);

  // React to play/pause changes
  useEffect(() => {
    if (playerStatus === 'readyToPlay') {
      if (isPlaying) {
        scheduleAutoHide();
      } else {
        cancelAutoHide();
        if (!controlsVisible) {
          fadeControls(true);
          setControlsVisible(true);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, playerStatus]);

  // ── Skip indicator ──
  const showSkip = useCallback((direction: 'forward' | 'backward') => {
    setSkipIndicator({ label: direction === 'forward' ? `+${SKIP_SECONDS}s` : `-${SKIP_SECONDS}s`, direction });
    if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
    skipTimerRef.current = setTimeout(() => setSkipIndicator(null), 850);
  }, []);

  // ── Playback controls ──
  const togglePlayback = useCallback(() => {
    if (!player) return;
    if (isPlayingRef.current) {
      player.pause();
    } else {
      player.play();
    }
    showControlsAnimated();
  }, [player, showControlsAnimated]);

  const skipBy = useCallback((sec: number) => {
    if (!player) return;
    player.seekBy(sec);
    showSkip(sec > 0 ? 'forward' : 'backward');
    showControlsAnimated();
    // Set seek recovery timer (same as handleSeekEnd)
    if (seekRecoveryTimerRef.current) clearTimeout(seekRecoveryTimerRef.current);
    seekRecoveryTimerRef.current = setTimeout(() => {
      seekRecoveryTimerRef.current = null;
      if (playerStatusRef.current === 'loading' && sourcesRef.current.length > 1) {
        const sortedAsc = [...sourcesRef.current].sort(
          (a, b) => (parseInt(a.quality, 10) || 0) - (parseInt(b.quality, 10) || 0)
        );
        const lowest = sortedAsc[0];
        if (lowest && currentQualityRef.current !== lowest.quality) {
          startupQualityRef.current = lowest.quality;
          setCurrentQuality(lowest.quality);
          addDebug(`Seek-recovery: downgraded to ${lowest.quality}`);
        }
      }
    }, 3000);
  }, [player, showSkip, showControlsAnimated, addDebug]);

  const skipBack = useCallback(() => skipBy(-SKIP_SECONDS), [skipBy]);
  const skipForward = useCallback(() => skipBy(SKIP_SECONDS), [skipBy]);

  // ── Seek handlers ──
  const handleSeekStart = useCallback(() => {
    setIsSeeking(true);
    seekingRef.current = true;
    cancelAutoHide();
  }, [cancelAutoHide]);

  const handleSeekChange = useCallback((pct: number) => {
    seekProgressRef.current = pct;
    setSeekProgress(pct);
  }, []);

  const handleSeekEnd = useCallback((pct: number) => {
    if (player && durationRef.current > 0) {
      const target = pct * durationRef.current;
      try {
        const d = target - (player.currentTime || 0);
        if (Math.abs(d) > 0.5) player.seekBy(d);
      } catch (e) { /* ignore */ }
      // Optimistic update
      currentTimeRef.current = target;
      setCurrentTime(target);
    }
    setIsSeeking(false);
    seekingRef.current = false;

    // ── Seek recovery timer ──
    // If the player is stuck buffering 3s after seek, auto-downgrade to lowest
    // quality so the target segment downloads faster.
    if (seekRecoveryTimerRef.current) clearTimeout(seekRecoveryTimerRef.current);
    seekRecoveryTimerRef.current = setTimeout(() => {
      seekRecoveryTimerRef.current = null;
      if (playerStatusRef.current === 'loading' && sourcesRef.current.length > 1) {
        const sortedAsc = [...sourcesRef.current].sort(
          (a, b) => (parseInt(a.quality, 10) || 0) - (parseInt(b.quality, 10) || 0)
        );
        const lowest = sortedAsc[0];
        if (lowest && currentQualityRef.current !== lowest.quality) {
          startupQualityRef.current = lowest.quality;
          setCurrentQuality(lowest.quality);
          addDebug(`Seek-recovery: downgraded to ${lowest.quality}`);
        }
      }
    }, 3000);

    if (isPlayingRef.current) scheduleAutoHide();
    else showControlsAnimated();
  }, [player, scheduleAutoHide, showControlsAnimated, addDebug]);

  // ── Brightness (overlay-based, no native dependency) ──
  const setBrightness = useCallback((value: number) => {
    const v = Math.max(0, Math.min(0.6, value));
    brightnessRef.current = v;
    Animated.timing(brightnessOverlayOpacity, {
      toValue: v,
      duration: 60,
      useNativeDriver: true,
    }).start();
  }, [brightnessOverlayOpacity]);

  // ── Volume ──
  const setVolume = useCallback((value: number) => {
    const v = Math.max(0, Math.min(1, value));
    volumeRef.current = v;
    if (player) {
      try {
        player.volume = v;
        player.muted = v === 0;
      } catch (e) { /* ignore */ }
    }
  }, [player]);

  // ── Gesture PanResponder (handles BOTH taps + vertical swipes in one responder) ──
  // Using a single PanResponder avoids the conflict where Touchable's responder
  // would not release to a sibling PanResponder on vertical move.
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => false,
    // Only capture on move if it's a clear vertical swipe
    onMoveShouldSetPanResponder: (_, gestureState) => {
      return Math.abs(gestureState.dy) > SWIPE_DEAD_ZONE &&
             Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.5;
    },
    onMoveShouldSetPanResponderCapture: () => false,
    onPanResponderGrant: (evt) => {
      // A vertical swipe has begun
      gestureActiveRef.current = true;
      const x = evt.nativeEvent.locationX;
      gestureTypeRef.current = x < SCREEN.width / 2 ? 'brightness' : 'volume';
      gestureStartYRef.current = evt.nativeEvent.pageY;
      gestureStartValRef.current = gestureTypeRef.current === 'brightness'
        ? brightnessRef.current / 0.6
        : volumeRef.current;
      setGestureIndicator({
        type: gestureTypeRef.current,
        value: gestureStartValRef.current,
      });
      // Cancel any pending single/double tap timer
      if (doubleTapTimerRef.current) {
        clearTimeout(doubleTapTimerRef.current);
        doubleTapTimerRef.current = null;
      }
      lastTapSideRef.current = null;
      cancelAutoHide();
    },
    onPanResponderMove: (evt, gestureState) => {
      if (!gestureTypeRef.current) return;
      const delta = -gestureState.dy / 250; // 250px = full range
      let newVal = gestureStartValRef.current + delta;
      newVal = Math.max(0, Math.min(1, newVal));
      if (gestureTypeRef.current === 'brightness') {
        setBrightness(newVal * 0.6);
        setGestureIndicator({ type: 'brightness', value: newVal });
      } else {
        setVolume(newVal);
        setGestureIndicator({ type: 'volume', value: newVal });
      }
    },
    onPanResponderRelease: () => {
      if (gestureActiveRef.current) {
        // Was a swipe — clean up
        gestureActiveRef.current = false;
        gestureTypeRef.current = null;
        setTimeout(() => setGestureIndicator(null), 400);
        if (isPlayingRef.current) scheduleAutoHide();
      }
    },
    onPanResponderTerminationRequest: () => false,
  }), [cancelAutoHide, scheduleAutoHide, setBrightness, setVolume]);

  // ── Tap handling (on the dedicated tap layer below controls) ──
  const handleOverlayTap = useCallback((locationX: number) => {
    // If a gesture is in progress, ignore taps
    if (gestureActiveRef.current) return;
    const side: 'left' | 'right' = locationX < SCREEN.width / 2 ? 'left' : 'right';

    if (lastTapSideRef.current === side && doubleTapTimerRef.current) {
      // Double tap confirmed
      clearTimeout(doubleTapTimerRef.current);
      doubleTapTimerRef.current = null;
      lastTapSideRef.current = null;
      // Double-tap to skip
      if (side === 'left') {
        skipBy(-SKIP_SECONDS);
      } else {
        skipBy(SKIP_SECONDS);
      }
    } else {
      // First tap — wait to see if a second comes
      if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
      lastTapSideRef.current = side;
      doubleTapTimerRef.current = setTimeout(() => {
        doubleTapTimerRef.current = null;
        lastTapSideRef.current = null;
        // Single tap → toggle controls
        if (controlsVisible) {
          cancelAutoHide();
          fadeControls(false);
          setControlsVisible(false);
        } else {
          showControlsAnimated();
        }
      }, DOUBLE_TAP_DELAY);
    }
  }, [controlsVisible, cancelAutoHide, fadeControls, showControlsAnimated, skipBy]);

  // ── Fetch API data ──
  const fetchData = useCallback(async () => {
    const token = ++fetchTokenRef.current;
    setLoading(true);
    setError(null);
    setApiDebug([]);
    addDebug(`Fetching: ${apiUrl.slice(0, 80)}...`);
    onLoadStart?.();

    try {
      const res = await fetch(apiUrl, { cache: 'force-cache' });
      addDebug(`API status: ${res.status}`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data: StreamGuideResponse = await res.json();
      if (token !== fetchTokenRef.current) return; // stale

      addDebug(`mediaType: ${data.mediaType}, providers: ${data.providers?.length}`);

      const allSources: StreamGuideSource[] = [];
      for (const p of data.providers || []) {
        for (const s of p.sources || []) {
          allSources.push(s);
        }
      }

      if (!allSources.length) throw new Error('No video sources available');
      setSources(allSources);
      setSubtitles(data.subtitles || []);
      addDebug(`${allSources.length} sources, ${data.subtitles?.length || 0} subtitles`);
    } catch (e: any) {
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
    return () => {
      fetchTokenRef.current++;
    };
  }, [apiUrl]);

  // ── Cleanup timers on unmount ──
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
      if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
      if (seekRecoveryTimerRef.current) clearTimeout(seekRecoveryTimerRef.current);
    };
  }, []);

  // ── Quality change (preserves position via the replace effect) ──
  const handleQualityChange = useCallback((quality: string) => {
    setCurrentQuality(quality);
    setShowQualityPicker(false);
    // Cancel pending seek recovery — user manually chose a quality
    if (seekRecoveryTimerRef.current) {
      clearTimeout(seekRecoveryTimerRef.current);
      seekRecoveryTimerRef.current = null;
    }
  }, []);

  // ── Subtitle change ──
  const handleSubtitleChange = useCallback(
    async (index: number | null) => {
      setSelectedSubIndex(index);
      setShowSubPicker(false);
      if (index === null || !subtitles[index]) {
        setSubtitleCues([]);
        setActiveSubText(null);
        return;
      }
      addDebug(`loading subtitle: ${subtitles[index].lang}`);
      const cues = await fetchSubtitles(subtitles[index].url);
      setSubtitleCues(cues);
      addDebug(`subtitle cues: ${cues.length}`);
    },
    [subtitles, addDebug],
  );

  // ── Buffering fade-in/out (smooth, debounced to avoid flicker on short stalls) ──
  // expo-video transitions to 'loading' status both on initial load AND when buffering mid-playback.
  // We treat the latter as "buffering" and fade the indicator in/out rather than popping it.
  const isBufferingMidPlayback = playerStatus === 'loading' && hasStartedPlaybackRef.current;
  const showBuffering = (loading || isBufferingMidPlayback) && !error;

  useEffect(() => {
    if (showBuffering) {
      // Fade in (with a tiny delay so sub-200ms stalls don't flash)
      Animated.timing(bufferingOpacity, {
        toValue: 1,
        duration: 220,
        delay: 150,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }).start();
    } else {
      // Fade out
      Animated.timing(bufferingOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
        easing: Easing.in(Easing.cubic),
      }).start();
    }
  }, [showBuffering, bufferingOpacity]);
  // ── Derived values ──
  const progress = duration > 0 ? currentTime / duration : 0;
  const displayProgress = isSeeking ? seekProgress : progress;
  const bufferedPct = duration > 0 ? Math.min(1, buffered / duration) : 0;

  // ── Error state ──
  if (error) {
    return (
      <View className="flex-1 bg-black">
        <StatusBar barStyle="light-content" />
        <View className="flex-1 items-center justify-center px-6">
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(239,68,68,0.10)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <Ionicons name="alert-circle-outline" size={28} color="#ef4444" />
          </View>
          <Text style={{ color: ZINC_300, fontSize: 16, fontWeight: '600', marginBottom: 4 }}>Stream Error</Text>
          <Text style={{ color: ZINC_500, fontSize: 13, textAlign: 'center', marginBottom: 20, lineHeight: 20 }}>{error}</Text>

          {apiDebug.length > 0 && (
            <View style={{ width: '100%', marginBottom: 20, backgroundColor: 'rgba(24,24,27,0.85)', borderRadius: 12, padding: 12, maxHeight: 160 }}>
              <ScrollView>
                {apiDebug.map((d, i) => (
                  <Text key={i} style={{ color: ZINC_500, fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 18 }}>{d}</Text>
                ))}
              </ScrollView>
            </View>
          )}

          <TouchableOpacity
            onPress={() => {
              setError(null);
              fetchData();
            }}
            style={{ backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 }}
            activeOpacity={0.85}
          >
            <Text style={{ color: '#000', fontWeight: '700', fontSize: 14 }}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} className="flex-1 bg-black">
      <StatusBar barStyle="light-content" hidden />

      {/* ── Video layer ── */}
      <View style={styles.videoLayer}>
        {videoSource && (
          <VideoView
            player={player}
            style={{ flex: 1, backgroundColor: '#000' }}
            nativeControls={false}
            contentFit="contain"
          />
        )}

        {/* ── Gesture layer (PanResponder for swipes) ── */}
        <View
          {...panResponder.panHandlers}
          style={styles.gestureLayer}
        />

        {/* ── Tap layer (single/double tap detection) ── */}
        <TouchableWithoutFeedback
          onPress={(e) => handleOverlayTap(e.nativeEvent.locationX)}
          style={styles.tapLayer}
        >
          <View style={styles.tapLayer} />
        </TouchableWithoutFeedback>

        {/* ── Skip indicators (double-tap visual feedback) ── */}
        <SkipIndicator indicator={skipIndicator} side="left" />
        <SkipIndicator indicator={skipIndicator} side="right" />

        {/* ── Gesture indicator (volume/brightness) ── */}
        <GestureIndicator
          visible={!!gestureIndicator}
          type={gestureIndicator?.type || 'volume'}
          value={gestureIndicator?.value || 0}
        />

        {/* ── Brightness darkening overlay (no native dependency) ── */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: '#000',
            opacity: brightnessOverlayOpacity,
            zIndex: 5,
          }}
        />

        {/* ── Center play / pause (when paused or visible) ── */}
        <CenterPlayButton
          visible={!isPlaying && playerStatus === 'readyToPlay'}
          isPlaying={isPlaying}
          onPress={togglePlayback}
        />

        {/* ── Loading / Buffering overlay (fade-in, debounced) ── */}
        {/* Always mounted; opacity is driven by Animated.Value. */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.55)',
            opacity: bufferingOpacity,
            zIndex: 30,
          }}
        >
          <View style={{
            backgroundColor: 'rgba(9,9,11,0.85)',
            borderRadius: 16,
            paddingHorizontal: 28,
            paddingVertical: 22,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.06)',
          }}>
            <ActivityIndicator size="large" color={ACCENT} />
            <Text style={{ color: ZINC_400, fontSize: 12, marginTop: 10, letterSpacing: 0.5 }}>
              {isBufferingMidPlayback ? 'BUFFERING' : 'LOADING'}
            </Text>
          </View>
        </Animated.View>

        {/* ── Subtitle overlay (above brightness, below controls) ── */}
        {activeSubText && (
          <View style={styles.subtitleWrap} pointerEvents="none">
            <View style={styles.subtitleBox}>
              <Text style={styles.subtitleText}>{activeSubText}</Text>
            </View>
          </View>
        )}

        {/* ── Controls overlay ── */}
        <Animated.View
          pointerEvents={controlsVisible ? 'auto' : 'none'}
          style={[styles.controlsOverlay, { opacity: controlsOpacity }]}
        >
          {/* ── Top gradient + back + quality badge ── */}
          <View style={styles.topBar} className="bg-gradient-to-b from-black/85 via-black/40 to-transparent">
            <View style={[styles.topBarContent, { marginTop: Platform.OS === 'ios' ? 44 : 16 }]}>
              {onClose && (
                <TouchableOpacity
                  onPress={onClose}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  style={styles.topBarButton}
                  activeOpacity={0.7}
                >
                  <Ionicons name="chevron-down" size={22} color={WHITE} />
                </TouchableOpacity>
              )}
              <View style={{ flex: 1 }} />
              <View style={styles.qualityBadge}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: ACCENT, marginRight: 6 }} />
                <Text style={{ color: ZINC_300, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>{currentQuality.toUpperCase()}</Text>
              </View>
            </View>
          </View>

          {/* ── Center: quick skip zones (only visible when controls visible) ── */}
          <View style={styles.centerRow} pointerEvents="box-none">
            <TouchableOpacity
              onPress={skipBack}
              activeOpacity={0.5}
              style={styles.centerSkipBtn}
              hitSlop={{ top: 20, bottom: 20, left: 0, right: 0 }}
            >
              <Ionicons name="play-back" size={26} color={ZINC_300} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={togglePlayback}
              activeOpacity={0.7}
              style={styles.centerPlayBtn}
            >
              <Ionicons name={isPlaying ? 'pause' : 'play'} size={28} color={WHITE} style={!isPlaying ? { marginLeft: 3 } : undefined} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={skipForward}
              activeOpacity={0.5}
              style={styles.centerSkipBtn}
              hitSlop={{ top: 20, bottom: 20, left: 0, right: 0 }}
            >
              <Ionicons name="play-forward" size={26} color={ZINC_300} />
            </TouchableOpacity>
          </View>

          {/* ── Bottom gradient + controls ── */}
          <View style={styles.bottomBar} className="bg-gradient-to-t from-black/90 via-black/50 to-transparent">
            <View style={styles.bottomBarContent}>
              {/* Seek bar */}
              <SeekBar
                progress={displayProgress}
                buffered={bufferedPct}
                duration={duration}
                isSeeking={isSeeking}
                onSeekStart={handleSeekStart}
                onSeekChange={handleSeekChange}
                onSeekEnd={handleSeekEnd}
              />

              {/* Time labels */}
              <View style={styles.timeRow}>
                <Text style={styles.timeText}>
                  {isSeeking ? formatTime(seekProgress * duration) : formatTime(currentTime)}
                </Text>
                <Text style={[styles.timeText, { color: ZINC_500 }]}>
                  {duration > 0 ? formatTime(duration) : '--:--'}
                </Text>
              </View>

              {/* Bottom controls row */}
              <View style={styles.bottomControlsRow}>
                {/* Left: nothing (center play already covers it) */}
                <View style={{ flex: 1 }} />

                {/* Right: Subtitles + Quality */}
                <View style={styles.rightButtons}>
                  {subtitles.length > 0 && (
                    <IconButton
                      name={selectedSubIndex !== null ? 'language' : 'language-outline'}
                      size={20}
                      onPress={() => setShowSubPicker(true)}
                      active={selectedSubIndex !== null}
                    />
                  )}
                  {qualityLevels.length > 1 && (
                    <IconButton
                      name="settings-outline"
                      size={20}
                      onPress={() => setShowQualityPicker(true)}
                    />
                  )}
                </View>
              </View>
            </View>
          </View>
        </Animated.View>
      </View>

      {/* ── Quality Picker ── */}
      <Modal visible={showQualityPicker} transparent animationType="slide" onRequestClose={() => setShowQualityPicker(false)}>
        <TouchableWithoutFeedback onPress={() => setShowQualityPicker(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalSheet}>
                <View style={styles.modalHandle} />
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Video Quality</Text>
                  <TouchableOpacity onPress={() => setShowQualityPicker(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Ionicons name="close" size={22} color={ZINC_400} />
                  </TouchableOpacity>
                </View>
                <ScrollView style={{ maxHeight: 320 }}>
                  {qualityLevels.map((q) => {
                    const active = currentQuality === q;
                    return (
                      <TouchableOpacity
                        key={q}
                        onPress={() => handleQualityChange(q)}
                        style={styles.pickerItem}
                        activeOpacity={0.7}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Ionicons name="film-outline" size={18} color={active ? ACCENT : ZINC_500} />
                          <Text style={{ marginLeft: 12, fontSize: 16, fontWeight: active ? '700' : '500', color: active ? ACCENT : ZINC_300 }}>{q}</Text>
                        </View>
                        {active && <Ionicons name="checkmark-circle" size={20} color={ACCENT} />}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ── Subtitle Picker ── */}
      <Modal visible={showSubPicker} transparent animationType="slide" onRequestClose={() => setShowSubPicker(false)}>
        <TouchableWithoutFeedback onPress={() => setShowSubPicker(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalSheet}>
                <View style={styles.modalHandle} />
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Subtitles</Text>
                  <TouchableOpacity onPress={() => setShowSubPicker(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Ionicons name="close" size={22} color={ZINC_400} />
                  </TouchableOpacity>
                </View>
                <ScrollView style={{ maxHeight: 320 }}>
                  <TouchableOpacity
                    onPress={() => handleSubtitleChange(null)}
                    style={styles.pickerItem}
                    activeOpacity={0.7}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="close-circle-outline" size={18} color={selectedSubIndex === null ? ACCENT : ZINC_500} />
                      <Text style={{ marginLeft: 12, fontSize: 16, fontWeight: selectedSubIndex === null ? '700' : '500', color: selectedSubIndex === null ? ACCENT : ZINC_300 }}>Off</Text>
                    </View>
                    {selectedSubIndex === null && <Ionicons name="checkmark-circle" size={20} color={ACCENT} />}
                  </TouchableOpacity>
                  {subtitles.map((sub, idx) => {
                    const active = selectedSubIndex === idx;
                    return (
                      <TouchableOpacity
                        key={`${sub.lang}-${idx}`}
                        onPress={() => handleSubtitleChange(idx)}
                        style={styles.pickerItem}
                        activeOpacity={0.7}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Ionicons name="language-outline" size={18} color={active ? ACCENT : ZINC_500} />
                          <Text style={{ marginLeft: 12, fontSize: 16, fontWeight: active ? '700' : '500', color: active ? ACCENT : ZINC_300 }}>{sub.lang}</Text>
                        </View>
                        {active && <Ionicons name="checkmark-circle" size={20} color={ACCENT} />}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

export default StreamGuidePlayer;

// ── Styles ──

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  videoLayer: {
    flex: 1,
    position: 'relative',
  },
  gestureLayer: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 8,
  },
  tapLayer: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 9,
  },
  subtitleWrap: {
    position: 'absolute',
    bottom: 110,
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 18,
  },
  subtitleBox: {
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    maxWidth: '92%',
  },
  subtitleText: {
    color: WHITE,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  controlsOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 20,
  },
  topBar: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 110,
  },
  topGradient: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'transparent',
    // Simulate gradient via two layers
  },
  topBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
  },
  topBarButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  qualityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  centerRow: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerSkipBtn: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 36,
  },
  centerPlayBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    paddingTop: 40,
    paddingBottom: 28,
  },
  bottomGradient: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  bottomBarContent: {
    paddingHorizontal: 16,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
    marginBottom: 10,
  },
  timeText: {
    color: ZINC_400,
    fontSize: 12,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  bottomControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rightButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  modalSheet: {
    backgroundColor: ZINC_900,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  modalTitle: {
    color: WHITE,
    fontSize: 17,
    fontWeight: '700',
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
});
