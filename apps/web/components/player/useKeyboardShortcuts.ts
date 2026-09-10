/**
 * useKeyboardShortcuts — binds standard video player keyboard shortcuts.
 *
 * Supported (when enabled and not in an input):
 *   K          → play/pause (tap)
 *   Arrow L/R  → seek ±5s
 *   J / L      → seek -10s / +10s
 *   Arrow U/D  → volume ±5%
 *   M          → mute toggle
 *   F          → fullscreen toggle
 *
 * Note: the Space bar is intentionally NOT bound to play/pause here — it's
 * reserved for the hold-to-2x-speed gesture (see useSpeedBoost). A quick tap
 * of Space with no movement still doesn't toggle playback, matching the
 * "hold" semantics requested; use K for a tap-to-toggle shortcut instead.
 */

"use client";

import { useEffect } from "react";
import type { PlayerAdapter } from "./player-adapters";

export function useKeyboardShortcuts(
  player: PlayerAdapter,
  enabled: boolean = true,
) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (target?.contentEditable === "true") return;

      switch (e.key) {
        case "k":
          e.preventDefault();
          if (player.isPaused()) player.play();
          else player.pause();
          break;

        case "ArrowLeft":
          e.preventDefault();
          player.seek(Math.max(0, player.getCurrentTime() - 5));
          break;

        case "ArrowRight":
          e.preventDefault();
          player.seek(
            Math.min(player.getDuration(), player.getCurrentTime() + 5),
          );
          break;

        case "j":
          e.preventDefault();
          player.seek(Math.max(0, player.getCurrentTime() - 10));
          break;

        case "l":
          e.preventDefault();
          player.seek(
            Math.min(player.getDuration(), player.getCurrentTime() + 10),
          );
          break;

        case "ArrowUp":
          e.preventDefault();
          player.setVolume(Math.min(1, player.getVolume() + 0.05));
          break;

        case "ArrowDown":
          e.preventDefault();
          player.setVolume(Math.max(0, player.getVolume() - 0.05));
          break;

        case "m":
          e.preventDefault();
          player.setMuted(!player.isMuted());
          break;

        case "f":
          e.preventDefault();
          if (document.fullscreenElement)
            document.exitFullscreen().catch(() => {});
          else player.requestFullscreen();
          break;

        default:
          return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [player, enabled]);
}
