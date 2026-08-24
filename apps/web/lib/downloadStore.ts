"use client";

/**
 * Download Manager client store (Phase 2).
 *
 * Mirrors mobile's DownloadManager singleton: a module-level store that the
 * desktop main process feeds over `download:progress` IPC. The renderer reads
 * it via useSyncExternalStore so every Download Manager surface (the /downloads
 * page, the Sidebar pulse meter) stays in sync without prop-drilling.
 *
 * On the public web (no window.electronAPI) the store is inert — hooks return
 * an empty list and the action helpers are no-ops.
 */

import { useSyncExternalStore } from "react";

export type DownloadStatus =
  | "active"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

export interface DownloadMeta {
  url: string;
  tmdbId?: string;
  title?: string;
  mediaType?: "movie" | "tv";
  season?: number;
  episode?: number;
}

export interface DownloadTask {
  id: string;
  url: string;
  tmdbId?: string;
  title: string;
  mediaType?: "movie" | "tv";
  season?: number;
  episode?: number;
  fileName: string;
  filePath: string;
  totalBytes: number;
  receivedBytes: number;
  speedBytesPerSec: number;
  state: DownloadStatus;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

let tasks: DownloadTask[] = [];
const listeners = new Set<() => void>();
let subscribed = false;

function getApi() {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { electronAPI?: any }).electronAPI?.download;
}

function ensureSubscribed(): void {
  if (subscribed) return;
  const api = getApi();
  if (!api) return; // web / not desktop — stay inert
  subscribed = true;
  api.onProgress((next: DownloadTask[]) => {
    tasks = next;
    listeners.forEach((l) => l());
  });
  api.getAll().then((next: DownloadTask[]) => {
    tasks = next;
    listeners.forEach((l) => l());
  });
}

function subscribe(cb: () => void): () => void {
  ensureSubscribed();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): DownloadTask[] {
  return tasks;
}

/** All tasks, newest-first. */
export function useDownloadList(): DownloadTask[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** A single task by id. */
export function useDownload(id: string): DownloadTask | undefined {
  const all = useDownloadList();
  return all.find((t) => t.id === id);
}

/** Tasks grouped by status for status-group rendering. */
export function groupByStatus(all: DownloadTask[]): {
  active: DownloadTask[];
  paused: DownloadTask[];
  completed: DownloadTask[];
  failed: DownloadTask[];
} {
  const groups = {
    active: [] as DownloadTask[],
    paused: [] as DownloadTask[],
    completed: [] as DownloadTask[],
    failed: [] as DownloadTask[],
  };
  for (const t of all) {
    if (t.state === "active") groups.active.push(t);
    else if (t.state === "paused") groups.paused.push(t);
    else if (t.state === "completed") groups.completed.push(t);
    else groups.failed.push(t); // failed + canceled
  }
  return groups;
}

// ── Action helpers (no-op outside Electron) ──

export function startDownload(meta: DownloadMeta): void {
  getApi()?.start(meta);
}
export function pauseDownload(id: string): void {
  getApi()?.pause(id);
}
export function resumeDownload(id: string): void {
  getApi()?.resume(id);
}
export function cancelDownload(id: string): void {
  getApi()?.cancel(id);
}
export function openDownload(id: string): void {
  getApi()?.open(id);
}
export function clearDownload(id: string, deleteFile = false): void {
  getApi()?.clear(id, deleteFile);
}
export function setDownloadSpeedLimit(
  level: "full" | "balanced" | "slower",
): void {
  getApi()?.setSpeedLimit(level);
}

/** True when running inside the Electron shell (downloads are available). */
export function isDownloadAvailable(): boolean {
  return typeof window !== "undefined" && !!getApi();
}
