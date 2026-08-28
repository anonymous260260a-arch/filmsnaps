/**
 * useAppMode — global content mode for the web (and desktop, via the renderer).
 *
 * Mirrors mobile's `settings.mode` (apps/mobile/lib/settings.tsx): a single
 * persisted "Hard Mode Split" between Movies/TV and Anime that re-sources the
 * home feed, defaults search, and scopes history. Web is SSR, so the store
 * returns the default on the server and on first client paint, then hydrates
 * from localStorage — matching mobile's opt-in default of "movie_tv".
 *
 * Single source of truth: both web Header and desktop GlobalTopBar read/write
 * this so the toggle is consistent across surfaces.
 */

"use client";

import { useSyncExternalStore } from "react";

export type AppMode = "movie_tv" | "anime";

const MODE_KEY = "fs:mode";
const DEFAULT_MODE: AppMode = "movie_tv";

/* ── Store plumbing (mirrors components/desktop/chrome-store.ts) ── */

let state: AppMode = DEFAULT_MODE;
const listeners: Array<() => void> = [];

function load(): AppMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "anime" ? "anime" : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

// Hydrate on first client access (module load happens client-side only for hooks).
if (typeof window !== "undefined") {
  state = load();
}

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

function getSnapshot(): AppMode {
  return state;
}

function setMode(mode: AppMode): void {
  state = mode;
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* storage unavailable — in-memory only */
  }
  emit();
}

/* ── Public API ── */

export function setAppMode(mode: AppMode): void {
  setMode(mode);
}

export function useAppMode(): { mode: AppMode; setMode: (m: AppMode) => void } {
  const mode = useSyncExternalStore(
    subscribe,
    getSnapshot,
    // Server snapshot: always the default to avoid hydration mismatch.
    () => DEFAULT_MODE,
  );
  return { mode, setMode };
}
