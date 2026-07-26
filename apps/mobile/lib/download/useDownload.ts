/**
 * Hook: useDownload — Reactive single-task hook with lifecycle controls.
 *
 * Subscribes to exactly one task via per-task store subscription.
 * All lifecycle operations (pause/resume/cancel/retry/remove) are
 * delegated to the DownloadManager (the sole orchestrator).
 *
 * FIX: Debounce guard prevents rapid re-triggers from React re-renders
 * or queued touch events on Android.
 */

import { useCallback, useRef, useReducer } from "react";
import { useSyncExternalStore } from "react";
import { useDownloadInfra } from "./context";
import type { DownloadTask } from "./types";

export interface UseDownloadReturn {
  task: DownloadTask | undefined;
  /** Progress fraction 0-1, or 0 if total size unknown */
  progress: number;
  /** Whether an action (pause/resume/cancel/etc.) is currently in flight */
  isActionPending: boolean;
  /** Queue position (1-indexed) if task is pending, null otherwise */
  queuePosition: { position: number; total: number } | null;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: () => Promise<void>;
  retry: () => Promise<void>;
  remove: () => Promise<void>;
}

export function useDownload(taskId: string | undefined): UseDownloadReturn {
  const { store, manager } = useDownloadInfra();

  // ═══════════════════════════════════════════════════════════════
  // FIX: Track action state for UI feedback (spinner on button).
  // Released immediately when the action completes — no fixed timeout.
  // The manager's per-task mutex is the real concurrency guard.
  // ═══════════════════════════════════════════════════════════════
  const actionPendingRef = useRef(false);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!taskId) return () => {};
      return store.subscribeTask(taskId, () => onStoreChange());
    },
    [taskId, store],
  );

  const getSnapshot = useCallback(() => {
    if (!taskId) return undefined;
    return store.getById(taskId);
  }, [taskId, store]);

  const task = useSyncExternalStore(subscribe, getSnapshot);

  const receivedBytes = Number(task?.receivedBytes) || 0;
  const totalBytes = Number(task?.totalBytes) || 0;
  const progress = totalBytes > 0 ? receivedBytes / totalBytes : 0;

  const queuePosition =
    task && (task.status === "pending" || task.status === "retrying")
      ? manager.getQueuePosition(taskId!)
      : null;

  const pause = useCallback(async () => {
    if (!taskId) return;
    if (actionPendingRef.current) return;
    actionPendingRef.current = true;
    forceUpdate();
    try {
      await manager.pause(taskId);
    } finally {
      actionPendingRef.current = false;
      forceUpdate();
    }
  }, [taskId, manager]);

  const resume = useCallback(async () => {
    if (!taskId) return;
    if (actionPendingRef.current) return;
    actionPendingRef.current = true;
    forceUpdate();
    try {
      const current = store.getById(taskId);
      if (!current) return;
      if (current.status === "paused") {
        await manager.resume(taskId);
      } else if (
        current.status === "failed" ||
        current.status === "cancelled"
      ) {
        await manager.retry(taskId);
      }
    } finally {
      actionPendingRef.current = false;
      forceUpdate();
    }
  }, [taskId, manager, store]);

  const cancel = useCallback(async () => {
    if (!taskId) return;
    if (actionPendingRef.current) return;
    actionPendingRef.current = true;
    forceUpdate();
    try {
      await manager.cancel(taskId);
    } finally {
      actionPendingRef.current = false;
      forceUpdate();
    }
  }, [taskId, manager]);

  const retry = useCallback(async () => {
    if (!taskId) return;
    if (actionPendingRef.current) return;
    actionPendingRef.current = true;
    forceUpdate();
    try {
      await manager.retry(taskId);
    } finally {
      actionPendingRef.current = false;
      forceUpdate();
    }
  }, [taskId, manager]);

  const remove = useCallback(async () => {
    if (!taskId) return;
    if (actionPendingRef.current) return;
    actionPendingRef.current = true;
    forceUpdate();
    try {
      await manager.remove(taskId);
      await store.remove(taskId);
    } finally {
      actionPendingRef.current = false;
      forceUpdate();
    }
  }, [taskId, manager, store]);

  return {
    task,
    progress,
    isActionPending: actionPendingRef.current,
    queuePosition,
    pause,
    resume,
    cancel,
    retry,
    remove,
  };
}
