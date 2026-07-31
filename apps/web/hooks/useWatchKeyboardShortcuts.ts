/**
 * useWatchKeyboardShortcuts — keyboard shortcuts for the Watch page.
 *
 * Desktop mode adds extra shortcuts (Server dropdown, mute, etc.)
 *
 * | Key   | Action                         |
 * |-------|--------------------------------|
 * | F     | Toggle fullscreen              |
 * | S     | Open server dropdown           |
 * | ← / → | Prev / Next episode (TV only)  |
 * | Escape| Exit fullscreen → then go back |
 * | ?     | Show shortcut overlay          |
 * | M     | Toggle mute (desktop only)     |
 * | N / P | Next / Prev episode (alt)      |
 */

"use client";

import { useEffect, useCallback, useState } from "react";
import { usePlayer } from "@/components/player/PlayerProvider";

interface UseKeyboardShortcutsOptions {
  /** Whether we're in desktop layout mode */
  isDesktop: boolean;
  /** Whether the server dropdown is open */
  isServerOpen: boolean;
  /** Callback to toggle server dropdown */
  onServerToggle?: () => void;
  /** Callback for navigation back */
  onGoBack?: () => void;
}

export function useWatchKeyboardShortcuts({
  isDesktop,
  isServerOpen,
  onServerToggle,
  onGoBack,
}: UseKeyboardShortcutsOptions) {
  const {
    toggleFullscreen,
    goToNextEpisode,
    goToPrevEpisode,
    isFullscreen,
    setIsFullscreen,
    mediaType,
  } = usePlayer();

  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable
      )
        return;

      switch (e.key.toLowerCase()) {
        case "f":
          e.preventDefault();
          toggleFullscreen();
          break;

        case "s":
          if (isDesktop && onServerToggle) {
            e.preventDefault();
            onServerToggle();
          }
          break;

        case "arrowleft":
          if (!isServerOpen && mediaType === "tv") {
            e.preventDefault();
            goToPrevEpisode();
          }
          break;

        case "arrowright":
          if (!isServerOpen && mediaType === "tv") {
            e.preventDefault();
            goToNextEpisode();
          }
          break;

        case "n":
          if (mediaType === "tv") {
            e.preventDefault();
            goToNextEpisode();
          }
          break;

        case "p":
          if (mediaType === "tv") {
            e.preventDefault();
            goToPrevEpisode();
          }
          break;

        case "escape":
          if (isServerOpen && onServerToggle) {
            e.preventDefault();
            onServerToggle();
          } else if (isFullscreen) {
            e.preventDefault();
            document.exitFullscreen();
          } else if (onGoBack) {
            e.preventDefault();
            onGoBack();
          }
          break;

        case "?":
          if (isDesktop) {
            e.preventDefault();
            setShowShortcuts((prev) => !prev);
          }
          break;

        case "m":
          if (isDesktop) {
            e.preventDefault();
            // Mute toggle — dispatches a custom event the player can listen for
            window.dispatchEvent(new CustomEvent("player-toggle-mute"));
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    toggleFullscreen,
    goToNextEpisode,
    goToPrevEpisode,
    isFullscreen,
    isDesktop,
    isServerOpen,
    mediaType,
    onServerToggle,
    onGoBack,
  ]);

  return { showShortcuts, setShowShortcuts };
}
