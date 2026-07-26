/**
 * Download Store — Observable task metadata with SQLite persistence.
 *
 * Holds the complete list of DownloadTasks in memory and provides
 * subscription-based reactivity. Persists to SQLite via the DownloadDatabase
 * module (lazy-loaded to avoid native module crash at bundle time).
 *
 * The store holds metadata only — actual byte I/O is managed by the manager.
 * In-memory updates happen synchronously FIRST, then DB persistence is
 * fire-and-forget (never blocks the UI thread).
 */

import type {
  DownloadTask,
  DownloadStatus,
  Unsubscribe,
  StorageAdapter,
} from "./types";

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
  subscribeTask(
    taskId: string,
    cb: (task: DownloadTask | undefined) => void,
  ): Unsubscribe;

  /** Subscribe to loaded-state changes only. */
  subscribeLoaded(cb: (loaded: boolean) => void): Unsubscribe;

  /** Hydrate from SQLite */
  load(): Promise<DownloadTask[]>;
  isLoaded(): boolean;
}

// ── Lazy SQLite helper ──

let _sqliteDb: any = null;
async function getSQLite(): Promise<
  typeof import("./database").DownloadDatabase | null
> {
  if (_sqliteDb) return _sqliteDb;
  try {
    const { DownloadDatabase } = require("./database");
    _sqliteDb = DownloadDatabase;
    return _sqliteDb;
  } catch {
    return null;
  }
}

// ── Create Store ──

/**
 * Create a download store backed by SQLite (via DownloadDatabase).
 *
 * An optional StorageAdapter can be passed for testing/memory fallback —
 * if omitted, SQLite is the sole persistence layer.
 */
