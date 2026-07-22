/**
 * Download Infrastructure Provider — Wires engine ↔ store for React consumption.
 *
 * Creates singleton engine and store instances, loads persisted state on mount,
 * and wires engine events (progress, status) into store mutations automatically.
 * Provides a stable context reference via useRef so the instances never change.
 */

import React, { createContext, useContext, useEffect, useRef } from 'react';
import { createDownloadEngine, type IDownloadEngine } from './engine';
import { createDownloadStore, type IDownloadStore, createAsyncStorageAdapter } from './store';
import type { DownloadTask, DownloadMeta, ControlAction, ControlTarget } from './types';

// ── Helpers ──

function generateId(): string {
  return `dl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ── Context Value ──

export interface DownloadInfra {
  engine: IDownloadEngine;
  store: IDownloadStore;
  /** Enqueue a new download task (creates, persists, and starts) */
  enqueue: (meta: DownloadMeta) => string;
  /** Perform an action on one or more tasks by filter */
  control: (action: ControlAction, target?: ControlTarget) => Promise<void>;
}

const DownloadInfraContext = createContext<DownloadInfra | null>(null);

// ── Provider ──

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

  // ── Load persisted state on mount ──
  useEffect(() => {
    store.load();
  }, [store]);

  // ── Wire engine events → store mutations ──
  useEffect(() => {
    let lastProgressUpdate = 0;
    const THROTTLE_MS = 300;

    /**
     * Macrotask-based schedule for store mutations.
     * setTimeout(0) yields to React's commit phase before running,
     * preventing useSyncExternalStore re-renders from colliding with
     * in-progress async engine operations and navigation state.
     */
    const scheduleUpdate = (cb: () => void) => setTimeout(cb, 0);

    const unsubProgress = engine.onProgress((p) => {
      // Throttle: avoid flooding the store (and React) on every chunk
      const now = Date.now();
      if (now - lastProgressUpdate < THROTTLE_MS) return;
      lastProgressUpdate = now;

      const existing = store.getById(p.taskId);
      if (existing) {
        scheduleUpdate(() => {
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
        scheduleUpdate(() => {
          store.upsert({ ...existing, status: s.status, error: s.error });
        });
      }
    });

    return () => {
      unsubProgress();
      unsubStatus();
    };
  }, [engine, store]);

  // ── Pause all active on unmount ──
  useEffect(() => {
    return () => {
      engine.destroy();
    };
  }, [engine]);

  return (
    <DownloadInfraContext.Provider value={infraRef.current}>
      {children}
    </DownloadInfraContext.Provider>
  );
}

// ── Hook ──

export function useDownloadInfra(): DownloadInfra {
  const ctx = useContext(DownloadInfraContext);
  if (!ctx) throw new Error('DownloadInfraProvider not found in tree');
  return ctx;
}

// ── Control (batch action) factory ──

// ── Enqueue factory ──

function createEnqueue(engine: IDownloadEngine, store: IDownloadStore) {
  return function enqueue(meta: DownloadMeta): string {
    // Deduplicate: if the same URL+fileName is already active, return its id
    const existing = store.getAll().find(
      (t) =>
        t.url === meta.url &&
        t.fileName === meta.fileName &&
        !['completed', 'cancelled'].includes(t.status),
    );
    if (existing) return existing.id;

    const id = generateId();
    const ext = meta.extension || meta.fileName.split('.').pop() || 'mp4';
    const task: DownloadTask = {
      ...meta,
      id,
      fileUri: null,
      totalBytes: 0,
      receivedBytes: 0,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      extension: ext,
    };

    store.upsert(task);
    engine.start(task).catch((err) => {
      console.error('[Enqueue] engine.start failed:', err);
      const existing = store.getById(id);
      if (existing && existing.status === 'pending') {
        store.upsert({ ...existing, status: 'failed', error: err?.message || 'Failed to start' });
      }
    });
    return id;
  };
}

// ── Control (batch action) factory ──

function createControl(engine: IDownloadEngine, store: IDownloadStore) {
  return async function control(action: ControlAction, target?: ControlTarget) {
    let ids: string[] = [];

    if (!target) {
      ids = store.getAll().map((t) => t.id);
    } else if (typeof target === 'string') {
      ids = [target];
    } else if (Array.isArray(target)) {
      ids = target;
    } else if (target.status) {
      const statuses = Array.isArray(target.status) ? target.status : [target.status];
      ids = store.getAll()
        .filter((t) => statuses.includes(t.status))
        .map((t) => t.id);
    }

    for (const id of ids) {
      const task = store.getById(id);
      if (!task) continue;

      switch (action) {
        case 'pause': {
          if (task.status !== 'downloading') break;
          const resumeData = await engine.pause(id);
          if (resumeData) {
            store.upsert({ ...task, status: 'paused', resumeData });
          }
          break;
        }
        case 'resume': {
          if (task.status === 'paused' || task.status === 'failed' || task.status === 'cancelled') {
            if (task.status !== 'paused') {
              // For failed/cancelled, reset progress and delete old file
              await engine.remove(id, task.fileUri);
              const reset: DownloadTask = {
                ...task,
                status: 'pending',
                receivedBytes: 0,
                totalBytes: 0,
                error: undefined,
                fileUri: null,
                resumeData: null,
              };
              store.upsert(reset);
            }
            const updated = store.getById(id);
            if (updated) {
              engine.start(updated).catch(console.error);
            }
          }
          break;
        }
        case 'cancel': {
          store.upsert({ ...task, status: 'cancelled' });
          await engine.cancel(id);
          break;
        }
        case 'retry': {
          // Delete old file, reset progress, start fresh
          await engine.remove(id, task.fileUri);
          const reset: DownloadTask = {
            ...task,
            status: 'pending',
            receivedBytes: 0,
            totalBytes: 0,
            error: undefined,
            fileUri: null,
            resumeData: null,
          };
          store.upsert(reset);
          engine.start(reset);
          break;
        }
        case 'remove': {
          await engine.remove(id, task.fileUri);
          await store.remove(id);
          break;
        }
      }
    }
  };
}
