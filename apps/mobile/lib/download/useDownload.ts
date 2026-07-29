/**
 * Hook: useDownload — Reactive single-task hook with lifecycle controls.
 *
 * Subscribes to exactly one task via per-task store subscription.
 * All lifecycle operations (pause/resume/cancel/retry/remove) are
 * delegated to the DownloadManager (the sole orchestrator).
 */

import { useCallback, useRef } from "react";
import { useSyncExternalStore } from "react";
import { useDownloadInfra } from "./context";
import type { DownloadTask, DownloadStatus } from "./types";
import { logger } from "./logger";

export interface UseDownloadReturn {
  task: DownloadTask | undefined;
  status: DownloadStatus | undefined;
  progress: number; // 0-1 fraction
  receivedBytes: number;
  totalBytes: number;
  speed: number;
  eta: number;
  error: string | undefined;
  isActive: boolean;
  isCompleted: boolean;
  isPaused: boolean;
  isFailed: boolean;
  // Actions
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: () => Promise<void>;
  retry: () => Promise<void>;
  remove: () => Promise<void>;
  // Guard
  actionPending: boolean;
}

export function useDownload(
  taskId: string | null | undefined,
): UseDownloadReturn {
  const { store, manager } = useDownloadInfra();
  const actionPendingRef = useRef(false);

  const task = useSyncExternalStore(
    (cb) => {
      if (!taskId) return () => {};
      return store.subscribeTask(taskId, () => cb());
    },
    () => (taskId ? store.getById(taskId) : undefined),
  );

  // ─── Derived state ───
  const status = task?.status;
  const totalBytes = task?.totalBytes ?? 0;
  const receivedBytes = task?.receivedBytes ?? 0;
  const progress = totalBytes > 0 ? Math.min(receivedBytes / totalBytes, 1) : 0;
  const speed = task?.speed ?? 0;
  const eta = task?.eta ?? 0;
  const error = task?.error;
  const isActive = status === "downloading" || status === "retrying";
  const isCompleted = status === "completed";
  const isPaused = status === "paused";
  const isFailed = status === "failed";

  // ─── Actions with debounce guard ───
  const guard = useCallback(
    async (fn: () => Promise<void>) => {
      if (!taskId || actionPendingRef.current) return;
      actionPendingRef.current = true;
      try {
        await fn();
      } catch (err) {
        logger.error("useDownload: Action failed for", taskId, err);
      } finally {
        setTimeout(() => {
          actionPendingRef.current = false;
        }, 300);
      }
    },
    [taskId],
  );

  const pause = useCallback(
    () => guard(() => manager.pause(taskId!)),
    [guard, manager, taskId],
  );
  const resume = useCallback(
    () => guard(() => manager.resume(taskId!)),
    [guard, manager, taskId],
  );
  const cancel = useCallback(
    () => guard(() => manager.cancel(taskId!)),
    [guard, manager, taskId],
  );
  const retry = useCallback(
    () => guard(() => manager.retry(taskId!)),
    [guard, manager, taskId],
  );
  const remove = useCallback(
    () => guard(() => manager.remove(taskId!)),
    [guard, manager, taskId],
  );

  return {
    task,
    status,
    progress,
    receivedBytes,
    totalBytes,
    speed,
    eta,
    error,
    isActive,
    isCompleted,
    isPaused,
    isFailed,
    pause,
    resume,
    cancel,
    retry,
    remove,
    actionPending: actionPendingRef.current,
  };
}