export function createDownloadStore(adapter?: StorageAdapter): IDownloadStore {
  let tasks: DownloadTask[] = [];
  let loaded = false;
  const allListeners = new Set<(tasks: DownloadTask[]) => void>();
  const taskListeners = new Map<
    string,
    Set<(task: DownloadTask | undefined) => void>
  >();
  const loadedListeners = new Set<(loaded: boolean) => void>();

  function notifyAll() {
    const snapshot = tasks;
    for (const cb of allListeners) {
      try {
        cb(snapshot);
      } catch {}
    }
  }

  function notifyTask(id: string) {
    const set = taskListeners.get(id);
    if (!set) return;
    const task = tasks.find((t) => t.id === id);
    for (const cb of set) {
      try {
        cb(task);
      } catch {}
    }
  }

  function notifyLoaded() {
    for (const cb of loadedListeners) {
      try {
        cb(loaded);
      } catch {}
    }
  }

  function update(updated: DownloadTask[], changedIds: string[]) {
    tasks = updated;
    notifyAll();
    for (const id of changedIds) {
      notifyTask(id);
    }
    // No longer calls markUpdated() — persistence is handled per-upsert.
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
      return tasks.filter((t) => t.tmdbId === tmdbId && t.season === season);
    },

    /**
     * FIX: Update in-memory state SYNCHRONOUSLY FIRST, then persist async.
     * This ensures React is notified immediately regardless of DB latency.
     * For existing tasks, uses partial db.update() instead of full INSERT OR REPLACE.
     */
    async upsert(task: DownloadTask) {
      // FIX: Sanitize resumeData to prevent type corruption in SQLite
      const sanitizedTask: DownloadTask = {
        ...task,
        resumeData: task.resumeData != null ? String(task.resumeData) : null,
      };

      // ─── Step 1: Synchronous in-memory update (immediate UI notification) ───
      const idx = tasks.findIndex((t) => t.id === sanitizedTask.id);
      const updated = { ...sanitizedTask, updatedAt: Date.now() };

      if (idx >= 0) {
        const copy = [...tasks];
        copy[idx] = updated;
        update(copy, [sanitizedTask.id]);
      } else {
        update([updated, ...tasks], [sanitizedTask.id]);
      }

      // ─── Step 2: Async DB persistence (fire-and-forget, never blocks UI) ───
      const db = await getSQLite();
      if (db) {
        if (idx >= 0) {
          // Partial update — only writes changed fields, no full row replace
          try {
            await db.update({
              id: sanitizedTask.id,
              status: sanitizedTask.status,
              receivedBytes: sanitizedTask.receivedBytes,
              totalBytes: sanitizedTask.totalBytes,
              fileUri: sanitizedTask.fileUri,
              error: sanitizedTask.error,
              // FIX: Always write as string or null — never a number
              resumeData:
                sanitizedTask.resumeData != null
                  ? String(sanitizedTask.resumeData)
                  : null,
              retryCount: sanitizedTask.retryCount,
              speedLimit: sanitizedTask.speedLimit,
              priority: sanitizedTask.priority,
              fileName: sanitizedTask.fileName,
              posterPath: sanitizedTask.posterPath,
              title: sanitizedTask.title,
              extension: sanitizedTask.extension,
              quality: sanitizedTask.quality,
              server: sanitizedTask.server,
            });
          } catch (e) {
            console.warn("[Store] SQLite update failed:", e);
          }
        } else {
          // New task — full insert
          try {
            await db.insert(sanitizedTask);
          } catch (e) {
            console.warn("[Store] SQLite insert failed:", e);
          }
        }
      } else if (adapter) {
        const STORAGE_KEY = "@filmsnaps/downloads/v2";
        try {
          const raw = await adapter.getItem(STORAGE_KEY);
          const all: DownloadTask[] = raw ? JSON.parse(raw) : [];
          const aIdx = all.findIndex((t) => t.id === sanitizedTask.id);
          if (aIdx >= 0) all[aIdx] = updated;
          else all.unshift(updated);
          await adapter.setItem(STORAGE_KEY, JSON.stringify(all));
        } catch {}
      }
    },

    async replaceAll(newTasks: DownloadTask[]) {
      const db = await getSQLite();
      if (db) {
        try {
          for (const t of tasks) {
            try {
              await db.delete(t.id);
            } catch {}
          }
          for (const t of newTasks) {
            try {
              await db.insert(t);
            } catch {}
          }
        } catch (e) {
          console.warn("[Store] SQLite replaceAll failed:", e);
        }
      } else if (adapter) {
        const STORAGE_KEY = "@filmsnaps/downloads/v2";
        const toPersist = newTasks.map((t) => ({
          ...t,
          resumeData:
            t.status === "completed" || t.status === "cancelled"
              ? null
              : t.resumeData,
        }));
        await adapter.setItem(STORAGE_KEY, JSON.stringify(toPersist));
      }

      const allIds = [
        ...new Set([...tasks.map((t) => t.id), ...newTasks.map((t) => t.id)]),
      ];
      tasks = newTasks;
      loaded = true;
      notifyAll();
      for (const id of allIds) notifyTask(id);
      notifyLoaded();
    },

    async remove(id: string) {
      const db = await getSQLite();
      if (db) {
        try {
          await db.delete(id);
        } catch {}
      }
      if (adapter) {
        const STORAGE_KEY = "@filmsnaps/downloads/v2";
        try {
          const raw = await adapter.getItem(STORAGE_KEY);
          if (raw) {
            const all: DownloadTask[] = JSON.parse(raw);
            await adapter.setItem(
              STORAGE_KEY,
              JSON.stringify(all.filter((t) => t.id !== id)),
            );
          }
        } catch {}
      }

      const removed = tasks.find((t) => t.id === id);
      if (!removed) return;
      update(
        tasks.filter((t) => t.id !== id),
        [id],
      );
    },

    async clearCompleted() {
      const db = await getSQLite();
      if (db) {
        try {
          await db.deleteCompleted();
        } catch {}
      }

      const removedIds = tasks
        .filter((t) => t.status === "completed" || t.status === "cancelled")
        .map((t) => t.id);
      if (removedIds.length === 0) return;
      update(
        tasks.filter(
          (t) => t.status !== "completed" && t.status !== "cancelled",
        ),
        removedIds,
      );
    },

    subscribe(cb: (tasks: DownloadTask[]) => void): Unsubscribe {
      allListeners.add(cb);
      try {
        cb(tasks);
      } catch {}
      return () => {
        allListeners.delete(cb);
      };
    },

    subscribeTask(
      taskId: string,
      cb: (task: DownloadTask | undefined) => void,
    ): Unsubscribe {
      let set = taskListeners.get(taskId);
      if (!set) {
        set = new Set();
        taskListeners.set(taskId, set);
      }
      set.add(cb);
      try {
        cb(tasks.find((t) => t.id === taskId));
      } catch {}
      return () => {
        set!.delete(cb);
        if (set!.size === 0) taskListeners.delete(taskId);
      };
    },

    subscribeLoaded(cb: (loaded: boolean) => void): Unsubscribe {
      loadedListeners.add(cb);
      try {
        cb(loaded);
      } catch {}
      return () => {
        loadedListeners.delete(cb);
      };
    },

    async load(): Promise<DownloadTask[]> {
      const db = await getSQLite();
      if (db) {
        try {
          const all = await db.getAll();
          tasks = (all || []).map((t: DownloadTask) =>
            t.status === "downloading" || t.status === "pending"
              ? {
                  ...t,
                  status: "paused" as DownloadStatus,
                  error: "App was closed. Tap resume to continue.",
                }
              : t,
          );
        } catch (e) {
          console.warn("[Store] SQLite load failed:", e);
        }
      }

      if (tasks.length === 0 && adapter) {
        try {
          const STORAGE_KEY = "@filmsnaps/downloads/v2";
          const raw = await adapter.getItem(STORAGE_KEY);
          if (raw) {
            const parsed: DownloadTask[] = JSON.parse(raw);
            tasks = parsed.map((t) =>
              t.status === "downloading" || t.status === "pending"
                ? {
                    ...t,
                    status: "paused" as DownloadStatus,
                    error: "App was closed. Tap resume to continue.",
                  }
                : t,
            );
            const sqlDb = await getSQLite();
            if (sqlDb && tasks.length > 0) {
              for (const task of tasks) {
                try {
                  await sqlDb.insert(task);
                } catch {}
              }
              try {
                await adapter.removeItem(STORAGE_KEY);
              } catch {}
            }
          }
        } catch (e) {
          console.warn("[Store] Adapter load failed:", e);
        }
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

// ── AsyncStorage Adapter (kept for backward compatibility / migration) ──

import AsyncStorage from "@react-native-async-storage/async-storage";

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
    async getItem(key: string) {
      return store.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      store.set(key, value);
    },
    async removeItem(key: string) {
      store.delete(key);
    },
  };
}
