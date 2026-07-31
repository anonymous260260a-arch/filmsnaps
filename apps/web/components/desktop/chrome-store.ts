/**
 * chrome-store — tiny shared store for the desktop app chrome.
 *
 * A dependency-free module using useSyncExternalStore so the global
 * top bar, sidebar, and watch page can share a small amount of UI state
 * without prop drilling or adding a state library:
 *
 *   watchContext  — what the watch page wants the global bar to show
 *                   (title + gold S:E). null on every other page.
 *   immersive     — true when the watch page is fullscreen: hides the
 *                   bar + sidebar so the video owns the whole window.
 *   sidebarCollapsed — persisted to localStorage (spatial-memory: keep
 *                   the user's last-used layout across sessions).
 */

"use client";

import { useSyncExternalStore } from "react";

// ── Types ──────────────────────────────────────────────────────────

export interface WatchContext {
  /** Content title (movie or show name) */
  title: string;
  /** Release year (movies) */
  year?: string;
  /** Current season (TV only) */
  season?: number;
  /** Current episode (TV only) */
  episode?: number;
}

interface ChromeState {
  watchContext: WatchContext | null;
  immersive: boolean;
  sidebarCollapsed: boolean;
}

// ── Store plumbing ─────────────────────────────────────────────────

const SIDEBAR_KEY = "filmsnaps:sidebar-collapsed";

function loadSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

let state: ChromeState = {
  watchContext: null,
  immersive: false,
  sidebarCollapsed: loadSidebarCollapsed(),
};

const listeners: Array<() => void> = [];

function emit() {
  for (const l of listeners) l();
}

function setState(patch: Partial<ChromeState>) {
  state = { ...state, ...patch };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

function getSnapshot(): ChromeState {
  return state;
}

// ── Public API ─────────────────────────────────────────────────────

/** Set the watch-page context for the global bar (null to clear). */
export function setWatchContext(ctx: WatchContext | null): void {
  setState({ watchContext: ctx });
}

/** Toggle immersive mode (fullscreen watch) — hides bar + sidebar. */
export function setImmersive(immersive: boolean): void {
  setState({ immersive });
}

/** Toggle the sidebar collapsed state, persisted across sessions. */
export function toggleSidebarCollapsed(): void {
  const next = !state.sidebarCollapsed;
  try {
    localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
  } catch {
    // ignore storage failures
  }
  setState({ sidebarCollapsed: next });
}

/** React hook — subscribes to the whole chrome store. */
export function useChromeStore(): ChromeState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
