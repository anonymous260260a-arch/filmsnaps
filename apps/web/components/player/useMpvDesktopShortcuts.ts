"use client";

/**
 * useMpvDesktopShortcuts — YouTube-style keyboard shortcuts for mpv playback,
 * bound in the MAIN window.
 *
 * Why the main window? The mpv video window (which hosts the overlay controls
 * page) is created with focusable:false so it never steals focus from the app.
 * That also means it can never receive keydown events — its ControlBar's
 * useKeyboardShortcuts is inert. The main window always holds keyboard focus
 * (clicks on the non-focusable video window don't move focus), so shortcuts
 * are bound here and drive electronAPI.mpv directly.
 *
 * State source: `mpv.getState()` is a PROMISE (IPC round-trip), never a sync
 * snapshot — the first version read `.position` off the promise itself and
 * every seek collapsed to 0. Instead we hydrate once from getState() and then
 * keep a ref fresh from the mpv event stream (property-change etc.).
 *
 * Shortcuts (YouTube parity):
 *   K           → play/pause  (Space is deliberately NOT bound here —
 *                             PlayerShell's useSpeedBoost owns Space so a tap
 *                             toggles on keyup and a hold runs the 2x boost;
 *                             binding it here too made one press fire twice)
 *   J / L       → seek −10s / +10s
 *   ← / →      → seek −5s / +5s
 *   ↑ / ↓      → volume ±5%
 *   M           → mute toggle
 *   F           → fullscreen toggle (mpv window follows main window)
 *   0–9         → jump to 0–90% of duration
 *   > / <       → playback speed up / down (0.25 steps, clamped 0.25–2)
 *
 * While enabled, `window.__fsMpvKeysActive` is set so page-level listeners
 * (useWatchKeyboardShortcuts) defer these keys — otherwise F toggled the
 * Electron window fullscreen twice (net zero) and arrows both seeked and
 * skipped episodes.
 *
 * Disabled while an input/textarea/contentEditable has focus, while modifier
 * chords are held (don't hijack Ctrl+F etc.), and while `enabled` is false
 * (non-mpv decoders, source picker open, mpv bridge missing).
 */

import { useEffect, useRef } from "react";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

interface MpvSnapshot {
  paused: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  speed: number;
}

const DEFAULT_STATE: MpvSnapshot = {
  paused: true,
  position: 0,
  duration: 0,
  volume: 100,
  muted: false,
  speed: 1,
};

