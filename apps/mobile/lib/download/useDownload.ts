/**
 * Hook: useDownload — Reactive single-task hook with lifecycle controls.
 *
 * Subscribes to exactly one task via per-task store subscription.
 * Other task updates do NOT trigger re-renders. Returns its full state
 * plus pause/resume/cancel/retry/remove methods.
 */

import { useCallback } from 'react';
import { useSyncExternalStore } from 'react';
import { useDownloadInfra } from './context';
import type { DownloadTask } from './types';

export interface UseDownloadReturn {
  task: DownloadTask | undefined;
  /** Progress fraction 0-1, or 0 if total size unknown */
  progress: number;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: () => Promise<void>;
  retry: () => Promise<void>;
  remove: () => Promise<void>;
}

export function useDownload(taskId: string | undefined): UseDownloadReturn {
  const { store, engine } = useDownloadInfra();

  const task = useSyncExternalStore(
    (cb) => taskId ? store.subscribeTask(taskId, () => cb()) : () => {},
    () => (taskId ? store.getById(taskId) : undefined),
  );

  const progress = task && task.totalBytes > 0
    ? task.receivedBytes / task.totalBytes
    : 0;

  const pause = useCallback(async () => {
    if (!taskId) return;
    const current = store.getById(taskId);
    if (!current || current.status !== 'downloading') return;
    const resumeData = await engine.pause(taskId);
    if (resumeData) {
      store.upsert({ ...current, status: 'paused', resumeData });
    }
  }, [taskId, engine, store]);

  const resume = useCallback(async () => {
    if (!taskId) return;
    const current = store.getById(taskId);
    if (!current) return;

    if (current.status === 'paused') {
      // True resume — engine will pass saved resumeData
      engine.start(current).catch(console.error);
    } else if (current.status === 'failed' || current.status === 'cancelled') {
      // Retry: delete old file, reset progress, start fresh
      await engine.remove(taskId, current.fileUri);
      const reset: DownloadTask = {
        ...current,
        status: 'pending',
        receivedBytes: 0,
        totalBytes: 0,
        error: undefined,
        fileUri: null,
        resumeData: null,
      };
      store.upsert(reset);
      engine.start(reset).catch(console.error);
    }
  }, [taskId, engine, store]);

  const cancel = useCallback(async () => {
    if (!taskId) return;
    const current = store.getById(taskId);
    if (!current) return;
    store.upsert({ ...current, status: 'cancelled' });
    await engine.cancel(taskId);
  }, [taskId, engine, store]);

  const retry = useCallback(async () => {
    if (!taskId) return;
    const current = store.getById(taskId);
    if (!current) return;
    await engine.remove(taskId, current.fileUri);
    const reset: DownloadTask = {
      ...current,
      status: 'pending',
      receivedBytes: 0,
      totalBytes: 0,
      error: undefined,
      fileUri: null,
      resumeData: null,
    };
    store.upsert(reset);
    engine.start(reset).catch(console.error);
  }, [taskId, engine, store]);

  const remove = useCallback(async () => {
    if (!taskId) return;
    const current = store.getById(taskId);
    if (!current) return;
    await engine.remove(taskId, current.fileUri);
    await store.remove(taskId);
  }, [taskId, engine, store]);

  return { task, progress, pause, resume, cancel, retry, remove };
}
