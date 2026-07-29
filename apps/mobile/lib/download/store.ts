import type { DownloadTask, Unsubscribe } from "./types";
import { DownloadDatabase } from "./database";
import { logger } from "./logger";

type Listener = () => void;
type TaskListener = () => void;

/**
 * Fixes JS-thread starvation:
 *  - Internal storage is a Map<id, task> — O(1) writes, no "copy the whole array" allocation
 *    on every progress event (was O(n) every ~400ms).
 *  - Progress-only updates go through `scheduleProgressFlush`, which batches all pending
 *    progress writes into a single requestAnimationFrame callback. Multiple progress events
 *    for the same or different tasks arriving within one frame collapse into ONE notify().
 *    Status changes (paused/completed/failed/etc.) bypass batching and flush immediately —
 *    those are rare and latency there matters more than throughput.
 *  - `getAll()` materializes an array from the Map lazily, cached until the next write,
 *    so repeated reads within a frame (e.g. multiple useDownloadList consumers) don't
 *    re-copy.
 */
export function createDownloadStore() {
  const tasks = new Map<string, DownloadTask>();
  const listeners = new Set<Listener>();
  const taskListeners = new Map<string, Set<TaskListener>>();
  const loadedListeners = new Set<Listener>();

  let loaded = false;
  let cachedSnapshot: DownloadTask[] | null = null;

  let pendingProgressIds: Set<string> | null = null;
  let rafHandle: number | null = null;

  function invalidateSnapshot() {
    cachedSnapshot = null;
  }

  function notifyAll() {
    invalidateSnapshot();
    listeners.forEach((l) => l());
  }

  function notifyTask(id: string) {
    taskListeners.get(id)?.forEach((l) => l());
  }

  function flushProgress() {
    rafHandle = null;
    const ids = pendingProgressIds;
    pendingProgressIds = null;
    if (!ids || ids.size === 0) return;
    invalidateSnapshot();
    // One notifyAll() covers every task that changed this frame, instead of one per event.
    listeners.forEach((l) => l());
    ids.forEach((id) => notifyTask(id));
  }

  function scheduleProgressFlush(id: string) {
    if (!pendingProgressIds) pendingProgressIds = new Set();
    pendingProgressIds.add(id);
    if (rafHandle == null) {
      rafHandle = requestAnimationFrame(flushProgress);
    }
  }

  return {
    /** Full status/metadata change — flush immediately, no batching. Rare enough that
     *  batching would only add latency without meaningfully reducing render count. */
    upsert(task: DownloadTask): void {
      tasks.set(task.id, task);
      invalidateSnapshot();
      notifyAll();
      notifyTask(task.id);
      // fire-and-forget persistence, unchanged from before
      DownloadDatabase.update(task).catch((e) =>
        logger.warn("store.upsert db write failed", e),
      );
    },

    /** High-frequency path used by manager.ts's onProgress callback. Mutates the map
     *  entry in place (same object identity is NOT required since consumers read via
     *  getAll()/getById() snapshots, not object references) and defers the render-
     *  triggering notify to the next animation frame. */
    upsertProgress(
      id: string,
      receivedBytes: number,
      totalBytes: number,
      speed?: number,
      eta?: number,
    ): void {
      const existing = tasks.get(id);
      if (!existing) return; // task not known yet — a full upsert() should arrive first
      tasks.set(id, {
        ...existing,
        receivedBytes,
        totalBytes,
        speed,
        eta,
        updatedAt: Date.now(),
      });
      scheduleProgressFlush(id);
      // Deliberately NOT written to SQLite here — manager.ts already handles periodic
      // (every 3s) DB persistence of progress separately, on its own timer.
    },

    getById(id: string): DownloadTask | undefined {
      return tasks.get(id);
    },

    getAll(): DownloadTask[] {
      if (!cachedSnapshot) cachedSnapshot = Array.from(tasks.values());
      return cachedSnapshot;
    },

    remove(id: string): void {
      tasks.delete(id);
      invalidateSnapshot();
      notifyAll();
      notifyTask(id);
      taskListeners.delete(id);
    },

    subscribe(listener: Listener): Unsubscribe {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    subscribeTask(id: string, listener: TaskListener): Unsubscribe {
      if (!taskListeners.has(id)) taskListeners.set(id, new Set());
      taskListeners.get(id)!.add(listener);
      return () => taskListeners.get(id)?.delete(listener);
    },

    subscribeLoaded(listener: Listener): Unsubscribe {
      loadedListeners.add(listener);
      return () => loadedListeners.delete(listener);
    },

    isLoaded(): boolean {
      return loaded;
    },

    async load(): Promise<void> {
      const rows = await DownloadDatabase.getAll();
      rows.forEach((t) => tasks.set(t.id, t));
      loaded = true;
      invalidateSnapshot();
      notifyAll();
      loadedListeners.forEach((l) => l());
    },

    /** Used by manager.initialize()'s recovery pass — see manager patch. Same immediate-
     *  flush semantics as upsert(); recovery happens once at startup, not on the hot path. */
    upsertMany(updated: DownloadTask[]): void {
      updated.forEach((t) => tasks.set(t.id, t));
      invalidateSnapshot();
      notifyAll();
      updated.forEach((t) => notifyTask(t.id));
    },

    // Test/dev only — cancel any pending rAF so tests don't leak timers across cases.
    __flushSync(): void {
      if (rafHandle != null) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
      flushProgress();
    },
  };
}

export type DownloadStore = ReturnType<typeof createDownloadStore>;