export function useMpvDesktopShortcuts(enabled: boolean) {
  // Ref (not state) — keydown handlers read the freshest value without
  // re-binding listeners on every property change.
  const stateRef = useRef<MpvSnapshot>(DEFAULT_STATE);
  // Host (window) fullscreen. Escape must EXIT fullscreen but must NOT enter
  // it when pressed while windowed. Kept fresh from the player:state push
  // (fires on every enter/leave, however it was toggled) plus the mpv event
  // stream — this hook unmounts while the picker/overlays are open and would
  // otherwise miss transitions that happened in between.
  const isFullscreenRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const mpv = (window as any).electronAPI?.mpv;
    if (!mpv) return;

    // Hydrate from the main process's cached state, then track changes.
    mpv
      .getState?.()
      .then((s: MpvSnapshot | null) => {
        if (s) stateRef.current = { ...DEFAULT_STATE, ...s };
      })
      .catch(() => {});

    const applyProp = (name: string, value: any) => {
      const cur = stateRef.current;
      switch (name) {
        case "time-pos":
          if (typeof value === "number") cur.position = value;
          break;
        case "duration":
          if (typeof value === "number") cur.duration = value;
          break;
        case "pause":
          cur.paused = !!value;
          break;
        case "volume":
          if (typeof value === "number") cur.volume = value;
          break;
        case "mute":
          cur.muted = !!value;
          break;
        case "speed":
          if (typeof value === "number") cur.speed = value;
          break;
      }
    };

    const off = mpv.onEvent?.((ev: any) => {
      const raw = ev?.raw ?? ev;
      if (raw?.event === "property-change") {
        applyProp(raw?.name ?? raw?.data?.name, raw?.data);
      } else if (raw?.event === "pause") {
        stateRef.current.paused = true;
      } else if (raw?.event === "unpause") {
        stateRef.current.paused = false;
      } else if (ev?.type === "host-fullscreen") {
        isFullscreenRef.current = !!ev?.value;
      }
    });

    // player:state carries isFullscreen on every window fullscreen transition
    // (main.ts pushes it from enter-/leave-full-screen) — the authoritative
    // feed for the Escape handler.
    const offPlayerState = (window as any).electronAPI?.player?.onState?.(
      (s: any) => {
        if (typeof s?.isFullscreen === "boolean")
          isFullscreenRef.current = s.isFullscreen;
      },
    );

    // Claim ownership so page-level shortcuts defer these keys.
    (window as any).__fsMpvKeysActive = true;

    return () => {
      (window as any).__fsMpvKeysActive = false;
      off?.();
      offPlayerState?.();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const mpv = (window as any).electronAPI?.mpv;
    if (!mpv) return;

    const clamp = (v: number, lo: number, hi: number) =>
      Math.min(hi, Math.max(lo, v));

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (target?.contentEditable === "true") return;

      const st = stateRef.current;

      switch (e.key) {
        // Space is intentionally absent — useSpeedBoost (PlayerShell) owns it:
        // quick tap toggles play/pause, holding boosts to 2x until release.
        case "k":
        case "K": {
          if (e.repeat) return;
          e.preventDefault();
          if (st.paused) mpv.resume?.();
          else mpv.pause?.();
          break;
        }
        case "j":
        case "J":
          e.preventDefault();
          mpv.seek?.(clamp(st.position - 10, 0, st.duration));
          break;
        case "l":
        case "L":
          e.preventDefault();
          mpv.seek?.(clamp(st.position + 10, 0, st.duration));
          break;
        case "ArrowLeft":
          e.preventDefault();
          mpv.seek?.(clamp(st.position - 5, 0, st.duration));
          break;
        case "ArrowRight":
          e.preventDefault();
          mpv.seek?.(clamp(st.position + 5, 0, st.duration));
          break;
        case "ArrowUp":
          e.preventDefault();
          mpv.setVolume?.(clamp(st.volume + 5, 0, 100));
          break;
        case "ArrowDown":
          e.preventDefault();
          mpv.setVolume?.(clamp(st.volume - 5, 0, 100));
          break;
        case "m":
        case "M": {
          if (e.repeat) return;
          e.preventDefault();
          mpv.setMuted?.(!st.muted);
          break;
        }
        case "f":
        case "F":
          if (e.repeat) return;
          e.preventDefault();
          mpv.toggleFullscreen?.();
          break;
        case ">":
        case "<": {
          if (e.repeat) return;
          e.preventDefault();
          const idx = SPEEDS.findIndex((s) => Math.abs(s - st.speed) < 0.001);
          const next =
            e.key === ">"
              ? SPEEDS[clamp((idx < 0 ? 2 : idx) + 1, 0, SPEEDS.length - 1)]
              : SPEEDS[clamp((idx < 0 ? 4 : idx) - 1, 0, SPEEDS.length - 1)];
          if (next !== st.speed) mpv.setProperty?.("speed", next);
          break;
        }
        case "Escape": {
          if (e.repeat) return;
          // Only EXIT on Escape — while windowed, fall through so the
          // page-level handler keeps ESC = go back.
          if (!isFullscreenRef.current) return;
          e.preventDefault();
          mpv.toggleFullscreen?.();
          break;
        }
        default: {
          if (/^[0-9]$/.test(e.key)) {
            e.preventDefault();
            if (st.duration > 0)
              mpv.seek?.((parseInt(e.key, 10) / 10) * st.duration);
          }
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);
}
