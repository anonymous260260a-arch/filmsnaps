# Diagnostic: `GO_BACK` Navigation Context Loss After Download Operations

> **Target audience:** Senior React Native / React Navigation developer  
> **Type:** Reference + Explanation (Diátaxis framework)  
> **Purpose:** Handoff document for expert diagnosis of a navigation context corruption bug

---

## 1. Problem Statement

After **any** download operation (start, pause, resume) in a React Native app using Expo Router v55 + React Navigation 6, the back button (`router.back()`) stops working. Pressing back floods the console with 20+ repeated errors:

```
ERROR  The action 'GO_BACK' was not handled by any navigator.
```

The error repeats rapidly, suggesting **programmatic dispatch** in a tight loop (possibly from React Navigation's hardware back-button hook re-dispatching on every re-render), not a single user press.

### Affected Operations

| Operation | Triggers GO_BACK error? |
|-----------|------------------------|
| Initial page load | ❌ No |
| Start a download (`enqueue()`) | ✅ Yes |
| Pause a download | ✅ Yes |
| Resume a download | ✅ Yes |
| Back press on Downloads page after any of the above | ✅ Yes |
| Back press on Nxsha page after any of the above | ✅ Yes |

### Affected Pages

| Page | Navigation Type | Presentation |
|------|----------------|--------------|
| `app/download/nxsha/[...id].tsx` | `fullScreenModal` | `slide_from_bottom` |
| `app/downloads.tsx` | Stack push | `slide_from_right` |

### Full Error Log (Verbatim)

```
LOG  [Engine] Starting download: url="https://video-downloads.googleusercontent.com/..." resume=false
ERROR  The action 'GO_BACK' was not handled by any navigator.
ERROR  The action 'GO_BACK' was not handled by any navigator.
...
(repeats 20+ times)
```

---

## 2. Architecture Overview

### Data Flow

```
                      ┌──────────────────┐
                      │   engine.ts       │  ← Pure TS. Manages expo-file-system DownloadResumable
                      │  (createEngine)   │     Emits progress/status via callback subscriptions
                      └────────┬─────────┘
                               │ onProgress / onStatus events
                               ▼
                      ┌──────────────────┐
                      │  context.tsx      │  ← React Provider. Wires engine → store.
                      │  (DownloadInfra)  │     Creates singleton engine+store via useRef.
                      │                   │     Deferred store mutations (Promise.resolve().then()).
                      └────────┬─────────┘
                               │ store.upsert() + notify()
                               ▼
                      ┌──────────────────┐
                      │  store.ts         │  ← In-memory + AsyncStorage persistence.
                      │  (Observable)     │     subscribe()/notify() pattern.
                      │                   │     500ms debounced persist.
                      └────────┬─────────┘
                               │ useSyncExternalStore subscriptions
                               ▼
            ┌──────────────────────────────────┐
            │  useDownload.ts                  │
            │  useDownloadList.ts              │  ← React hooks.
            │  useDownloadQueue.ts             │     Subscribe via useSyncExternalStore.
            └──────────────────────────────────┘
```

### Key Observation

The `context.tsx` provider wraps engine events in `Promise.resolve().then()` to defer store mutations, but:

1. The **enqueue function** (in `context.tsx`) calls `store.upsert()` **synchronously**, then calls `engine.start()` which is async — but `engine.start()` catches errors and calls `store.upsert()` on failure. Both of these run on the same microtask queue as the deferred listeners.
2. The **control function** (also in `context.tsx`) iterates tasks with `for` + `await`, calling `engine.pause()` / `engine.cancel()` / `store.upsert()` sequentially. The synchronous `upsert()` + `notify()` triggers React re-renders via `useSyncExternalStore` **during the async function execution**.
3. React Navigation's state management may be corrupted when synchronous re-renders happen mid-async-operation.

---

## 3. Complete Source Code

### 3.1 Engine — `apps/mobile/lib/download/engine.ts`

Full source (287 lines):

```typescript
/**
 * Download Engine — Pure TS download lifecycle management.
 *
 * Zero React imports. Manages expo-file-system DownloadResumable instances,
 * handles pause/resume with resumeData persistence, and emits progress/status
 * events via callback subscriptions.
 *
 * Fixes applied:
 * - Validates file size after download (≥10KB or mark as failed)
 * - Progress callback no longer double-emits 'completed'
 * - pauseAsync failure → 'paused' not 'failed' (graceful degradation)
 * - Cancel emits 'cancelled' before attempting native pause
 * - Internal progress throttle to reduce JS thread load
 * - Progress-based timeout (60s no progress → auto fail)
 * - Handles unknown content-length (-1) without false completions
 */

import {
  createDownloadResumable,
  DownloadResumable,
  documentDirectory,
  makeDirectoryAsync,
  getInfoAsync,
  deleteAsync,
} from 'expo-file-system/legacy';

import type {
  DownloadTask,
  DownloadStatus,
  DownloadProgress,
  StatusChange,
  Unsubscribe,
} from './types';

// ── Constants ──

const DOWNLOAD_DIR = (documentDirectory ?? '') + 'downloads/';
/** Files smaller than this (bytes) are treated as error pages, not video content */
const MIN_VALID_FILE_SIZE = 10_240;
/** Timeout if no progress received for this many ms */
const PROGRESS_TIMEOUT_MS = 60_000;
/** How often to check for progress timeout */
const TIMEOUT_CHECK_INTERVAL = 10_000;
/** Throttle progress emissions to this interval (ms) */
const PROGRESS_THROTTLE = 200;

// ── Interface ──

export interface IDownloadEngine {
  /** Start or resume a download */
  start(task: DownloadTask): Promise<void>;

  /** Pause an active download. Returns the opaque resumeData string. */
  pause(taskId: string): Promise<string | null>;

  /** Cancel and delete partial file. Returns the fileUri for cleanup. */
  cancel(taskId: string): Promise<string | null>;

  /** Remove the file from disk */
  remove(taskId: string, fileUri: string | null): Promise<void>;

  /** Subscribe to byte-level progress events */
  onProgress(cb: (p: DownloadProgress) => void): Unsubscribe;

  /** Subscribe to status transitions */
  onStatus(cb: (s: StatusChange) => void): Unsubscribe;

  /** Number of currently in-flight downloads */
  getActiveCount(): number;

  /** Cancel all active downloads and clean up all subscriptions */
  destroy(): Promise<void>;
}

// ── Create Engine ──

export function createDownloadEngine(): IDownloadEngine {
  const resumables = new Map<string, DownloadResumable>();
  const progressListeners = new Set<(p: DownloadProgress) => void>();
  const statusListeners = new Set<(s: StatusChange) => void>();

  function emitProgress(taskId: string, receivedBytes: number, totalBytes: number) {
    const event: DownloadProgress = { taskId, receivedBytes, totalBytes };
    for (const cb of progressListeners) cb(event);
  }

  function emitStatus(taskId: string, status: DownloadStatus, error?: string) {
    const event: StatusChange = { taskId, status, error };
    for (const cb of statusListeners) cb(event);
  }

  async function ensureDir(): Promise<void> {
    const info = await getInfoAsync(DOWNLOAD_DIR);
    if (!info.exists) {
      await makeDirectoryAsync(DOWNLOAD_DIR, { intermediates: true });
    }
  }

  function buildFileUri(task: DownloadTask): string {
    const safeName = task.fileName.replace(/[<>:"/\\|?*]/g, '_');
    return `${DOWNLOAD_DIR}${safeName}`;
  }

  return {
    async start(task: DownloadTask): Promise<void> {
      await ensureDir();
      const fileUri = buildFileUri(task);

      console.log(`[Engine] Starting download: url="${task.url}" resume=${!!task.resumeData}`);

      let lastProgressTime = Date.now();
      let lastThrottleTime = 0;

      // ── Progress-based timeout watchdog ──
      const watchdog = setInterval(() => {
        if (Date.now() - lastProgressTime > PROGRESS_TIMEOUT_MS) {
          clearInterval(watchdog);
          const r = resumables.get(task.id);
          if (r) {
            try { r.pauseAsync(); } catch {}
            resumables.delete(task.id);
          }
          emitStatus(task.id, 'failed', 'Download timed out: no progress received for 60s');
        }
      }, TIMEOUT_CHECK_INTERVAL);

      const download = createDownloadResumable(
        task.url,
        fileUri,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          md5: false,
        },
        (progress) => {
          lastProgressTime = Date.now();
          const received = progress.totalBytesWritten;
          const total = progress.totalBytesExpectedToWrite;

          const now = Date.now();
          if (now - lastThrottleTime < PROGRESS_THROTTLE) return;
          lastThrottleTime = now;

          emitProgress(task.id, received, total);
        },
        task.resumeData ?? undefined,
      );

      resumables.set(task.id, download);
      emitStatus(task.id, 'downloading');

      try {
        const result = await download.downloadAsync();
        clearInterval(watchdog);

        if (!result?.uri) {
          emitStatus(task.id, 'failed', 'Download returned no file');
          return;
        }

        const fileInfo = await getInfoAsync(result.uri);
        const fileSize = fileInfo?.size ?? 0;

        if (fileSize < MIN_VALID_FILE_SIZE) {
          await deleteAsync(result.uri, { idempotent: true });
          emitStatus(task.id, 'failed', 'Server returned invalid response (server may be down)');
          return;
        }

        emitProgress(task.id, fileSize, fileSize);
        emitStatus(task.id, 'completed');
      } catch (err: any) {
        clearInterval(watchdog);
        if (!resumables.has(task.id)) return;
        try {
          const pauseResult = await download.pauseAsync();
          if (pauseResult?.resumeData) {
            emitStatus(task.id, 'paused');
            return;
          }
        } catch {}
        emitStatus(task.id, 'failed', err?.message || 'Download failed');
      } finally {
        resumables.delete(task.id);
      }
    },

    async pause(taskId: string): Promise<string | null> {
      const r = resumables.get(taskId);
      if (!r) {
        emitStatus(taskId, 'paused');
        return null;
      }
      try {
        const result = await r.pauseAsync();
        resumables.delete(taskId);
        const resumeData = result?.resumeData ?? null;
        emitStatus(taskId, 'paused');
        return resumeData;
      } catch (err) {
        console.warn(`[Engine] pauseAsync failed for ${taskId}:`, err);
        resumables.delete(taskId);
        emitStatus(taskId, 'paused');
        return null;
      }
    },

    async cancel(taskId: string): Promise<string | null> {
      emitStatus(taskId, 'cancelled');
      const r = resumables.get(taskId);
      let fileUri: string | null = null;
      if (r) {
        try { await r.pauseAsync(); } catch {}
        resumables.delete(taskId);
      }
      return fileUri;
    },

    async remove(taskId: string, fileUri: string | null): Promise<void> {
      const r = resumables.get(taskId);
      if (r) {
        try { await r.pauseAsync(); } catch {}
        resumables.delete(taskId);
      }
      if (fileUri) {
        try { await deleteAsync(fileUri, { idempotent: true }); } catch {}
      }
    },

    onProgress(cb: (p: DownloadProgress) => void): Unsubscribe {
      progressListeners.add(cb);
      return () => progressListeners.delete(cb);
    },

    onStatus(cb: (s: StatusChange) => void): Unsubscribe {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },

    getActiveCount(): number { return resumables.size; },

    async destroy(): Promise<void> {
      for (const [id, r] of resumables) { try { await r.pauseAsync(); } catch {} }
      resumables.clear();
      progressListeners.clear();
      statusListeners.clear();
    },
  };
}
```

### 3.2 Store — `apps/mobile/lib/download/store.ts`

Full source (199 lines):

```typescript
import type {
  DownloadTask,
  DownloadStatus,
  Unsubscribe,
  StorageAdapter,
} from './types';

export interface IDownloadStore {
  getAll(): DownloadTask[];
  getById(id: string): DownloadTask | undefined;
  getByMedia(tmdbId: string, server?: string): DownloadTask[];
  getBySeason(tmdbId: string, season: number): DownloadTask[];
  upsert(task: DownloadTask): Promise<void>;
  replaceAll(tasks: DownloadTask[]): Promise<void>;
  remove(id: string): Promise<void>;
  clearCompleted(): Promise<void>;
  subscribe(cb: (tasks: DownloadTask[]) => void): Unsubscribe;
  load(): Promise<DownloadTask[]>;
  isLoaded(): boolean;
}

const STORAGE_KEY = '@filmsnaps/downloads/v2';

export function createDownloadStore(adapter: StorageAdapter): IDownloadStore {
  let tasks: DownloadTask[] = [];
  let loaded = false;
  const listeners = new Set<(tasks: DownloadTask[]) => void>();
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  function notify() {
    const snapshot = tasks;
    for (const cb of listeners) {
      try { cb(snapshot); } catch {}
    }
  }

  function debouncedPersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const toPersist = tasks.map((t) => ({
        ...t,
        resumeData: (t.status === 'completed' || t.status === 'cancelled') ? null : t.resumeData,
      }));
      adapter.setItem(STORAGE_KEY, JSON.stringify(toPersist)).catch(() => {});
    }, 500);
  }

  function update(updated: DownloadTask[]) {
    tasks = updated;
    notify();
    debouncedPersist();
  }

  return {
    getAll() { return tasks; },
    getById(id: string) { return tasks.find((t) => t.id === id); },
    getByMedia(tmdbId: string, server?: string) { /* ... */ },
    getBySeason(tmdbId: string, season: number) { /* ... */ },

    async upsert(task: DownloadTask) {
      const idx = tasks.findIndex((t) => t.id === task.id);
      const updated = { ...task, updatedAt: Date.now() };
      if (idx >= 0) {
        const copy = [...tasks];
        copy[idx] = updated;
        update(copy);
      } else {
        update([updated, ...tasks]);
      }
    },

    async replaceAll(newTasks: DownloadTask[]) { /* ... */ },
    async remove(id: string) { update(tasks.filter((t) => t.id !== id)); },
    async clearCompleted() { update(tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled')); },

    subscribe(cb: (tasks: DownloadTask[]) => void): Unsubscribe {
      listeners.add(cb);
      try { cb(tasks); } catch {}
      return () => { listeners.delete(cb); };
    },

    async load(): Promise<DownloadTask[]> {
      try {
        const raw = await adapter.getItem(STORAGE_KEY);
        if (raw) {
          const parsed: DownloadTask[] = JSON.parse(raw);
          tasks = parsed.map((t) =>
            t.status === 'downloading' || t.status === 'pending'
              ? { ...t, status: 'paused' as DownloadStatus, error: 'App was closed. Tap resume to continue.' }
              : t,
          );
        }
      } catch (e) { console.warn('[DownloadStore] Failed to load:', e); }
      loaded = true;
      notify();
      return tasks;
    },

    isLoaded() { return loaded; },
  };
}
```

### 3.3 Context Provider — `apps/mobile/lib/download/context.tsx`

Full source (246 lines — **this is the critical wiring file**):

```typescript
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createDownloadEngine, type IDownloadEngine } from './engine';
import { createDownloadStore, type IDownloadStore, createAsyncStorageAdapter } from './store';
import type { DownloadTask, DownloadMeta, ControlAction, ControlTarget } from './types';

function generateId(): string {
  return `dl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export interface DownloadInfra {
  engine: IDownloadEngine;
  store: IDownloadStore;
  enqueue: (meta: DownloadMeta) => string;
  control: (action: ControlAction, target?: ControlTarget) => Promise<void>;
}

const DownloadInfraContext = createContext<DownloadInfra | null>(null);

export function DownloadInfraProvider({
  children,
  storeOverride,
  engineOverride,
}: {
  children: React.ReactNode;
  storeOverride?: IDownloadStore;
  engineOverride?: IDownloadEngine;
}) {
  const infraRef = useRef<DownloadInfra | null>(null);

  if (!infraRef.current) {
    const engine = engineOverride ?? createDownloadEngine();
    const store = storeOverride ?? createDownloadStore(createAsyncStorageAdapter());
    const control = createControl(engine, store);
    const enqueue = createEnqueue(engine, store);
    infraRef.current = { engine, store, enqueue, control };
  }

  const { engine, store, control } = infraRef.current;
  const [ready, setReady] = useState(store.isLoaded());

  useEffect(() => {
    store.load().then(() => setReady(true));
  }, [store]);

  // ⚠️ ENGINE EVENTS → STORE MUTATIONS (DEFERRED VIA MICROTASK)
  useEffect(() => {
    let lastProgressUpdate = 0;
    const THROTTLE_MS = 300;

    const unsubProgress = engine.onProgress((p) => {
      const now = Date.now();
      if (now - lastProgressUpdate < THROTTLE_MS) return;
      lastProgressUpdate = now;

      const existing = store.getById(p.taskId);
      if (existing) {
        // Deferred to microtask to prevent sync re-render inside async download
        Promise.resolve().then(() => {
          store.upsert({
            ...existing,
            receivedBytes: p.receivedBytes,
            totalBytes: p.totalBytes,
            status: 'downloading',
          });
        });
      }
    });

    const unsubStatus = engine.onStatus((s) => {
      const existing = store.getById(s.taskId);
      if (existing) {
        // Deferred to microtask — prevents nested sync re-renders during
        // async engine operations that could disrupt the navigation context
        Promise.resolve().then(() => {
          store.upsert({ ...existing, status: s.status, error: s.error });
        });
      }
    });

    return () => { unsubProgress(); unsubStatus(); };
  }, [engine, store]);

  useEffect(() => { return () => { engine.destroy(); }; }, [engine]);

  if (!ready) return null;
  return (
    <DownloadInfraContext.Provider value={infraRef.current}>
      {children}
    </DownloadInfraContext.Provider>
  );
}

export function useDownloadInfra(): DownloadInfra {
  const ctx = useContext(DownloadInfraContext);
  if (!ctx) throw new Error('DownloadInfraProvider not found in tree');
  return ctx;
}

// ── Enqueue ──

function createEnqueue(engine: IDownloadEngine, store: IDownloadStore) {
  return function enqueue(meta: DownloadMeta): string {
    const id = generateId();
    const ext = meta.extension || meta.fileName.split('.').pop() || 'mp4';
    const task: DownloadTask = {
      ...meta, id, fileUri: null,
      totalBytes: 0, receivedBytes: 0,
      status: 'pending',
      createdAt: Date.now(), updatedAt: Date.now(),
      extension: ext,
    };

    store.upsert(task);                       // ← SYNC store mutation + notify()
    engine.start(task).catch((err) => {       // ← starts async download
      console.error('[Enqueue] engine.start failed:', err);
      const existing = store.getById(id);
      if (existing && existing.status === 'pending') {
        store.upsert({ ...existing, status: 'failed', error: err?.message || 'Failed to start' });
      }
    });
    return id;
  };
}

// ── Control ──

function createControl(engine: IDownloadEngine, store: IDownloadStore) {
  return async function control(action: ControlAction, target?: ControlTarget) {
    let ids: string[] = [];
    if (!target) { ids = store.getAll().map((t) => t.id); }
    else if (typeof target === 'string') { ids = [target]; }
    else if (Array.isArray(target)) { ids = target; }
    else if (target.status) {
      const statuses = Array.isArray(target.status) ? target.status : [target.status];
      ids = store.getAll().filter((t) => statuses.includes(t.status)).map((t) => t.id);
    }

    for (const id of ids) {
      const task = store.getById(id);
      if (!task) continue;

      switch (action) {
        case 'pause': {
          if (task.status !== 'downloading') break;
          const resumeData = await engine.pause(id);     // ← async
          if (resumeData) {
            store.upsert({ ...task, status: 'paused', resumeData });  // ← sync during async
          }
          break;
        }
        case 'resume': {
          if (task.status === 'paused' || task.status === 'failed' || task.status === 'cancelled') {
            if (task.status !== 'paused') {
              await engine.remove(id, task.fileUri);
              const reset = { ...task, status: 'pending', receivedBytes: 0, totalBytes: 0, error: undefined, fileUri: null, resumeData: null };
              store.upsert(reset);
            }
            const updated = store.getById(id);
            if (updated) { engine.start(updated).catch(console.error); }
          }
          break;
        }
        case 'cancel': {
          store.upsert({ ...task, status: 'cancelled' });  // ← sync
          await engine.cancel(id);                          // ← async after sync
          break;
        }
        case 'retry': { /* ... similar pattern */ break; }
        case 'remove': { /* ... */ break; }
      }
    }
  };
}
```

### 3.4 Hook: `useDownload.ts`

```typescript
import { useCallback } from 'react';
import { useSyncExternalStore } from 'react';
import { useDownloadInfra } from './context';
import type { DownloadTask } from './types';

export function useDownload(taskId: string | undefined) {
  const { store, engine } = useDownloadInfra();

  const task = useSyncExternalStore(
    (cb) => store.subscribe(() => cb()),     // ⚠️ store.subscribe notifies every listener
    () => (taskId ? store.getById(taskId) : undefined),
  );

  const progress = task && task.totalBytes > 0 ? task.receivedBytes / task.totalBytes : 0;

  const pause = useCallback(async () => {
    if (!taskId) return;
    const current = store.getById(taskId);
    if (!current || current.status !== 'downloading') return;
    const resumeData = await engine.pause(taskId);      // ← async
    if (resumeData) {
      store.upsert({ ...current, status: 'paused', resumeData });  // ← sync during async
    }
  }, [taskId, engine, store]);

  const resume = useCallback(async () => {
    if (!taskId) return;
    const current = store.getById(taskId);
    if (!current) return;
    if (current.status === 'paused') {
      engine.start(current).catch(console.error);        // ← async, no await
    } else if (current.status === 'failed' || current.status === 'cancelled') {
      await engine.remove(taskId, current.fileUri);
      const reset = { ...current, status: 'pending', receivedBytes: 0, totalBytes: 0, error: undefined, fileUri: null, resumeData: null };
      store.upsert(reset);
      engine.start(reset).catch(console.error);
    }
  }, [taskId, engine, store]);

  const cancel = useCallback(async () => {
    if (!taskId) return;
    const current = store.getById(taskId);
    if (!current) return;
    store.upsert({ ...current, status: 'cancelled' });  // ← sync
    await engine.cancel(taskId);                          // ← async
  }, [taskId, engine, store]);

  // ... retry, remove follow similar patterns

  return { task, progress, pause, resume, cancel, /* ... */ };
}
```

### 3.5 Hook: `useDownloadList.ts`

```typescript
import { useSyncExternalStore, useMemo } from 'react';
import { useDownloadInfra } from './context';

export function useDownloadList() {
  const { store, control } = useDownloadInfra();

  const tasks = useSyncExternalStore(
    (cb) => store.subscribe(() => cb()),
    () => store.getAll(),
  );

  const loaded = useSyncExternalStore(
    (cb) => store.subscribe(() => cb()),
    () => store.isLoaded(),
  );

  return useMemo(() => {
    return {
      all: tasks,
      active: tasks.filter(t => t.status === 'pending' || t.status === 'downloading'),
      paused: tasks.filter(t => t.status === 'paused'),
      completed: tasks.filter(t => t.status === 'completed'),
      failed: tasks.filter(t => t.status === 'failed'),
      cancelled: tasks.filter(t => t.status === 'cancelled'),
      loaded,
      control,
    };
  }, [tasks, loaded, control]);
}
```

### 3.6 Hook: `useDownloadQueue.ts`

```typescript
import { useEffect, useRef } from 'react';
import { useDownloadInfra } from './context';
import { useDownloadList } from './useDownloadList';

export function useDownloadQueue(config?: { maxConcurrent?: number }) {
  const maxConcurrent = config?.maxConcurrent ?? 3;
  const { store, engine } = useDownloadInfra();
  const { active } = useDownloadList();
  const startedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsubStatus = engine.onStatus((s) => {
      if (['completed', 'failed', 'cancelled', 'paused'].includes(s.status)) {
        startedRef.current.delete(s.taskId);
        setTimeout(dequeue, 100);
      }
    });
    return unsubStatus;
  }, [engine, store]);

  function dequeue() {
    if (active.length >= maxConcurrent) return;
    const pending = store.getAll().filter(t => t.status === 'pending' && !startedRef.current.has(t.id));
    const slots = maxConcurrent - active.length;
    const toStart = pending.slice(0, slots);
    for (const task of toStart) {
      startedRef.current.add(task.id);
      engine.start(task).catch((err) => { console.error(err); startedRef.current.delete(task.id); });
    }
  }

  useEffect(() => { dequeue(); }, [active.length, maxConcurrent]);
  return { dequeue };
}
```

### 3.7 Types — `apps/mobile/lib/download/types.ts`

```typescript
export type DownloadStatus =
  | 'pending'       // Created, waiting for a queue slot
  | 'downloading'   // Actively downloading bytes
  | 'paused'        // Paused with resumeData saved for true resume
  | 'completed'     // Finished successfully
  | 'failed'        // Finished with error
  | 'cancelled';    // User-cancelled, partial file cleaned

