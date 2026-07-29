/**
 * Hook: useDownloadList — Subscribe to all downloads, grouped by status.
 *
 * Efficiently re-renders only when the task list actually changes.
 * Uses useSyncExternalStore for tear-free subscriptions.
 */

import { useSyncExternalStore, useMemo } from "react";
import { useDownloadInfra } from "./context";
import type {
  DownloadTask,
  DownloadGrouped,
  ControlAction,
  ControlTarget,
} from "./types";

export function useDownloadList(): DownloadGrouped & {
  loaded: boolean;
  control: (action: ControlAction, target: ControlTarget) => Promise<void>;
} {
  const { store, control, loaded } = useDownloadInfra();

  const tasks = useSyncExternalStore(
    (cb) => store.subscribe(() => cb()),
    () => store.getAll(),
  );

  const grouped = useMemo<DownloadGrouped>(() => {
    return {
      all: tasks,
      active: tasks.filter((t) => t.status === "downloading"),
      paused: tasks.filter((t) => t.status === "paused"),
      completed: tasks.filter((t) => t.status === "completed"),
      failed: tasks.filter((t) => t.status === "failed"),
      cancelled: tasks.filter((t) => t.status === "cancelled"),
      retrying: tasks.filter((t) => t.status === "retrying"),
    };
  }, [tasks]);

  return { ...grouped, loaded, control };
}

/** Helper: format bytes to human-readable string */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Helper: format date relative to now */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Helper: server display name */
export function serverLabel(server: string): string {
  const labels: Record<string, string> = {
    falix: "Falix",
    nxsha: "Nxsha",
    "alt-dl": "Alt DL",
  };
  return labels[server] ?? server;
}
