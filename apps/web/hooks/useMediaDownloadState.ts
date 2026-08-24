/**
 * Hook: useMediaDownloadState — TV/movie download status from detail pages.
 *
 * Aggregates download state for a specific movie/TV title.
 * Used by detail pages to show download status without navigating away.
 */

import { useMemo } from "react";
import { useDownloadList } from "@/lib/downloadStore";
import type { DownloadTask, DownloadStatus } from "@/lib/downloadStore";

/** Aggregated per-title state (coarser than the per-task DownloadStatus). */
export type MediaDownloadState =
  | "none"
  | "downloading"
  | "completed"
  | "partial"
  | "failed";

export interface MediaDownloadSummary {
  state: MediaDownloadState;
  totalTasks: number;
  completedTasks: number;
  activeTasks: number;
  failedTasks: number;
  totalBytes: number;
  receivedBytes: number;
}

const ACTIVE_STATES: ReadonlySet<DownloadStatus> = new Set<DownloadStatus>([
  "active",
  "paused",
]);

export function useMediaDownloadState(
  mediaType: "movie" | "tv",
  tmdbId: string,
): MediaDownloadSummary {
  // Read from store reactively
  const tasks = useDownloadList();

  return useMemo(() => {
    const relevant: DownloadTask[] = tasks.filter(
      (t) => t.tmdbId === tmdbId && t.mediaType === mediaType,
    );

    if (relevant.length === 0) {
      return {
        state: "none",
        totalTasks: 0,
        completedTasks: 0,
        activeTasks: 0,
        failedTasks: 0,
        totalBytes: 0,
        receivedBytes: 0,
      };
    }

    const completed = relevant.filter((t) => t.state === "completed");
    const active = relevant.filter((t) => ACTIVE_STATES.has(t.state));
    const failed = relevant.filter((t) => t.state === "failed");

    let state: MediaDownloadState;
    if (completed.length === relevant.length) {
      state = "completed";
    } else if (active.length > 0) {
      state = "downloading";
    } else if (failed.length > 0 && completed.length === 0) {
      state = "failed";
    } else if (completed.length > 0) {
      state = "partial";
    } else {
      state = "none";
    }

    const totalBytes = relevant.reduce((s, t) => s + t.totalBytes, 0);
    const receivedBytes = relevant.reduce((s, t) => s + t.receivedBytes, 0);

    return {
      state,
      totalTasks: relevant.length,
      completedTasks: completed.length,
      activeTasks: active.length,
      failedTasks: failed.length,
      totalBytes,
      receivedBytes,
    };
  }, [tasks, tmdbId, mediaType]);
}
