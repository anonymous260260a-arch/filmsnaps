/**
 * Download Infrastructure Provider — Wires manager ↔ store ↔ notifications.
 *
 * Creates singleton manager and store instances, loads persisted state
 * on mount, and wires manager events (progress, status) into store mutations
 * automatically. The DownloadManager handles queue, retry, speed limiting,
 * SQLite persistence, and notifications.
 *
 * Provides a stable context reference via useRef so the instances never change.
 * The old engine.ts is no longer used — the manager's adapter (BlobDownloaderAdapter)
 * handles all download I/O via react-native-blob-util.
 */

import React, { createContext, useContext, useEffect, useRef } from "react";
import NetInfo from "@react-native-community/netinfo";
import {
  createDownloadStore,
  type IDownloadStore,
  createAsyncStorageAdapter,
} from "./store";
import { DownloadManager } from "./manager";
import { DownloadNotifications } from "./notifications";
import { downloadToast } from "../../components/DownloadToast";
import type {
  DownloadTask,
  DownloadMeta,
  ControlAction,
  ControlTarget,
} from "./types";

// ── Helpers ──

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `dl_${crypto.randomUUID().substring(0, 8)}`;
  }
  return `dl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ── Context Value ──

export interface DownloadInfra {
  store: IDownloadStore;
  /** DownloadManager — the sole orchestrator for queue, retry, speed, SQLite, notifications */
  manager: DownloadManager;
  /** Enqueue a new download task (creates, persists to SQLite, starts via manager queue) */
  enqueue: (meta: DownloadMeta) => string;
  /** Perform an action on one or more tasks by filter */
  control: (action: ControlAction, target?: ControlTarget) => Promise<void>;
}

const DownloadInfraContext = createContext<DownloadInfra | null>(null);

// ── Provider ──

export function DownloadInfraProvider({
  children,
  storeOverride,
}: {
  children: React.ReactNode;
  storeOverride?: IDownloadStore;
}) {
  const infraRef = useRef<DownloadInfra | null>(null);

  if (!infraRef.current) {
    const store =
      storeOverride ?? createDownloadStore(createAsyncStorageAdapter());

    // Create the DownloadManager (the sole orchestrator)
    let manager: DownloadManager;
    try {
      const { BlobDownloaderAdapter } = require("./blobDownloader");
      const adapter = new BlobDownloaderAdapter();
      manager = new DownloadManager(adapter, {
        maxConcurrent: 3,
        enableNotifications: true,
      });
    } catch (e) {
      console.error(
        "[Provider] DownloadManager init failed — downloads unavailable:",
        e,
      );
      throw e;
    }

    const control = createControl(manager, store);
    const enqueue = createEnqueue(manager, store);
    infraRef.current = { store, manager, enqueue, control };
  }

  const { manager, store } = infraRef.current;

  // ── Load persisted state on mount ──
  // FIX: Sequence store.load() → manager.initialize() so the store has fully
  // hydrated (including its own stale-task recovery) before the manager does
  // its SQLite-side recovery. This prevents the library/hooks from seeing an
  // empty store on first render even when downloads exist in the database.
  useEffect(() => {
    const init = async () => {
      await store.load();
      await manager.initialize();
    };
    init().catch(() => {});
  }, [store, manager]);

  // ── Wire manager events → store mutations + notifications ──
  useEffect(() => {
    // ═══════════════════════════════════════════════════════════════
    // TIERED PROGRESS: O(1) per event → 250ms UI flush → 2s DB persist
    //
    // RNFB fires progress every ~100ms. Doing store.upsert (which
    // copies the entire tasks array) on every tick freezes the JS
    // thread. Instead:
    //   TIER 1 — per event: O(1) Map.set (coalesced, no React)
    //   TIER 2 — every 250ms: batch-flush to store.upsert (4 fps max)
    //   TIER 3 — every 2s: DB write via manager's internal timer
    // ═══════════════════════════════════════════════════════════════
    const pendingProgress = new Map<
      string,
      { received: number; total: number }
    >();

    const unsubProgress = manager.onProgress((p) => {
      // Tier 1: O(1) — only the last value per task survives
      pendingProgress.set(p.taskId, {
        received: Number(p.receivedBytes) || 0,
        total: Number(p.totalBytes) || 0,
      });
    });

    // Tier 2: flush pending progress to store at 250ms (max 4 updates/sec/task)
    const flushInterval = setInterval(() => {
      if (pendingProgress.size === 0) return;
      const batch = [...pendingProgress.entries()];
      pendingProgress.clear();
      for (const [taskId, { received, total }] of batch) {
        const existing = store.getById(taskId);
        if (existing) {
          store.upsert({
            ...existing,
            receivedBytes: received,
            totalBytes: total,
            status: "downloading",
            resumeData: existing.resumeData ?? null,
          });
        }
      }
    }, 250);

    const unsubStatus = manager.onStatus((s) => {
      const existing = store.getById(s.taskId);
      if (existing) {
        const update: DownloadTask = {
          ...existing,
          status: s.status,
          error: s.error,
        };
        if (s.resumeData !== undefined) {
          update.resumeData = s.resumeData;
        }
        store.upsert(update);
      }
      const title = existing?.title || existing?.fileName || "Download";

      // ── Show in-app toasts for user-facing events ──
      // Banner handles ambient status on tab screens; toasts reserved for errors,
      // cancellations, and events that occur on non-tab screens.
      if (existing) {
        switch (s.status) {
          case "downloading": {
            // Only toast when retrying (always notable) or resuming from pause
            if (existing.status === "paused") {
              downloadToast.info(`"${title}" resumed`);
            } else if (existing.status === "failed") {
              downloadToast.info(`"${title}" retrying...`);
            }
            // First-start toast suppressed — Banner shows ambient state
            break;
          }
          case "completed":
            downloadToast.success(`"${title}" downloaded`);
            DownloadNotifications.showCompleted(
              title,
              existing?.fileUri || "",
            ).catch(() => {});
            break;
          case "failed":
            downloadToast.error(s.error || `"${title}" failed`);
            DownloadNotifications.showFailed(
              title,
              s.error || "Unknown error",
            ).catch(() => {});
            break;
          case "cancelled":
            downloadToast.warning(`"${title}" cancelled`);
            break;
        }
      }
    });

    return () => {
      clearInterval(flushInterval);
      unsubProgress();
      unsubStatus();
    };
  }, [manager, store]);

  // ── Destroy manager on unmount ──
  useEffect(() => {
    return () => {
      manager.destroy();
    };
  }, [manager]);

  return (
    <DownloadInfraContext.Provider value={infraRef.current}>
      {children}
    </DownloadInfraContext.Provider>
  );
}

// ── Hook ──

export function useDownloadInfra(): DownloadInfra {
  const ctx = useContext(DownloadInfraContext);
  if (!ctx) throw new Error("DownloadInfraProvider not found in tree");
  return ctx;
}

// ── Enqueue factory ──

function createEnqueue(manager: DownloadManager, store: IDownloadStore) {
  // FIX: In-memory dedup lock based on url + fileName.
  // Prevents UI double-taps or React Strict Mode from enqueuing twice.
  const pendingEnqueues = new Map<string, string>();

  // Phase 10b: Request notification permissions on first enqueue (primer)
  let permissionPrimerShown = false;

  function requestPermissionPrimer() {
    if (permissionPrimerShown) return;
    permissionPrimerShown = true;
    DownloadNotifications.requestPermissions()
      .then((granted) => {
        if (!granted) {
          console.log(
            "[Enqueue] Notification permissions not granted — Banner/Toast feedback still works",
          );
        }
      })
      .catch(() => {});
  }

  return function enqueue(meta: DownloadMeta): string {
    // Fire-and-forget permission request on first enqueue
    requestPermissionPrimer();
    const key = `${meta.url}_${meta.fileName}`;

    // FIX 1: Check if an identical enqueue is currently in-flight
    const pendingId = pendingEnqueues.get(key);
    if (pendingId) {
      console.log("[Enqueue] Deduplicated via in-memory lock");
      return pendingId;
    }

    // Phase 1: If already completed, show "already saved" toast instead of silent dedup
    const alreadyCompleted = store
      .getAll()
      .find(
        (t) =>
          t.url === meta.url &&
          t.fileName === meta.fileName &&
          t.status === "completed",
      );
    if (alreadyCompleted) {
      downloadToast.success(
        `"${alreadyCompleted.title || "Download"}" already saved · ▶ Play`,
        4000,
      );
      return alreadyCompleted.id;
    }

    // FIX 2: Check store for existing active/pending (slower, async-safe)
    const existing = store
      .getAll()
      .find(
        (t) =>
          t.url === meta.url &&
          t.fileName === meta.fileName &&
          !["completed", "cancelled"].includes(t.status),
      );
    if (existing) return existing.id;

    // FIX 3: Generate new ID and immediately set the lock
    const id = generateId();
    pendingEnqueues.set(key, id);

    // Safe extension extraction: only use the part after the last dot if there IS a dot
    const fileNameParts = meta.fileName.split(".");
    const ext =
      meta.extension ||
      (fileNameParts.length > 1 ? fileNameParts.pop()! : "mp4");
    const task: DownloadTask = {
      ...meta,
      id,
      fileUri: null,
      totalBytes: 0,
      receivedBytes: 0,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      extension: ext,
      speedLimit: meta.speedLimit ?? 0,
    };

    // Log the download URL for debugging
    console.log(`[Enqueue] Download URL: ${meta.url}`);
    console.log(
      `[Enqueue] File: ${meta.fileName}, Server: ${meta.server}, Speed limit: ${meta.speedLimit ?? 0} B/s`,
    );

    // Persist to store (hooks see it immediately)
    store.upsert(task);

    // Show immediate toast feedback
    const title = task.title || task.fileName || "Download";
    downloadToast.success(`"${title}" queued`);

    // Add to the manager's queue (SQLite + download orchestration)
    manager
      .add(task)
      .catch((err) => {
        console.error("[Enqueue] manager.add failed:", err);
        const current = store.getById(id);
        if (current && current.status === "pending") {
          store.upsert({
            ...current,
            status: "failed",
            error: err?.message || "Failed to enqueue",
          });
        }
        downloadToast.error(
          `Failed to start download: ${err?.message || "Unknown error"}`,
        );
      })
      .finally(() => {
        // FIX 4: Release the lock after 2 seconds to allow DB to settle.
        // Prevents double-taps without permanently blocking retries.
        setTimeout(() => pendingEnqueues.delete(key), 2000);
      });

    return id;
  };
}

// ── Control (batch action) factory — uses manager exclusively ──

function createControl(manager: DownloadManager, store: IDownloadStore) {
  // FIX: Track in-flight actions to prevent duplicate processing
  const inFlightActions = new Set<string>();
  // Phase 10: Cancel undo stack
  const undoStack = new Map<
    string,
    { task: DownloadTask; timeout: ReturnType<typeof setTimeout> }
  >();

  return async function control(action: ControlAction, target?: ControlTarget) {
    let ids: string[] = [];
    if (!target) {
      ids = store.getAll().map((t) => t.id);
    } else if (typeof target === "string") {
      ids = [target];
    } else if (Array.isArray(target)) {
      ids = target;
    } else if (target.status) {
      const statuses = Array.isArray(target.status)
        ? target.status
        : [target.status];
      ids = store
        .getAll()
        .filter((t) => statuses.includes(t.status))
        .map((t) => t.id);
    }

    for (const id of ids) {
      // FIX: Dedup key prevents the same action+task from running concurrently
      const dedupKey = `${action}:${id}`;
      if (inFlightActions.has(dedupKey)) {
        console.log(`[Control] Skipping duplicate ${action} for ${id}`);
        continue;
      }
      inFlightActions.add(dedupKey);

      try {
        const task = store.getById(id);
        if (!task) continue;
        switch (action) {
          case "pause": {
            if (task.status !== "downloading") break;
            await manager.pause(id);
            break;
          }
          case "resume": {
            if (task.status === "paused") {
              await manager.resume(id);
            } else if (
              task.status === "failed" ||
              task.status === "cancelled"
            ) {
              await manager.retry(id);
            }
            break;
          }
          case "cancel": {
            await manager.cancel(id);
            // Show undo toast with 5s timeout
            const title = task.title || task.fileName || "Download";
            const timeout = setTimeout(() => {
              undoStack.delete(id);
            }, 5000);
            undoStack.set(id, { task, timeout });
            downloadToast.warning(
              `"${title}" cancelled · Undo`,
              5000,
              "Undo",
              async () => {
                const entry = undoStack.get(id);
                if (entry) {
                  clearTimeout(entry.timeout);
                  undoStack.delete(id);
                  await manager.retry(id);
                  downloadToast.info(`"${title}" download resumed`);
                }
              },
            );
            break;
          }
          case "retry": {
            await manager.retry(id);
            break;
          }
          case "remove": {
            await manager.remove(id);
            await store.remove(id);
            break;
          }
        }
      } finally {
        inFlightActions.delete(dedupKey);
      }
    }
  };
}
