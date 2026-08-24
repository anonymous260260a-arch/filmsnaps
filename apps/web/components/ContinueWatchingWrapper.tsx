/**
 * ContinueWatchingWrapper — client component that reads watch history
 * and renders the ContinueWatching rail.
 */

"use client";

import React, { useEffect, useState } from "react";
import { createLocalStorageAdapter } from "@filmsnaps/shared";
import { useWatchHistory } from "@filmsnaps/shared";
import { ContinueWatching } from "@/components/ContinueWatching";
import type { WatchProgress } from "@filmsnaps/shared";

const storage = createLocalStorageAdapter();

export function ContinueWatchingWrapper() {
  const { entries, loading, refresh } = useWatchHistory(storage);
  const [inProgress, setInProgress] = useState<WatchProgress[]>([]);

  // Recompute the visible rail whenever the underlying history changes.
  useEffect(() => {
    // Only show items that aren't fully watched and have meaningful progress,
    // most-recently-watched first.
    const filtered = entries
      .filter((e) => !e.completed && e.currentTime > 10)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    setInProgress(filtered);
  }, [entries]);

  // Refocus refresh: when the user returns to the tab, re-read history so
  // recently-saved progress (e.g. from a concurrent window) is reflected.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  if (loading || inProgress.length === 0) return null;

  return <ContinueWatching entries={inProgress} />;
}
