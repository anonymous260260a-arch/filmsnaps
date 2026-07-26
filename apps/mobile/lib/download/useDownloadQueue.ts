/**
 * Hook: useDownloadQueue — Concurrency-limited download queue monitor.
 *
 * The DownloadManager handles all queue processing internally (via processQueue).
 * This hook exists for backward compatibility — it monitors the queue state
 * and ensures the manager is initialized.
 *
 * Usage: mount in root layout so it's alive for the app lifetime.
 */

import { useEffect, useState } from "react";
import { useDownloadInfra } from "./context";

export interface QueueConfig {
  maxConcurrent?: number; // default 3
}

export interface QueueState {
  activeCount: number;
  queuedCount: number;
}

export function useDownloadQueue(config?: QueueConfig): QueueState {
  const { manager } = useDownloadInfra();
  const [state, setState] = useState<QueueState>({
    activeCount: 0,
    queuedCount: 0,
  });

  useEffect(() => {
    // Subscribe to queue changes
    const unsub = manager.onQueueChange(() => {
      setState({
        activeCount: manager.activeCount,
        queuedCount: manager.queuedCount,
      });
    });

    // Initial state
    setState({
      activeCount: manager.activeCount,
      queuedCount: manager.queuedCount,
    });

    return unsub;
  }, [manager]);

  return state;
}
