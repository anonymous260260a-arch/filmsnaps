/**
 * Download Store — Observable task metadata with swappable persistence.
 *
 * Holds the complete list of DownloadTasks in memory and provides
 * subscription-based reactivity. Uses a StorageAdapter for persistence
 * (AsyncStorage in production, memory adapter for tests).
 *
 * The store holds metadata only — actual byte I/O is managed by the engine.
 * Writes are debounced (500ms) to avoid thrashing AsyncStorage on rapid
 * progress updates.
 */

import type {
  DownloadTask,
  DownloadStatus,
  Unsubscribe,
  StorageAdapter,
} from './types';

// ── Interface ──

export interface IDownloadStore {
  getAll(): DownloadTask[];
  getById(id: string): DownloadTask | undefined;
  getByMedia(tmdbId: string, server?: string): DownloadTask[];
  getBySeason(tmdbId: string, season: number): DownloadTask[];

  /** Add or update a single task */
  upsert(task: DownloadTask): Promise<void>;

  /** Bulk replace (used on app launch restore) */
  replaceAll(tasks: DownloadTask[]): Promise<void>;

  /** Remove from store */
  remove(id: string): Promise<void>;

  /** Remove all completed downloads */
  clearCompleted(): Promise<void>;

  /** Subscribe to ALL task changes. Immediately fires with current state. */
  subscribe(cb: (tasks: DownloadTask[]) => void): Unsubscribe;

  /** Subscribe to changes for ONE task by id. Immediately fires with current task (or undefined). */
  subscribeTask(taskId: string, cb: (task: DownloadTask | undefined) => void): Unsubscribe;

  /** Subscribe to loaded-state changes only. */
  subscribeLoaded(cb: (loaded: boolean) => void): Unsubscribe;

  /** Hydrate from durable storage */
  load(): Promise<DownloadTask[]>;
  isLoaded(): boolean;
}

// ── Constants ──

const STORAGE_KEY = '@filmsnaps/downloads/v2';

// ── Create Store ──

export function createDownloadStore(adapter: StorageAdapter): IDownloadStore {
  let tasks: DownloadTask[] = [];
  let loaded = false;
  const allListeners = new Set<(tasks: DownloadTask[]) => void>();
  const taskListeners = new Map<string, Set<(task: DownloadTask | undefined) => void>>();
  const loadedListeners = new Set<(loaded: boolean) => void>();
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  function notifyAll() {
    const snapshot = tasks;
    for (const cb of allListeners) {
      try { cb(snapshot); } catch {}
    }
  }

  function notifyTask(id: string) {
    const set = taskListeners.get(id);
    if (!set) return;
    const task = tasks.find((t) => t.id === id);
    for (const cb of set) {
      try { cb(task); } catch {}
    }
  }

  function notifyLoaded() {
    for (const cb of loadedListeners) {
      try { cb(loaded); } catch {}
    }
  }

  function debouncedPersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const toPersist = tasks.map((t) => ({
        ...t,
        // Strip resumeData on completed/cancelled tasks to save space
        resumeData: (t.status === 'completed' || t.status === 'cancelled') ? null : t.resumeData,
      }));
      adapter.setItem(STORAGE_KEY, JSON.stringify(toPersist)).catch(() => {});
    }, 500);
  }

  function update(updated: DownloadTask[], changedIds: string[]) {
    tasks = updated;
    notifyAll();
    for (const id of changedIds) {
      notifyTask(id);
    }
    debouncedPersist();
  }

  return {
    getAll() {
      return tasks;
    },

    getById(id: string) {
      return tasks.find((t) => t.id === id);
    },

    getByMedia(tmdbId: string, server?: string) {
      return tasks.filter((t) => {
        if (t.tmdbId !== tmdbId) return false;
        if (server && t.server !== server) return false;
        return true;
      });
    },

    getBySeason(tmdbId: string, season: number) {
      return tasks.filter(
        (t) => t.tmdbId === tmdbId && t.season === season,
      );
    },

    async upsert(task: DownloadTask) {
      const idx = tasks.findIndex((t) => t.id === task.id);
      const updated = {
        ...task,
        updatedAt: Date.now(),
      };

      if (idx >= 0) {
        const copy = [...tasks];
        copy[idx] = updated;
        update(copy, [task.id]);
      } else {
        update([updated, ...tasks], [task.id]);
      }
    },

    async replaceAll(newTasks: DownloadTask[]) {
      const allIds = [...new Set([...tasks.map((t) => t.id), ...newTasks.map((t) => t.id)])];
      tasks = newTasks;
      loaded = true;
      notifyAll();
      for (const id of allIds) notifyTask(id);
      notifyLoaded();
      debouncedPersist();
    },

    async remove(id: string) {
      const removed = tasks.find((t) => t.id === id);
      if (!removed) return;
      update(
        tasks.filter((t) => t.id !== id),
        [id],
      );
    },

    async clearCompleted() {
      const removedIds = tasks
        .filter((t) => t.status === 'completed' || t.status === 'cancelled')
        .map((t) => t.id);
      if (removedIds.length === 0) return;
      update(
        tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled'),
        removedIds,
      );
    },

    subscribe(cb: (tasks: DownloadTask[]) => void): Unsubscribe {
      allListeners.add(cb);
      try { cb(tasks); } catch {}
      return () => { allListeners.delete(cb); };
    },

    subscribeTask(taskId: string, cb: (task: DownloadTask | undefined) => void): Unsubscribe {
      let set = taskListeners.get(taskId);
      if (!set) {
        set = new Set();
        taskListeners.set(taskId, set);
      }
      set.add(cb);
      try { cb(tasks.find((t) => t.id === taskId)); } catch {}
      return () => {
        set!.delete(cb);
        if (set!.size === 0) taskListeners.delete(taskId);
      };
    },

    subscribeLoaded(cb: (loaded: boolean) => void): Unsubscribe {
      loadedListeners.add(cb);
      try { cb(loaded); } catch {}
      return () => { loadedListeners.delete(cb); };
    },

    async load(): Promise<DownloadTask[]> {
      try {
        const raw = await adapter.getItem(STORAGE_KEY);
        if (raw) {
          const parsed: DownloadTask[] = JSON.parse(raw);
          // Stale active tasks → mark as paused (bytes preserved, URL might be stale)
          tasks = parsed.map((t) =>
            t.status === 'downloading' || t.status === 'pending'
              ? { ...t, status: 'paused' as DownloadStatus, error: 'App was closed. Tap resume to continue.' }
              : t,
          );
        }
      } catch (e) {
        console.warn('[DownloadStore] Failed to load:', e);
      }
      loaded = true;
      notifyAll();
      notifyLoaded();
      return tasks;
    },

    isLoaded() {
      return loaded;
    },
  };
}

// ── AsyncStorage Adapter ──

import AsyncStorage from '@react-native-async-storage/async-storage';

export function createAsyncStorageAdapter(): StorageAdapter {
  return {
    async getItem(key: string): Promise<string | null> {
      return AsyncStorage.getItem(key);
    },
    async setItem(key: string, value: string): Promise<void> {
      await AsyncStorage.setItem(key, value);
    },
    async removeItem(key: string): Promise<void> {
      await AsyncStorage.removeItem(key);
    },
  };
}

/** Memory adapter for testing */
export function createMemoryAdapter(): StorageAdapter {
  const store = new Map<string, string>();
  return {
    async getItem(key: string) { return store.get(key) ?? null; },
    async setItem(key: string, value: string) { store.set(key, value); },
    async removeItem(key: string) { store.delete(key); },
  };
}
