/**
 * Hook: useDownloadQueue — Concurrency-limited download queue.
 *
 * Uses a single store.subscribe listener (NOT useSyncExternalStore) to
 * avoid React re-render churn. Starts 'pending' tasks as slots become
 * available (up to maxConcurrent). Tracks started tasks via a ref set
 * to prevent duplicate starts.
 *
 * Previously had two independent schedulers (active.length effect +
 * engine.onStatus listener) that raced each other, causing cascading
 * start → fail → retry loops. Now single-sourced.
 *
 * Usage: mount in root layout so it's alive for the app lifetime.
 */

import { useEffect, useRef } from 'react';
import { useDownloadInfra } from './context';

export interface QueueConfig {
  maxConcurrent?: number; // default 3
}

export function useDownloadQueue(config?: QueueConfig) {
  const maxConcurrent = config?.maxConcurrent ?? 3;
  const { store, engine } = useDownloadInfra();
  const startedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    const unsub = store.subscribe(() => {
      if (cancelled) return;

      const all = store.getAll();

      // Count currently active (in-flight) tasks
      const activeCount = all.filter(
        (t) =>
          (t.status === 'downloading' || t.status === 'pending') &&
          startedRef.current.has(t.id),
      ).length;

      const slots = maxConcurrent - activeCount;
      if (slots <= 0) return;

      // Find pending tasks not yet started
      const candidates = all.filter(
        (t) => t.status === 'pending' && !startedRef.current.has(t.id),
      );

      for (const task of candidates.slice(0, slots)) {
        startedRef.current.add(task.id);
        engine.start(task).catch((err) => {
          console.error(`[Queue] engine.start failed for ${task.id}:`, err);
          startedRef.current.delete(task.id);
        });
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [store, engine, maxConcurrent]);

  // Clean up startedRef entries for completed/failed/cancelled tasks
  // on each status change from the engine
  useEffect(() => {
    const unsub = engine.onStatus((s) => {
      if (
        s.status === 'completed' ||
        s.status === 'failed' ||
        s.status === 'cancelled'
      ) {
        startedRef.current.delete(s.taskId);
        // No need to manually dequeue — the store.subscribe above
        // fires whenever store.upsert() is called (which happens
        // when the status listener updates the store).
      }
    });
    return unsub;
  }, [engine]);

  return {};
}