export interface DownloadTask extends DownloadMeta {
  id: string;
  fileUri: string | null;
  totalBytes: number;
  receivedBytes: number;
  status: DownloadStatus;
  error?: string;
  resumeData?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DownloadMeta {
  url: string;
  fileName: string;
  server: 'falix' | 'nxsha' | 'alt-dl';
  tmdbId?: string;
  quality?: string;
  title?: string;
  posterPath?: string;
  extension?: string;
}

export type ControlAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'remove';
export type ControlTarget = string | string[] | { status?: DownloadStatus | DownloadStatus[] };

export interface DownloadProgress {
  taskId: string;
  receivedBytes: number;
  totalBytes: number;
}

export interface StatusChange {
  taskId: string;
  status: DownloadStatus;
  error?: string;
}
```

---

## 4. Navigation / Routing Setup

### `apps/mobile/app/_layout.tsx` (353 lines — key sections)

```typescript
export default function RootLayout() {
  const [fontsLoaded] = useFonts({ PlayfairDisplay_700Bold, Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  if (!fontsLoaded) return <Loading />;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <DownloadInfraProvider>    {/* ← engine + store created here */}
          <SettingsProvider>
            <AppContent />
          </SettingsProvider>
        </DownloadInfraProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function AppContent() {
  const { settings, loaded } = useSettings();
  if (!loaded) return <Loading />;

  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#070708' } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="movie/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="tv/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="watch/[...id]" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />

        {/* Download management pages */}
        <Stack.Screen name="downloads" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="download/nxsha/[...id]"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="download/falix/[...id]"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="download2/[...id]"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      </Stack>

      <Modal visible={!settings.legalAccepted} animationType="none" transparent={false}>
        <LegalGate />
      </Modal>
    </>
  );
}
```

---

## 5. The Two Problematic Pages

### 5.1 Downloads Page — `app/downloads.tsx`

The back button handler (line 491):

```tsx
<TouchableOpacity
  onPress={() => { try { if (router.canGoBack()) router.back(); else router.push('/'); } catch {} }}
>
  <Ionicons name="chevron-back" size={20} color="#F4F4F5" />
</TouchableOpacity>
```

This page:
- Mounts `useDownloadQueue({ maxConcurrent: 3 })` at the top level
- Uses `useDownloadList()` which subscribes via `useSyncExternalStore`
- Renders `TaskRow` components that each call `useDownload(taskId)`
- When user taps Resume/Pause, the hook's callback triggers `engine.pause()` / `engine.start()` → store mutation → React re-render

### 5.2 Nxsha Download Page — `app/download/nxsha/[...id].tsx`

The back button handler (line 802):

```tsx
<TouchableOpacity
  onPress={() => { try { if (router.canGoBack()) router.back(); else router.push('/'); } catch {} }}
>
  <Ionicons name="close" size={20} color="#fff" />
</TouchableOpacity>
```

This page:
- Calls `useDownloadInfra()` to get `enqueue`
- Calls `useDownloadList()` for `{ all: downloads }` to show active state on server card links
- The `handleDownload` callback calls `enqueue()` → `store.upsert()` sync → `engine.start()` async
- After `Alert.alert('Download Started', ...)`, the GO_BACK errors appear

---

## 6. What We've Tried (None Resolved the Issue)

### Fix 1: File Size Validation in Engine
- **Problem:** `downloadAsync()` returned `{uri}` for error pages (404/502).
- **Fix:** Validate `getInfoAsync(result.uri).size >= 10KB` after download.
- **Result:** Works for false completions, does NOT fix GO_BACK.

### Fix 2: Graceful Pause Failure
- **Problem:** `pauseAsync()` throwing → 'failed' status → error boundary crash.
- **Fix:** Engine.pause() catches all errors, emits 'paused' instead.
- **Result:** No more crash, does NOT fix GO_BACK.

### Fix 3: `.catch()` Handlers on All `engine.start()` Calls
- **Problem:** Unhandled promise rejections from `engine.start()`.
- **Fix:** Added `.catch(console.error)` to all 5 call sites.
- **Result:** No more unhandled rejections, does NOT fix GO_BACK.

### Fix 4: Cancel Race Condition
- **Problem:** `engine.cancel()` emitted 'cancelled' AFTER `pauseAsync()`, so error could overwrite to 'failed'.
- **Fix:** Emit 'cancelled' first, then attempt pause.
- **Result:** Correct status ordering, does NOT fix GO_BACK.

### Fix 5: Progress Throttle
- **Problem:** Progress events fired on every native chunk, flooding JS thread.
- **Fix:** 200ms throttle in engine + 300ms throttle in context.
- **Result:** Reduced load, does NOT fix GO_BACK.

### Fix 6: Progress-Based Timeout
- **Problem:** Download could hang forever.
- **Fix:** 60s no-progress watchdog.
- **Result:** Works, does NOT fix GO_BACK.

### Fix 7: Deferred Store Mutations (PRIMARY FIX FOR GO_BACK)
- **Problem:** Synchronous store.upsert() → notify() → useSyncExternalStore re-render inside async engine operations.
- **Fix:** Wrapped `store.upsert()` calls in `Promise.resolve().then()` in context.tsx event listeners.
- **Result:** ⚠️ **GO_BACK issue PERSISTS.** This was our main hypothesis.

### Fix 8: `router.canGoBack()` Guards
- **Problem:** `router.back()` throws when no parent screen exists.
- **Fix:** `if (router.canGoBack()) router.back(); else router.push('/')` wrapped in try-catch.
- **Result:** Prevents crash but does NOT prevent the GO_BACK error flood.

---

## 7. Key Suspicion: Synchronous Store Updates During Async Operations

Despite **Fix 7** (deferred mutations via microtask in context.tsx event listeners), the following synchronous store mutations still happen **inside** async download functions:

### In `enqueue()` — `context.tsx`:

```
store.upsert(task)         // ← SYNC — called before engine.start()
engine.start(task).catch() // ← ASYNC — runs in background
```

### In `control('pause')` — `context.tsx`:

```
const resumeData = await engine.pause(id);  // ← AWAIT
store.upsert({ ... });                       // ← SYNC — still inside the control() async function
```

### In `useDownload.pause()`:

```
const resumeData = await engine.pause(taskId);
store.upsert({ ... });  // ← SYNC — during async
```

### In `useDownload.cancel()`:

```
store.upsert({ ... });  // ← SYNC — called BEFORE await
await engine.cancel(taskId);
```

### Observations on the 20+ Repeated GO_BACK Errors:

1. The errors appear in a **tight flood**, not spaced by user presses. This rules out "user pressed back 20 times."
2. React Navigation's `useBackButton` (or the Android hardware back-button hook) may be re-dispatching GO_BACK on every re-render when navigation state is in an inconsistent state.
3. The `useSyncExternalStore` subscription in `useDownloadList` triggers React re-renders. If a store mutation happens mid-async-operation, the re-render could cause React Navigation's navigation container to receive updates about a stale navigation state.
4. Expo Router stores its navigation state in a global context. If store mutations cause React re-renders that tear down and re-mount navigation children, this could disrupt the navigation state reference.

### Hypothesis Stack (in decreasing order of likelihood):

1. **`useSyncExternalStore` + React 18 Concurrent Mode:** Synchronous store mutations during async functions cause React to interrupt and restart renders, potentially resetting refs that React Navigation depends on (navigation ref, navigation container ref).

2. **Component tree collapse during re-render:** When a store mutation (e.g., status change) triggers re-render in a component that also has a `WebView`, the WebView's lifecycle could interfere with the navigation stack's children.

3. **AsyncStorage write during navigation:** The 500ms debounced AsyncStorage persist (in `store.ts`) fires during a navigation gesture. AsyncStorage write on the JS thread could block or corrupt a navigation state serialization that's in progress.

4. **Modal navigation confusion:** The Nxsha page uses `presentation: 'fullScreenModal'` while the Downloads page uses normal stack navigation. The `useBackButton` hook in React Navigation may handle these differently, and a store subscription update during the async download could cause the hook to lose track of which navigator should handle GO_BACK.

5. **The `Alert.alert('Download Started')` call:** In the Nxsha page's `handleDownload`, an `Alert.alert()` is shown after `enqueue()`. Dialogs can cause focus loss that resets React Navigation's focus state, and if the navigation state was in an inconsistent state due to a concurrent store mutation, the reset could corrupt it.

---

## 8. Questions for the Expert

### Core Navigation Question

1. **Why does `GO_BACK` flood 20+ times in rapid succession after a download operation?** The error pattern suggests programmatic re-dispatch, not manual user input. What mechanism in React Navigation (or Expo Router) could cause this?

### Suspicion: Concurrent State Mutation

2. **Can synchronous `useSyncExternalStore` re-renders triggered inside async functions (pause/resume/enqueue) corrupt React Navigation's navigation context?** Specifically:
   - An async function calls `engine.pause()` (awaited)
   - The status listener fires (deferred via microtask)
   - The microtask calls `store.upsert()` → `notify()` → `useSyncExternalStore` callback
   - React re-renders components
   - The original async function continues after the await
   - Does this interleaving pattern cause React Navigation to receive stale navigation state?

### Modal vs Stack Navigation

3. **Does `presentation: 'fullScreenModal'` handle the Android hardware back button differently from normal stack screens?** If `useBackButton` is dispatching GO_BACK on every re-render when the modal's stack becomes empty, could a store-triggered re-render cause the flood?

### AsyncStorage/Navigation Interaction

4. **Could the debounced AsyncStorage write (500ms) interfere with React Navigation's state serialization?** If a navigation action happens while AsyncStorage has an in-flight `setItem` call, could the navigation state be read/written corruptly?

### Alert + Navigation Focus

5. **Could the `Alert.alert()` call in the Nxsha download handler interact with React Navigation's focus tracking?** The sequence is:
   - `enqueue()` → store mutation → React re-render(s)
   - `Alert.alert()` → system dialog gains focus
   - Dismissing the dialog → focus returns to screen
   - But if the re-render(s) changed the navigation tree, does the focus restoration dispatch GO_BACK to a stale navigator?

### Obvious Oversight

6. **Is there something obvious we're missing?** The pattern is: mount a download screen, call `enqueue()`, `Alert.alert()`, then back button breaks. The 20+ repeated errors strongly suggest a loop. On Android, every React Navigation screen has an auto-back-press handler; could a state update during render cause it to fire repeatedly because `canGoBack()` oscillates between `true` and `false`?

---

## 9. Environment Details

| Layer | Version / Details |
|-------|-------------------|
| React Native | 0.74 (via Expo SDK 51) |
| Expo Router | ~3.5.x (file-based routing) |
| React Navigation | 6.x (underlying Expo Router) |
| expo-file-system | ~17.x (with `/legacy` import for DownloadResumable) |
| AsyncStorage | @react-native-async-storage/async-storage |
| Expo SDK | 51 |
| Platform | Android (tested on physical device and emulator) |
| Download URLs | Google Drive `video-downloads.googleusercontent.com` (~2500 char URLs) |

---

## 10. Repository Structure (Navigation Relevant)

```
apps/mobile/
  app/
    _layout.tsx                  ← Root Stack navigator + providers
    (tabs)/                      ← Tab navigator
    downloads.tsx                ← Downloads management page (stack push)
    download/
      nxsha/[...id].tsx          ← Nxsha download page (fullScreenModal)
      falix/[...id].tsx          ← Falix download page (fullScreenModal)
      [...id].tsx                ← Legacy download (DEV only)
    download2/[...id].tsx        ← Alt DL download page (fullScreenModal)
    movie/[id].tsx               ← Movie detail page
    tv/[id].tsx                  ← TV detail page
    legal.tsx                    ← Legal page (fullScreenModal)
    settings.tsx                 ← Settings page
    history.tsx                  ← Watch history
  lib/
    download/
      index.ts                   ← Public API
      types.ts                   ← Type definitions
      engine.ts                  ← Pure TS download engine
      store.ts                   ← Observable store + AsyncStorage persistence
      context.tsx                ← React Provider (wires engine ↔ store)
      useDownload.ts             ← Single task hook
      useDownloadList.ts         ← Grouped list hook
      useDownloadQueue.ts        ← Concurrency queue
      useEpisodeDownloads.ts     ← TV episode batch hooks
```

---

## 11. Reproduction Steps

1. Launch app on Android device
2. Navigate to Movie or TV detail page
3. Tap "Server 1 DL" → Nxsha download page opens (fullScreenModal)
4. Wait for CAPTCHA to auto-solve and links to appear
5. Tap any link → download starts
6. `Alert.alert('Download Started')` shown
7. Press back button → 20+ `GO_BACK not handled` errors flood console
8. **Alternative:** Go to Downloads page, tap Resume → same flood
