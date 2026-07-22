/**
 * Hook: useDownloadList — Subscribe to all downloads, grouped by status.
 *
 * Efficiently re-renders only when the task list actually changes.
 * Uses useSyncExternalStore for tear-free subscriptions.
 */

import { useSyncExternalStore, useMemo } from 'react';
import { useDownloadInfra } from './context';
import type { DownloadTask, DownloadGrouped, ControlAction, ControlTarget } from './types';

export function useDownloadList(): DownloadGrouped & { loaded: boolean; control(action: ControlAction, target?: ControlTarget): Promise<void> } {
  const { store, control } = useDownloadInfra();

  const tasks = useSyncExternalStore(
    (cb) => store.subscribe(() => cb()),
    () => store.getAll(),
  );

  const loaded = useSyncExternalStore(
    (cb) => store.subscribeLoaded(() => cb()),
    () => store.isLoaded(),
  );

  return useMemo(() => {
    const grouped: DownloadGrouped = {
      all: tasks,
      active: tasks.filter(
        (t) => t.status === 'pending' || t.status === 'downloading',
      ),
      paused: tasks.filter((t) => t.status === 'paused'),
      completed: tasks.filter((t) => t.status === 'completed'),
      failed: tasks.filter((t) => t.status === 'failed'),
      cancelled: tasks.filter((t) => t.status === 'cancelled'),
    };

    return {
      ...grouped,
      loaded,
      control,
    };
  }, [tasks, loaded, control]);
}

/** Helper: format bytes to human-readable string */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const val = bytes / Math.pow(k, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${sizes[i]}`;
}

/** Helper: format date relative to now */
export function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays < 1) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Helper: server display name */
export function serverLabel(server: string): string {
  switch (server) {
    case 'falix': return 'Falix';
    case 'nxsha': return 'Server 1';
    case 'alt-dl': return 'Alt DL';
    default: return server;
  }
}
