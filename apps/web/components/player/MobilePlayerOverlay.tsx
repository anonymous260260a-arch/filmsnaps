/**
 * MobilePlayerOverlay — the mobile app's HEVC player chrome, ported to the web.
 *
 * On touch/small screens (useIsMobilePlayer) DirectVideoPlayer switches movi's
 * own control bar OFF. That flips the element into its `movi-no-controls` host
 * state, which also hides its loading spinner and kills its pointer events —
 * so this overlay owns every affordance apps/mobile's PlayerOverlay has:
 *
 *   - gesture surface: tap = toggle chrome, double-tap ±10s with side ripples
 *     (40% zones, centre counts forward like mobile), hold = 2x speed
 *   - top bar: audio (badge) · source pill · ⋮ menu · lock (fullscreen only)
 *   - centre: replay-10 · gold play/pause (spinner while buffering) · forward-10
 *   - bottom: elapsed/remaining time · CC · fullscreen · 44px timeline
 *   - bottom sheets: audio, subtitles, settings (speed / screen fit / lock)
 *   - switching pill + "2× speed" pill stay up even with the chrome hidden
 *
 * Chrome auto-hides after 3s of inactivity while playing (HEVC's constant) and
 * stays pinned while paused, scrubbing or a sheet is open.
 */

"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  Pause,
  Loader2,
  Music,
  Layers,
  MoreVertical,
  Lock,
  LockOpen,
  Captions,
  Maximize,
  Minimize,
  RotateCcw,
  RotateCw,
  Zap,
  X,
  Check,
} from "lucide-react";
import type {
  PlayerAdapter,
  AudioTrack,
  SubtitleTrack,
} from "./player-adapters";
import { MobileProgressBar } from "./MobileProgressBar";
import { useAutoHideControls } from "./useAutoHideControls";
import { useDoubleTapZones } from "./useDoubleTapZones";
import { useSpeedBoost } from "./useSpeedBoost";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

const AUTO_HIDE_MS = 3000;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const FIT_OPTIONS: {
  value: "contain" | "cover" | "fill";
  label: string;
  hint: string;
}[] = [
  {
    value: "contain",
    label: "Fit to screen",
    hint: "Full picture, black bars if needed",
  },
  { value: "cover", label: "Fill screen", hint: "Crops the edges slightly" },
  { value: "fill", label: "Stretch", hint: "Fills the screen, may distort" },
];

type SheetKind = "audio" | "subtitles" | "settings" | null;

