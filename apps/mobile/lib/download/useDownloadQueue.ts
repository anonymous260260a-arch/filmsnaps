/**
 * Hook: useDownloadQueue — Concurrency-limited download queue monitor.
 *
 * The DownloadManager handles all queue processing internally (via processQueue).
 * This hook monitors the queue state and provides batch operations.
 */

import { useSyncExternalStore, useCallback, useRef } from "react";
import { useDownloadInfra } from "./context";

export interface QueueConfig {
  maxConcurrent?: number;
}

export interface QueueState {
  queueLength: number;
  activeCount: number;
  isProcessing: boolean;
}

export function useDownloadQueue(): QueueState & {
  pauseAll: () => Promise<void>;
  resumeAll: () => Promise<void>;
  cancelAll: () => Promise<void>;
} {
  const { manager } = useDownloadInfra();

  // Cache snapshot to avoid infinite loop from new object each call
  const lastRef = useRef<QueueState>({
    queueLength: 0,
    activeCount: 0,
    isProcessing: false,
  });

  const getSnapshot = useCallback((): QueueState => {
    const next: QueueState = {
      queueLength: manager.getQueueLength(),
      activeCount: manager.getActiveCount(),
      isProcessing: manager.getActiveCount() > 0,
    };
    const last = lastRef.current;
    if (
      next.queueLength === last.queueLength &&
      next.activeCount === last.activeCount &&
      next.isProcessing === last.isProcessing
    ) {
      return last;
    }
    lastRef.current = next;
    return next;
  }, [manager]);

  const state = useSyncExternalStore(
    (cb) => manager.onQueueChange(() => cb()),
    getSnapshot,
  );

  const pauseAll = useCallback(() => manager.pauseAll(), [manager]);
  const resumeAll = useCallback(() => manager.resumeAll(), [manager]);
  const cancelAll = useCallback(() => manager.cancelAll(), [manager]);

  return { ...state, pauseAll, resumeAll, cancelAll };
}