export interface MobilePlayerOverlayProps {
  player: PlayerAdapter;
  /** The <movi-player> element — buffering state + screen fit live here. */
  element: HTMLElement | null;
  /** Fullscreen target: the player wrapper, so overlays ride along. */
  hostRef: React.RefObject<HTMLDivElement | null>;
  /** Label for the source pill, e.g. "1080p · MP4 · HDHub". */
  sourceLabel?: string;
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
  currentAudioTrackId?: string;
  currentSubtitleTrackId?: string;
  onAudioTrackChange?: (trackId: string) => void;
  onSubtitleChange?: (trackId: string | null) => void;
  onSourcePicker?: () => void;
  /** Non-null while switching sources — centred pill. */
  switchingLabel?: string | null;
  /** True until the current source delivers its first frames. */
  isStreamLoading?: boolean;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/**
 * Time row readout. Keeps its own rAF loop and only commits the FORMATTED
 * string, so React bails out of re-renders until the clock actually ticks.
 */
function TimeDisplay({
  player,
  showRemaining,
}: {
  player: PlayerAdapter;
  showRemaining: boolean;
}) {
  const build = useCallback(() => {
    const t = player.getCurrentTime();
    const d = player.getDuration();
    const hasDuration = Number.isFinite(d) && d > 0;
    if (showRemaining && hasDuration) {
      return `${formatTime(t)} / -${formatTime(Math.max(0, d - t))}`;
    }
    return `${formatTime(t)} / ${formatTime(d)}`;
  }, [player, showRemaining]);

  const [text, setText] = useState(build);
  const textRef = useRef(text);

  useEffect(() => {
    textRef.current = build();
    setText(textRef.current);
    let id = 0;
    const tick = () => {
      const next = build();
      // Compare first: calling setState with an identical string every frame
      // still wakes React up 60×/s for a value that never changes.
      if (next !== textRef.current) {
        textRef.current = next;
        setText(next);
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [build]);

  return (
    <span className="text-[12px] font-semibold tabular-nums text-[#F4F4F5]">
      {text}
    </span>
  );
}

/** Bottom sheet shell — one at a time, tap the backdrop to dismiss. */
function BottomSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="pointer-events-auto absolute inset-0 z-50 flex items-end"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative flex max-h-[72%] w-full flex-col overflow-hidden rounded-t-2xl border-x border-t border-white/[0.08] bg-[#16161A] shadow-2xl"
        style={{
          animation: "fsSheetUp 0.22s ease-out",
          paddingBottom: "max(8px, env(safe-area-inset-bottom))",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <h3 className="text-sm font-bold text-white">{title}</h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/50 transition-colors hover:text-white"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function SheetSection({ label }: { label: string }) {
  return (
    <div className="bg-[#222226] px-5 py-2">
      <span className="text-[11px] font-bold uppercase tracking-wider text-[#D4A237]">
        {label}
      </span>
    </div>
  );
}

function SheetRow({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 border-l-[3px] px-5 py-3.5 text-left transition-colors ${
        active
          ? "border-l-[#D4A237]/60 bg-[#D4A237]/15"
          : "border-l-transparent hover:bg-white/[0.03]"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-sm font-semibold ${active ? "text-[#D4A237]" : "text-white"}`}
        >
          {label}
        </div>
        {hint && <div className="mt-0.5 text-xs text-white/40">{hint}</div>}
      </div>
      {active && <Check size={16} className="shrink-0 text-[#D4A237]" />}
    </button>
  );
}

export function MobilePlayerOverlay({
  player,
  element,
  hostRef,
  sourceLabel,
  audioTracks,
  subtitleTracks,
  currentAudioTrackId,
  currentSubtitleTrackId,
  onAudioTrackChange,
  onSubtitleChange,
  onSourcePicker,
  switchingLabel,
  isStreamLoading = false,
}: MobilePlayerOverlayProps) {
  const [paused, setPaused] = useState(() => player.isPaused());
  const [buffering, setBuffering] = useState(true);
  const [nativeFs, setNativeFs] = useState(false);
  const [pseudoFs, setPseudoFs] = useState(false);
  const [showRemaining, setShowRemaining] = useState(false);
  const [locked, setLocked] = useState(false);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [manuallyHidden, setManuallyHidden] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [ripple, setRipple] = useState<{
    side: "left" | "right";
    amount: number;
  } | null>(null);
  const [speed, setSpeed] = useState(() => player.getPlaybackRate());
  const [fit, setFit] = useState<"contain" | "cover" | "fill">(() => {
    const current = (element as { objectFit?: string } | null)?.objectFit;
    return current === "cover" || current === "fill" ? current : "contain";
  });
  // Picked tracks — optimistic so the sheets tick instantly, reconciled from
  // the props whenever the element reports a different selection.
  const [audioId, setAudioId] = useState<string | null>(
    currentAudioTrackId ?? null,
  );
  const [subId, setSubId] = useState<string | null>(
    currentSubtitleTrackId ?? null,
  );

  const isFullscreen = nativeFs || pseudoFs;
  const sheetOpen = sheet !== null;

  useEffect(() => {
    setAudioId(currentAudioTrackId ?? null);
  }, [currentAudioTrackId]);
  useEffect(() => {
    setSubId(currentSubtitleTrackId ?? null);
  }, [currentSubtitleTrackId]);

  // ── Play/pause ──
  useEffect(() => {
    const off = player.onPlayPause?.(() => setPaused(player.isPaused()));
    setPaused(player.isPaused());
    return () => off?.();
  }, [player]);

  // ── Buffering — movi emits `statechange` (PlayerState), never `waiting` ──
  useEffect(() => {
    if (!element) return;
    const onState = (evt: Event) => {
      const state = (evt as CustomEvent<string>).detail;
      if (state === "buffering" || state === "seeking") setBuffering(true);
      else if (
        state === "playing" ||
        state === "paused" ||
        state === "ready" ||
        state === "ended"
      ) {
        setBuffering(false);
      }
    };
    element.addEventListener("statechange", onState);
    return () => element.removeEventListener("statechange", onState);
  }, [element]);

  // ── Fullscreen (host-targeted so this overlay rides along) ──
  useEffect(() => {
    const onFsChange = () => {
      const host = hostRef.current;
      setNativeFs(!!host && document.fullscreenElement === host);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    onFsChange();
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [hostRef]);

  useEffect(() => {
    if (!pseudoFs) return;
    const host = hostRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      host?.classList.remove("movi-host-fs");
      setPseudoFs(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pseudoFs, hostRef]);

  // Lock is a pocket-watching feature — it only exists in fullscreen.
  useEffect(() => {
    if (!isFullscreen && locked) setLocked(false);
  }, [isFullscreen, locked]);

  // ── Chrome visibility ──
  const forceVisible =
    !locked &&
    !manuallyHidden &&
    (paused || scrubbing || sheetOpen || isStreamLoading);
  const { visible, show } = useAutoHideControls(AUTO_HIDE_MS, forceVisible);
  const chromeVisible = visible && !manuallyHidden && !locked;
  const chromeVisibleRef = useRef(chromeVisible);
  chromeVisibleRef.current = chromeVisible;
  // Releasing a hold-to-2x fires a click too — swallow it so it doesn't count
  // as a tap-to-hide.
  const suppressClickUntilRef = useRef(0);
  // `pointer-events` inherits: the chrome container is always `none`, so every
  // tappable element re-enables itself only while the chrome is actually up.
  const interactive = chromeVisible
    ? "pointer-events-auto"
    : "pointer-events-none";

  const reveal = useCallback(() => {
    setManuallyHidden(false);
    show();
  }, [show]);

  const toggleChrome = useCallback(() => {
    if (locked) return;
    if (Date.now() < suppressClickUntilRef.current) return;
    if (chromeVisibleRef.current) setManuallyHidden(true);
    else reveal();
  }, [locked, reveal]);

  const seekBy = useCallback(
    (delta: number) => {
      const duration = player.getDuration();
      const ceiling = duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
      const target = Math.max(
        0,
        Math.min(ceiling, player.getCurrentTime() + delta),
      );
      player.seek(target);
      reveal();
    },
    [player, reveal],
  );

  // ── Double-tap ripples (cumulative within a burst, like mobile) ──
  const rippleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rippleAmountRef = useRef(0);
  const rippleSideRef = useRef<"left" | "right">("right");
  const flashRipple = useCallback((side: "left" | "right", delta: number) => {
    const amount = Math.abs(delta);
    rippleAmountRef.current =
      rippleSideRef.current === side
        ? rippleAmountRef.current + amount
        : amount;
    rippleSideRef.current = side;
    setRipple({ side, amount: rippleAmountRef.current });
    if (rippleTimerRef.current) clearTimeout(rippleTimerRef.current);
    rippleTimerRef.current = setTimeout(() => {
      setRipple(null);
      rippleAmountRef.current = 0;
    }, 650);
  }, []);
  useEffect(
    () => () => {
      if (rippleTimerRef.current) clearTimeout(rippleTimerRef.current);
    },
    [],
  );

  const skipBack = useCallback(() => {
    seekBy(-10);
    flashRipple("left", -10);
  }, [seekBy, flashRipple]);
  const skipFwd = useCallback(() => {
    seekBy(10);
    flashRipple("right", 10);
  }, [seekBy, flashRipple]);

  const { onClick: onZoneClick } = useDoubleTapZones({
    onDoubleLeft: skipBack,
    onDoubleRight: skipFwd,
    // Mobile's centre double-tap skips forward too (not play/pause).
    onDoubleCenter: skipFwd,
    onSingle: () => toggleChrome(),
    disabled: locked,
  });

  // ── Hold-to-2x ──
  const { isBoosted, longPressHandlers: rawLongPress } = useSpeedBoost({
    player,
    normalRate: speed,
    boostRate: 2,
    enabled: !locked && !sheetOpen,
  });
  const isBoostedRef = useRef(isBoosted);
  isBoostedRef.current = isBoosted;
  const longPressHandlers = {
    ...rawLongPress,
    onPointerUp: (e: React.PointerEvent) => {
      if (isBoostedRef.current)
        suppressClickUntilRef.current = Date.now() + 600;
      rawLongPress.onPointerUp(e);
    },
  };

  // ── Fullscreen toggle (host first, hand-rolled fallback on iOS Safari) ──
  const toggleFullscreen = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    if (document.fullscreenElement === host) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    if (host.classList.contains("movi-host-fs")) {
      host.classList.remove("movi-host-fs");
      setPseudoFs(false);
      return;
    }
    if (
      typeof host.requestFullscreen === "function" &&
      document.fullscreenEnabled
    ) {
      host.requestFullscreen().catch(() => {});
      return;
    }
    host.classList.add("movi-host-fs");
    setPseudoFs(true);
  }, [hostRef]);

  useEffect(
    () => () => {
      hostRef.current?.classList.remove("movi-host-fs");
    },
    [hostRef],
  );

  // Narrow desktop windows still get K/J/L/arrows/M/F — movi's own hotkeys
  // are off (nohotkeys) and the page-level shortcuts defer to __fsMoviKeysActive.
  useKeyboardShortcuts(player, !locked && !sheetOpen, toggleFullscreen);

  // ── Control actions ──
  const togglePlayPause = useCallback(() => {
    if (player.isPaused()) player.play();
    else player.pause();
    reveal();
  }, [player, reveal]);

  const handleSeek = useCallback((time: number) => player.seek(time), [player]);

  const openAudio = () => setSheet("audio");
  const openSubtitles = () => setSheet("subtitles");
  const openSettings = () => setSheet("settings");

  const pickAudio = (id: string) => {
    setAudioId(id);
    onAudioTrackChange?.(id);
    setSheet(null);
    reveal();
  };
  const pickSubtitle = (id: string | null) => {
    setSubId(id);
    onSubtitleChange?.(id);
    setSheet(null);
    reveal();
  };
  const applySpeed = (value: number) => {
    setSpeed(value);
    player.setPlaybackRate(value);
    reveal();
  };
  const applyFit = (value: "contain" | "cover" | "fill") => {
    setFit(value);
    if (element) {
      (element as HTMLElement & { objectFit?: string }).objectFit = value;
    }
    reveal();
  };

  const activeAudio = audioTracks.find((t) => t.id === audioId);
  const audioBadge = activeAudio?.language
    ? activeAudio.language.toUpperCase().slice(0, 3)
    : null;
  const subtitlesOn = subId != null;

  return (
    <>
      {/* ── Gesture surface (always live, under the chrome) ── */}
      <div
        className="absolute inset-0 z-10 touch-none"
        onClick={onZoneClick}
        onContextMenu={(e) => e.preventDefault()}
        {...longPressHandlers}
      >
        {/* Loading — movi hides its own spinner in `movi-no-controls` */}
        {isStreamLoading && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4">
            <Loader2
              size={40}
              className="animate-spin text-[#D4A237]"
              style={{ animationDuration: "1.2s" }}
            />
            <p className="text-xs font-black uppercase tracking-[0.3em] text-white/45">
              Loading
            </p>
          </div>
        )}

        {/* Switching pill — stays up with the chrome hidden */}
        {switchingLabel && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
            <div className="flex max-w-[86%] items-center gap-2 rounded-full bg-black/75 px-4 py-2">
              <Loader2
                size={14}
                className="shrink-0 animate-spin text-[#D4A237]"
              />
              <span className="truncate text-[13px] font-semibold text-[#F4F4F5]">
                {switchingLabel}
              </span>
            </div>
          </div>
        )}

        {/* 2× speed hold indicator */}
        {isBoosted && (
          <div className="pointer-events-none absolute left-1/2 top-16 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/75 px-3 py-1.5">
            <Zap size={12} className="text-[#D4A237]" />
            <span className="text-xs font-bold text-[#D4A237]">2× speed</span>
          </div>
        )}

        {/* Double-tap seek ripples */}
        {ripple && (
          <div
            key={`${ripple.side}-${ripple.amount}`}
            className={`pointer-events-none absolute inset-y-0 z-[25] flex w-[45%] items-center justify-center overflow-hidden ${
              ripple.side === "left" ? "left-0" : "right-0"
            }`}
            style={{ animation: "fsFadeIn 0.15s ease-out" }}
          >
            <div
              className={`absolute -inset-y-12 w-[120%] bg-white/[0.12] ${
                ripple.side === "left"
                  ? "left-[-20%] rounded-r-[200px]"
                  : "right-[-20%] rounded-l-[200px]"
              }`}
            />
            <div className="relative flex flex-col items-center gap-1.5">
              {ripple.side === "left" ? (
                <RotateCcw size={36} className="text-[#F4F4F5]" />
              ) : (
                <RotateCw size={36} className="text-[#F4F4F5]" />
              )}
              <span
                className="text-[13px] font-bold tracking-wide text-[#F4F4F5]"
                style={{ textShadow: "0 1px 3px rgba(0,0,0,0.75)" }}
              >
                {ripple.amount} seconds
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Chrome ── */}
      <div
        className={`pointer-events-none absolute inset-0 z-20 transition-opacity duration-200 ${
          chromeVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        {/* Top bar — no scrim/backdrop at all; bare buttons only. */}
        <div
          className="absolute inset-x-0 top-0 pb-5"
          style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
        >
          <div className="flex items-center gap-0.5 px-2">
            <div className="ml-auto flex items-center gap-1">
              {audioTracks.length > 1 && (
                <button
                  onClick={openAudio}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-full text-[#F4F4F5] transition-colors active:bg-white/10 ${interactive}`}
                  aria-label={
                    audioBadge
                      ? `Audio tracks, currently ${audioBadge}`
                      : "Audio tracks"
                  }
                >
                  <Music size={21} />
                  {audioBadge && (
                    <span className="absolute bottom-0.5 right-0.5 rounded bg-[rgba(212,162,55,0.2)] px-1 text-[9px] font-extrabold leading-tight text-[#D4A237]">
                      {audioBadge}
                    </span>
                  )}
                </button>
              )}

              {onSourcePicker && sourceLabel && (
                <button
                  onClick={() => {
                    onSourcePicker();
                    reveal();
                  }}
                  className={`flex h-[30px] items-center gap-1.5 rounded-full bg-white/10 px-2.5 transition-colors active:bg-white/20 ${interactive}`}
                  aria-label="Choose source"
                >
                  <Layers size={14} className="shrink-0 text-[#D4A237]" />
                  <span className="max-w-[110px] truncate text-[11.5px] font-bold text-[#D4A237]">
                    {sourceLabel}
                  </span>
                </button>
              )}

              <button
                onClick={openSettings}
                className={`flex h-10 w-10 items-center justify-center rounded-full text-[#F4F4F5] transition-colors active:bg-white/10 ${interactive}`}
                aria-label="More playback options"
              >
                <MoreVertical size={20} />
              </button>

              {isFullscreen && !locked && (
                <button
                  onClick={() => {
                    setLocked(true);
                    setManuallyHidden(true);
                  }}
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-[#F4F4F5] transition-colors active:bg-white/10 ${interactive}`}
                  aria-label="Lock controls"
                >
                  <Lock size={20} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Centre playback cluster */}
        <div className="absolute inset-0 flex items-center justify-center gap-10">
          {!isStreamLoading && (
            <>
              <button
                onClick={skipBack}
                className={`flex h-[54px] w-[54px] items-center justify-center rounded-full transition-transform active:scale-95 ${interactive}`}
                aria-label="Rewind 10 seconds"
              >
                <span className="relative flex items-center justify-center">
                  <RotateCcw size={34} className="text-[#F4F4F5]" />
                  <span className="absolute text-[11px] font-black text-[#F4F4F5]">
                    10
                  </span>
                </span>
              </button>

              <button
                onClick={togglePlayPause}
                className={`flex h-16 w-16 items-center justify-center rounded-full bg-[#D4A237] shadow-[0_4px_16px_rgba(212,162,55,0.45)] transition-transform active:scale-95 ${interactive}`}
                aria-label={paused ? "Play" : "Pause"}
              >
                {buffering ? (
                  <Loader2
                    size={26}
                    className="animate-spin text-[#0B0B0E]"
                    style={{ animationDuration: "0.9s" }}
                  />
                ) : paused ? (
                  <Play
                    size={32}
                    className="ml-1 text-[#0B0B0E]"
                    fill="currentColor"
                  />
                ) : (
                  <Pause
                    size={30}
                    className="text-[#0B0B0E]"
                    fill="currentColor"
                  />
                )}
              </button>

              <button
                onClick={skipFwd}
                className={`flex h-[54px] w-[54px] items-center justify-center rounded-full transition-transform active:scale-95 ${interactive}`}
                aria-label="Forward 10 seconds"
              >
                <span className="relative flex items-center justify-center">
                  <RotateCw size={34} className="text-[#F4F4F5]" />
                  <span className="absolute text-[11px] font-black text-[#F4F4F5]">
                    10
                  </span>
                </span>
              </button>
            </>
          )}
        </div>

        {/* Bottom bar */}
        <div
          className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent pt-3"
          style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
        >
          <div className="mb-0.5 flex items-center justify-between px-4">
            <button
              onClick={() => setShowRemaining((prev) => !prev)}
              className={`flex h-9 items-center px-1 ${interactive}`}
              aria-label="Toggle remaining time"
            >
              <TimeDisplay player={player} showRemaining={showRemaining} />
            </button>

            <div className="flex items-center gap-1">
              {subtitleTracks.length > 0 && (
                <button
                  onClick={openSubtitles}
                  className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors active:bg-white/10 ${interactive}`}
                  aria-label="Subtitles"
                >
                  <Captions
                    size={22}
                    className={
                      subtitlesOn ? "text-[#D4A237]" : "text-[#F4F4F5]"
                    }
                  />
                </button>
              )}
              <button
                onClick={toggleFullscreen}
                className={`flex h-10 w-10 items-center justify-center rounded-full text-[#F4F4F5] transition-colors active:bg-white/10 ${interactive}`}
                aria-label={
                  isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
                }
              >
                {isFullscreen ? <Minimize size={22} /> : <Maximize size={22} />}
              </button>
            </div>
          </div>

          <div className={interactive}>
            <MobileProgressBar
              player={player}
              onSeek={handleSeek}
              onSeekStart={() => {
                setScrubbing(true);
                reveal();
              }}
              onSeekEnd={() => setScrubbing(false)}
              active={chromeVisible}
            />
          </div>
        </div>
      </div>

      {/* ── Locked: the only control that answers ── */}
      {locked && (
        <button
          onClick={() => {
            setLocked(false);
            reveal();
          }}
          className="absolute right-3 top-14 z-40 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-[#D4A237]"
          aria-label="Unlock controls"
        >
          <LockOpen size={19} />
        </button>
      )}

      {/* ── Sheets ── */}
      <BottomSheet
        open={sheet === "audio"}
        title="Audio"
        onClose={() => setSheet(null)}
      >
        {audioTracks.map((track) => (
          <SheetRow
            key={track.id}
            label={track.label}
            hint={track.language}
            active={track.id === audioId}
            onClick={() => pickAudio(track.id)}
          />
        ))}
      </BottomSheet>

      <BottomSheet
        open={sheet === "subtitles"}
        title="Subtitles"
        onClose={() => setSheet(null)}
      >
        <SheetRow
          label="Off"
          active={subId == null}
          onClick={() => pickSubtitle(null)}
        />
        {subtitleTracks.map((track) => (
          <SheetRow
            key={track.id}
            label={track.label}
            hint={track.language}
            active={track.id === subId}
            onClick={() => pickSubtitle(track.id)}
          />
        ))}
      </BottomSheet>

      <BottomSheet
        open={sheet === "settings"}
        title="Settings"
        onClose={() => setSheet(null)}
      >
        <SheetSection label="Playback speed" />
        {SPEEDS.map((value) => (
          <SheetRow
            key={value}
            label={`${value}×`}
            active={speed === value}
            onClick={() => applySpeed(value)}
          />
        ))}

        <SheetSection label="Screen fit" />
        {FIT_OPTIONS.map((option) => (
          <SheetRow
            key={option.value}
            label={option.label}
            hint={option.hint}
            active={fit === option.value}
            onClick={() => applyFit(option.value)}
          />
        ))}

        {isFullscreen && (
          <>
            <SheetSection label="Controls" />
            <SheetRow
              label="Lock controls"
              hint="Freezes every gesture until unlocked"
              onClick={() => {
                setLocked(true);
                setManuallyHidden(true);
                setSheet(null);
              }}
            />
          </>
        )}
      </BottomSheet>

      <style>{`
        @keyframes fsFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes fsSheetUp {
          from { transform: translateY(24px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .movi-host-fs {
          position: fixed !important;
          inset: 0 !important;
          z-index: 60 !important;
        }
      `}</style>
    </>
  );
}
