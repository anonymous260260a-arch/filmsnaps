// apps/mobile/lib/download/manager.ts
// KEY CHANGES:
// - processQueue uses shared-promise pattern (no re-entrancy)
// - resume() reuses existing native task handle
// - initialize() is explicit (not fire-and-forget constructor)
// - Completion guard prevents double-fire
//
// BUG FIXES applied (from EXPERT_BUGFIX_3.md):
//   A: getInfoAsync from modern API throws → use fsCompat
//   B: double extension (.mkv.mp4) → use buildFileName
//   C: path mismatch → handleNativeDone uses native filePath
//   E: pause writes 0 bytes → stat file on disk
//   F: emitStatus missing fileUri → include it in startDownload
//   Q6: cancel race → DB mark first, handleNativeDone checks status

import { DownloadDatabase } from "./database";
import { NativeDownloaderAdapter } from "./nativeAdapter";
import { NetworkAwarePolicy } from "./networkPolicy";
import { StorageManager } from "./storageManager";
import type { DownloadInstance } from "./adapter";
import { logger } from "./logger";
import type { DownloadStore } from "./store";
import type {
  DownloadTask,
  DownloadProgress,
  StatusChange,
  DownloadConfig,
} from "./types";
import { DEFAULT_CONFIG } from "./types";
import {
  getInfoAsync,
  deleteFile,
  ensureDirectory,
  getNativeDownloadDir,
} from "./fsCompat";
import { buildFileName, sanitizeForNative } from "./fileNameUtils";

// ─── Constants ───
const RETRY_DELAYS = [5_000, 15_000, 60_000];
const DB_WRITE_INTERVAL = 3_000;
const PROGRESS_EMIT_INTERVAL = 400;

// ─── Speed Tracker ───
class SpeedTracker {
  private samples: Array<{ time: number; bytes: number }> = [];
  private windowMs = 5_000;

  update(bytes: number): void {
    const now = Date.now();
    this.samples.push({ time: now, bytes });
    const cutoff = now - this.windowMs;
    while (this.samples.length > 0 && this.samples[0].time < cutoff) {
      this.samples.shift();
    }
  }

  getSpeed(): number {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const elapsedSec = (last.time - first.time) / 1000;
    if (elapsedSec <= 0.1) return 0;
    return Math.max(0, Math.round((last.bytes - first.bytes) / elapsedSec));
  }

  getEta(remainingBytes: number): number {
    const speed = this.getSpeed();
    if (speed <= 0) return 0;
    return Math.round(remainingBytes / speed);
  }

  reset(): void {
    this.samples = [];
  }
}

// ─── Event Types ───
type ProgressListener = (p: DownloadProgress) => void;
type StatusListener = (s: StatusChange) => void;
type QueueListener = (queueLength: number, activeCount: number) => void;

// ─── Manager ───
export class DownloadManager {
  private adapter: NativeDownloaderAdapter;
  private networkPolicy: NetworkAwarePolicy;
  private storage: StorageManager;
  private config: DownloadConfig;

  private queue: string[] = [];
  private activeInstances = new Map<string, DownloadInstance>();
  private speedTrackers = new Map<string, SpeedTracker>();
  private liveReceived = new Map<string, number>();
  private liveTotal = new Map<string, number>();

  // ─── Expert: per-task re-entrant pause lock ───
  private pauseInFlight = new Set<string>();

  // ─── Expert: store reference injected by context.tsx so initialize() can push
  //     DB corrections into the store via upsertMany(). Set via setStore(). ───
  private store: DownloadStore | null = null;

  // ─── Shared-promise queue lock ───
  private processQueuePromise: Promise<void> | null = null;

  private initialized = false;
  private pausedForNetwork = new Set<string>();

  // ─── FIX 5: Debounce timer for network policy spam ───
  private networkDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  private progressListeners = new Set<ProgressListener>();
  private statusListeners = new Set<StatusListener>();
  private queueListeners = new Set<QueueListener>();

  constructor(config?: Partial<DownloadConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.adapter = new NativeDownloaderAdapter();
    this.networkPolicy = new NetworkAwarePolicy(this.config.networkPolicy);
    this.storage = new StorageManager();

    // Network change handler (FIX 5: debounced to avoid 5x spam on startup)
    this.networkPolicy.onChange((canDownload, isWifi) => {
      if (this.networkDebounceTimer) {
        clearTimeout(this.networkDebounceTimer);
      }
      this.networkDebounceTimer = setTimeout(() => {
        this.networkDebounceTimer = null;
        if (!canDownload) {
          this.pauseAllForNetwork();
        } else {
          this.resumeNetworkPaused();
          this.processQueue();
        }
      }, 1000);
    });
  }

  /** Inject the store reference so initialize() can push DB corrections into the store.
   *  Must be called before initialize(). Called by context.tsx in the provider setup. */
  setStore(store: DownloadStore): void {
    this.store = store;
  }

  // ═══════════════════════════════════════════════════════════
  // INITIALIZATION (explicit, awaited by context)
  // ═══════════════════════════════════════════════════════════

  /**
   * Expert follow-up: reconcile DB state against the *live* ForegroundService before
   * deciding what's actually stale, then push every correction into the store via
   * store.upsertMany() — this is the actual fix for "stale store after hot reload."
   *
   * Must be called once before any downloads start.
   * The context provider awaits this in useEffect.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    logger.debug("Manager initialize start");

    try {
      const liveTaskIds = new Set(await this.adapter.getActiveTaskIds());
      const dbTasks = await DownloadDatabase.getAll();

      const corrections: DownloadTask[] = [];

      for (const task of dbTasks) {
        if (task.status !== "downloading") continue;

        if (liveTaskIds.has(task.id)) {
          // Genuinely still running (service survived; e.g. JS reload without force-stop).
          // Re-attach so the manager can receive further events for it, but do NOT touch
          // its status — it's correct as-is.
          this.reattachToLiveTask(task.id);
          continue;
        }

        // DB says "downloading" but the service has no such task — it died (force-stop,
        // crash, OS kill). This is the actually-stale case.
        const offset = await this.statPartialFileBytes(task);
        const corrected: DownloadTask = {
          ...task,
          status: "paused",
          receivedBytes: offset > 0 ? offset : task.receivedBytes,
        };
        corrections.push(corrected);
        await DownloadDatabase.update({
          id: task.id,
          status: "paused",
          receivedBytes: offset > 0 ? offset : task.receivedBytes,
          resumeData: offset > 0 ? String(offset) : null,
          updatedAt: Date.now(),
        });
      }

      // Also verify anything the DB thinks is "completed" actually still has its file
      for (const task of dbTasks) {
        if (task.status !== "completed" || !task.fileUri) continue;
        const info = await getInfoAsync(task.fileUri);
        if (!info.exists) {
          const corrected: DownloadTask = {
            ...task,
            status: "failed",
            error: "File missing on disk",
          };
          corrections.push(corrected);
          await DownloadDatabase.update({
            id: task.id,
            status: "failed",
            updatedAt: Date.now(),
          });
        }
      }

      if (corrections.length > 0 && this.store) {
        this.store.upsertMany(corrections);
      }

      // Requeue anything genuinely pending.
      const pending = dbTasks
        .filter((t) => t.status === "pending")
        .map((t) => t.id);
      this.queue.push(...pending);
      logger.debug("Manager initialize done", {
        active: this.activeInstances.size,
        queue: this.queue.length,
        corrections: corrections.length,
      });
      this.notifyQueue();
      this.processQueue();
    } catch (err) {
      logger.error("Manager initialization failed:", err);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════

  // ─── Q6 FIX: stale-task dedup ──────────────────────────────
  async add(task: DownloadTask): Promise<string> {
    logger.debug("Manager add", {
      id: task.id,
      title: task.title,
      status: task.status,
    });

    // Q6 fix: Only dedup against ACTIVE tasks.
    // A cancelled/failed/completed task with same URL should create a fresh entry.
    const existing = await DownloadDatabase.getAll();
    const activeStatuses = ["pending", "downloading", "paused", "retrying"];
    const dup = existing.find(
      (t) => t.url === task.url && activeStatuses.includes(t.status),
    );
    if (dup) {
      logger.debug(
        "Manager add: task already in DB, queuing",
        dup.id,
        dup.status,
      );
      // ── FIX 1: If the duplicate is pending, ensure it gets queued ──
      // The context inserts the task into DB before calling add(),
      // so add() finds its own just-created record as a "duplicate".
      // Without processQueue() here, the task sits in pending forever.
      if (dup.status === "pending") {
        if (!this.queue.includes(dup.id)) {
          this.queue.push(dup.id);
        }
        this.notifyQueue();
        this.processQueue();
      }
      return dup.id;
    }

    // If a terminal-state task exists with same URL, remove it first (Q6)
    const stale = existing.find((t) => t.url === task.url);
    if (stale) {
      logger.debug(
        "Manager add: found stale task, removing and re-creating",
        stale.id,
        stale.status,
      );
      await DownloadDatabase.delete(stale.id);
    }

    // Storage check
    const spaceCheck = await this.storage.canFit(task.totalBytes || 0);
    if (!spaceCheck.ok) {
      logger.debug("Manager add: insufficient space, freeing storage");
      const freed = await this.storage.evictOldest(
        task.totalBytes || 500 * 1024 * 1024,
      );
      if (freed < (task.totalBytes || 500 * 1024 * 1024)) {
        logger.error(
          "Manager add: evicted",
          freed,
          "bytes but still insufficient for",
          task.totalBytes,
        );
        throw new Error("Insufficient storage space for this download.");
      }
      logger.debug("Manager add: evicted", freed, "bytes, now proceeding");
    }

    // Ensure download directory exists
    ensureDirectory(getNativeDownloadDir());

    // Bug B+F fix: store the correct file path at insert time
    // Bug 3 fix: pass uniqueSuffix to prevent file name collisions
    const uniqueSuffix =
      task.season != null && task.episode != null
        ? `S${String(task.season).padStart(2, "0")}E${String(task.episode).padStart(2, "0")}`
        : task.id.slice(0, 20);
    const fileName = sanitizeForNative(
      buildFileName(task.fileName, task.extension, uniqueSuffix),
    );
    const filePath = this.adapter.getDestinationPath(fileName);

    await DownloadDatabase.insert({
      ...task,
      fileUri: filePath,
    });
    this.queue.push(task.id);
    logger.debug("Manager add: enqueued", {
      queue: this.queue.length,
      active: this.activeInstances.size,
    });
    this.notifyQueue();
    this.processQueue();
    return task.id;
  }

  // ─── PAUSE (expert: self-correction when no active instance) ──
  async pause(taskId: string): Promise<void> {
    if (this.pauseInFlight.has(taskId)) return;

    const instance = this.activeInstances.get(taskId);

    if (!instance) {
      // Expert follow-up: No live download to pause. If the store still shows
      // 'downloading', correct it now instead of silently no-op'ing.
      const current = this.store?.getById(taskId);
      if (current && current.status === "downloading") {
        const corrected: DownloadTask = {
          ...current,
          status: "paused",
          updatedAt: Date.now(),
        };
        this.store?.upsert(corrected);
        await DownloadDatabase.update({
          id: taskId,
          status: "paused",
          updatedAt: Date.now(),
        });
      }
      return;
    }

    this.pauseInFlight.add(taskId);
    try {
      await instance.pause(); // now resolves only after a genuine onDownloadPaused event

      let receivedBytes = this.liveReceived.get(taskId) ?? 0;
      if (receivedBytes === 0) {
        // Fallback: stat the partial file directly rather than trusting a zeroed
        // in-memory counter (defensive; the service-reported value should already be
        // correct and authoritative).
        const task = await DownloadDatabase.getById(taskId);
        if (task?.fileUri) {
          const info = await getInfoAsync(task.fileUri);
          if (info.exists && info.size) receivedBytes = info.size;
        }
      }

      const total = this.liveTotal.get(taskId) ?? 0;
      this.activeInstances.delete(taskId);
      await DownloadDatabase.update({
        id: taskId,
        status: "paused",
        receivedBytes,
        totalBytes: total > 0 ? total : undefined,
        resumeData: receivedBytes > 0 ? String(receivedBytes) : null,
        updatedAt: Date.now(),
      });
      this.emitStatus({
        taskId,
        status: "paused",
        receivedBytes,
        totalBytes: total > 0 ? total : undefined,
      });
      this.notifyQueue();
      this.processQueue();
    } finally {
      this.pauseInFlight.delete(taskId);
    }
  }

  async resume(taskId: string): Promise<void> {
    const task = await DownloadDatabase.getById(taskId);
    logger.debug("Manager resume", {
      taskId,
      found: !!task,
      status: task?.status,
      receivedBytes: task?.receivedBytes,
    });
    if (!task) return;
    if (!["paused", "failed"].includes(task.status)) return;

    if (!this.networkPolicy.canDownload()) {
      logger.debug("Manager resume: network unavailable, setting to pending");
      await DownloadDatabase.update({
        id: taskId,
        status: "pending",
        updatedAt: Date.now(),
      });
      this.queue.push(taskId);
      this.notifyQueue();
      return;
    }

    // Bug B fix: use buildFileName
    // Bug 3 fix: pass uniqueSuffix to prevent file name collisions
    const uniqueSuffix =
      task.season != null && task.episode != null
        ? `S${String(task.season).padStart(2, "0")}E${String(task.episode).padStart(2, "0")}`
        : task.id.slice(0, 20);
    const fileName = sanitizeForNative(
      buildFileName(task.fileName, task.extension, uniqueSuffix),
    );
    const offsetBytes = task.receivedBytes || 0;
    const totalBytes = task.totalBytes || 0;
    logger.debug("Manager resume: calling adapter.resumeDownload", {
      offsetBytes,
      fileName,
    });

    try {
      const tracker = new SpeedTracker();
      this.speedTrackers.set(taskId, tracker);
      this.liveReceived.set(taskId, offsetBytes);
      this.liveTotal.set(taskId, totalBytes);

      let lastDbWrite = 0;
      let lastEmit = 0;

      // ── FIX: Capture the real DownloadInstance from adapter.resumeDownload
      // which has proper pause/cancel methods (markTaskDead + NativeDownloadBridge.cancel + deleteFile).
      const realInstance = await this.adapter.resumeDownload(
        taskId,
        task.url,
        fileName,
        offsetBytes,
        {
          onProgress: (received, total) => {
            // ── Bug 2: Guard — ignore progress if task no longer active (cancelled) ──
            if (!this.activeInstances.has(taskId)) return;

            // ── FIX: received is already ABSOLUTE (offset added by adapter) ──
            // Do NOT add offsetBytes again. Do NOT clamp total < 0 to received
            // (adapter resolves this via lastKnownTotal).
            this.liveReceived.set(taskId, received);
            if (total > 0) this.liveTotal.set(taskId, total);
            tracker.update(received);

            const now = Date.now();
            if (now - lastEmit >= PROGRESS_EMIT_INTERVAL) {
              lastEmit = now;
              this.emitProgress({
                taskId,
                receivedBytes: received,
                totalBytes:
                  total > 0 ? total : (this.liveTotal.get(taskId) ?? 0),
                speed: tracker.getSpeed(),
                eta: tracker.getEta(
                  Math.max(0, (this.liveTotal.get(taskId) ?? total) - received),
                ),
              });
            }
            if (now - lastDbWrite >= DB_WRITE_INTERVAL) {
              lastDbWrite = now;
              DownloadDatabase.update({
                id: taskId,
                receivedBytes: received,
                totalBytes: total > 0 ? total : undefined,
                updatedAt: now,
              }).catch(() => {});
            }
          },
          onDone: (filePath) => this.handleNativeDone(taskId, filePath),
          onError: (error) => this.handleNativeError(task, error),
        },
      );

      // ── Register the real DownloadInstance returned by the adapter.
      // Its pause() delegates to pauseAndAwaitConfirmation() and its cancel()
      // handles markTaskDead + NativeDownloadBridge.cancel + deleteFile.
      this.activeInstances.set(taskId, realInstance);
      logger.debug(
        "Manager resume: native adapter returned instance, setting status=downloading",
      );
      await DownloadDatabase.update({
        id: taskId,
        status: "downloading",
        error: undefined,
        updatedAt: Date.now(),
      });
      // Bug F fix: include fileUri in emitStatus
      const expectedFileUri = this.adapter.getDestinationPath(fileName);
      this.emitStatus({
        taskId,
        status: "downloading",
        fileUri: expectedFileUri,
        receivedBytes: this.liveReceived.get(taskId) ?? 0,
        totalBytes: this.liveTotal.get(taskId) ?? 0,
      });
    } catch (err) {
      // Native resume failed — fall back to fresh download via queue
      logger.warn(
        "Manager resume: native failed for",
        taskId,
        "falling back to fresh download:",
        err,
      );
      await DownloadDatabase.update({
        id: taskId,
        status: "pending",
        resumeData: null,
        receivedBytes: 0,
        error: undefined,
        updatedAt: Date.now(),
      });
      this.queue.push(taskId);
      this.notifyQueue();
      this.processQueue();
    }
  }

  // ─── CANCEL (Q6 fix: mark DB FIRST, then native cancel) ────
  async cancel(taskId: string): Promise<void> {
    logger.debug("Manager cancel", taskId, {
      active: this.activeInstances.has(taskId),
    });

    // Q6 fix: Mark cancelled in DB FIRST — creates a tombstone that
    // handleNativeDone will check if a late native completion fires.
    const cancellingTask = await DownloadDatabase.getById(taskId);
    await DownloadDatabase.update({
      id: taskId,
      status: "cancelled",
      resumeData: null,
      receivedBytes: 0,
      updatedAt: Date.now(),
    });

    // Emit status immediately so UI reflects the cancellation
    this.emitStatus({
      taskId,
      status: "cancelled",
      fileUri: cancellingTask?.fileUri ?? null,
      receivedBytes: this.liveReceived.get(taskId) ?? 0,
    });

    // Cancel the native task FIRST (instance exists before cleanup)
    const instance = this.activeInstances.get(taskId);
    if (instance) {
      await instance.cancel(); // adapter's createInstance.cancel() handles markTaskDead internally
    }

    // Clean up tracking maps AFTER native cancel
    this.cleanup(taskId);

    // Delete file (try both paths)
    const task = await DownloadDatabase.getById(taskId);
    if (task) {
      if (task.fileUri) {
        deleteFile(task.fileUri);
      }
      const cancelUniqueSuffix =
        task.season != null && task.episode != null
          ? `S${String(task.season).padStart(2, "0")}E${String(task.episode).padStart(2, "0")}`
          : task.id.slice(0, 20);
      const fileName = sanitizeForNative(
        buildFileName(task.fileName, task.extension, cancelUniqueSuffix),
      );
      const filePath = this.adapter.getDestinationPath(fileName);
      if (filePath !== task.fileUri) {
        deleteFile(filePath);
      }
    }

    this.notifyQueue();
    this.processQueue();
    logger.debug("Manager cancel done", taskId);
  }

  async retry(taskId: string): Promise<void> {
    logger.debug("Manager retry", taskId);
    // Clear any stale native handle
    this.activeInstances.delete(taskId);

    await DownloadDatabase.update({
      id: taskId,
      status: "pending",
      retryCount: 0,
      error: undefined,
      resumeData: null,
      updatedAt: Date.now(),
    });

    this.queue.push(taskId);
    logger.debug("Manager retry: enqueued", { queue: this.queue.length });
    this.notifyQueue();
    this.processQueue();
  }

  async remove(taskId: string): Promise<void> {
    logger.debug("Manager remove", taskId);
    // Clean up active instance (skip cancel status — we're removing entirely)
    const instance = this.activeInstances.get(taskId);
    if (instance) {
      await instance.cancel().catch(() => {});
      this.activeInstances.delete(taskId);
    }

    this.cleanup(taskId);
    await DownloadDatabase.delete(taskId);
    this.emitStatus({ taskId, status: "cancelled", removed: true });
    this.notifyQueue();
    this.processQueue();
    logger.debug("Manager remove done", taskId);
  }

  async pauseAll(): Promise<void> {
    const downloadingTasks = await DownloadDatabase.getByStatus("downloading");
    const targets = downloadingTasks.map((t) => t.id);
    await Promise.all(targets.map((id) => this.pause(id)));
  }

  async resumeAll(): Promise<void> {
    const tasks = await DownloadDatabase.getByStatus("paused");
    for (const task of tasks) await this.resume(task.id);
  }

  async cancelAll(): Promise<void> {
    const active = await DownloadDatabase.getByStatus("downloading");
    const pending = await DownloadDatabase.getByStatus("pending");
    for (const task of [...active, ...pending]) await this.cancel(task.id);
  }

  // ─── Getters ───
  getQueueLength(): number {
    return this.queue.length;
  }
  getActiveCount(): number {
    return this.activeInstances.size;
  }
  getNetworkPolicy(): NetworkAwarePolicy {
    return this.networkPolicy;
  }
  getStorageManager(): StorageManager {
    return this.storage;
  }
  isInitialized(): boolean {
    return this.initialized;
  }

  // ═══════════════════════════════════════════════════════════
  // SUBSCRIPTIONS
  // ═══════════════════════════════════════════════════════════

  onProgress(fn: ProgressListener): () => void {
    this.progressListeners.add(fn);
    return () => this.progressListeners.delete(fn);
  }

  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  onQueueChange(fn: QueueListener): () => void {
    this.queueListeners.add(fn);
    return () => this.queueListeners.delete(fn);
  }

  // ═══════════════════════════════════════════════════════════
  // QUEUE PROCESSING (shared-promise pattern)
  // ═══════════════════════════════════════════════════════════

  /**
   * Process the queue. Concurrent calls piggyback on the in-flight promise.
   */
  private processQueue(): void {
    if (this.processQueuePromise) {
      // Already processing — the in-flight loop will pick up new items
      return;
    }

    this.processQueuePromise = this._drainQueue();
    this.processQueuePromise.finally(() => {
      this.processQueuePromise = null;
      // Check if new items arrived while we were finishing
      if (
        this.queue.length > 0 &&
        this.activeInstances.size < this.config.maxConcurrent
      ) {
        this.processQueue();
      }
    });
  }

  private async _drainQueue(): Promise<void> {
    while (
      this.queue.length > 0 &&
      this.activeInstances.size < this.config.maxConcurrent
    ) {
      if (!this.networkPolicy.canDownload()) break;

      // Yield to the event loop between starting each download
      await new Promise<void>((r) =>
        setImmediate ? setImmediate(r) : setTimeout(r, 0),
      );

      const taskId = this.queue.shift()!;

      // Skip if already active (duplicate guard)
      if (this.activeInstances.has(taskId)) continue;

      const task = await DownloadDatabase.getById(taskId).catch(() => null);
      if (!task) continue;
      if (["completed", "cancelled"].includes(task.status)) continue;

      try {
        await this.startDownload(task);
      } catch (err) {
        logger.error(
          "Manager _drainQueue: startDownload failed for",
          taskId,
          err,
        );
        await this.failTask(task, err);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // START DOWNLOAD
  // ═══════════════════════════════════════════════════════════

  private async startDownload(task: DownloadTask): Promise<void> {
    const taskId = task.id;
    logger.debug("Manager startDownload", {
      taskId,
      url: task.url?.slice(0, 60),
      fileName: task.fileName,
    });

    // Final duplicate guard
    if (this.activeInstances.has(taskId)) {
      logger.debug("Manager startDownload: already active, skipping", taskId);
      return;
    }

    // Bug B fix: use buildFileName
    // Bug 3 fix: pass uniqueSuffix to prevent file name collisions
    const uniqueSuffix =
      task.season != null && task.episode != null
        ? `S${String(task.season).padStart(2, "0")}E${String(task.episode).padStart(2, "0")}`
        : task.id.slice(0, 20);
    const fileName = sanitizeForNative(
      buildFileName(task.fileName, task.extension, uniqueSuffix),
    );
    const filePath = this.adapter.getDestinationPath(fileName);

    // Ensure download directory exists
    ensureDirectory(getNativeDownloadDir());

    // Update DB with fileUri (Bug F fix: persist fileUri at start time)
    await DownloadDatabase.update({
      id: taskId,
      status: "downloading",
      fileUri: filePath,
      startedOnWifi: this.networkPolicy.isWifi(),
      updatedAt: Date.now(),
    });

    // Initialize trackers
    const tracker = new SpeedTracker();
    this.speedTrackers.set(taskId, tracker);
    this.liveReceived.set(taskId, 0);
    this.liveTotal.set(taskId, 0);

    // Throttled writers
    let lastDbWrite = 0;
    let lastEmit = 0;

    // Start native download via adapter
    const instance = await this.adapter.download({
      url: task.url,
      filePath,
      headers: {},
      speedLimit: 0,
      externalId: taskId,

      onProgress: (received: number, total: number) => {
        // ── Bug 2: Guard — ignore progress if task no longer active (cancelled) ──
        if (!this.activeInstances.has(taskId)) return;

        // ── FIX: received is already ABSOLUTE (offset added by adapter).
        // Do NOT clamp total < 0 to received — adapter resolves via lastKnownTotal.
        this.liveReceived.set(taskId, received);
        if (total > 0) this.liveTotal.set(taskId, total);
        tracker.update(received);

        const resolvedTotal =
          total > 0 ? total : (this.liveTotal.get(taskId) ?? 0);

        const now = Date.now();
        if (now - lastEmit >= PROGRESS_EMIT_INTERVAL) {
          lastEmit = now;
          const speed = tracker.getSpeed();
          const remaining = Math.max(0, resolvedTotal - received);
          this.emitProgress({
            taskId,
            receivedBytes: received,
            totalBytes: resolvedTotal,
            speed,
            eta: tracker.getEta(remaining),
          });
        }

        if (now - lastDbWrite >= DB_WRITE_INTERVAL) {
          lastDbWrite = now;
          DownloadDatabase.update({
            id: taskId,
            receivedBytes: received,
            totalBytes: total > 0 ? total : undefined,
            updatedAt: now,
          }).catch(() => {});
        }
      },

      onDone: (finalPath: string) => {
        this.handleNativeDone(taskId, finalPath);
      },

      onError: (error: Error) => {
        this.handleNativeError(task, error);
      },
    });

    this.activeInstances.set(taskId, instance);

    // Bug F fix: include fileUri in emitStatus so the store gets the correct path
    this.emitStatus({
      taskId,
      status: "downloading",
      fileUri: filePath,
      receivedBytes: this.liveReceived.get(taskId) ?? 0,
      totalBytes: this.liveTotal.get(taskId) ?? 0,
    });
    logger.debug("Manager startDownload: status=downloading emitted", {
      taskId,
      fileUri: filePath,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // COMPLETION / ERROR HANDLERS (shared between fresh + recovered)
  // ═══════════════════════════════════════════════════════════

  /**
   * handleNativeDone — Complete rewrite for Bugs A, C, Q6.
   *
   * Bug A: Use fsCompat.getInfoAsync (never throws).
   * Bug C: Use the native filePath from the completion event (source of truth).
   * Q6:   Check DB status first — reject if cancelled/failed.
   */
  private async handleNativeDone(
    taskId: string,
    filePath: string,
  ): Promise<void> {
    logger.debug("Manager handleNativeDone", { taskId, filePath });

    try {
      // ── Q6 FIX: Check current DB status first ──
      // If the task was cancelled/removed while the native download
      // was still in-flight, reject this late completion.
      const task = await DownloadDatabase.getById(taskId);

      if (!task) {
        logger.warn(
          "Manager handleNativeDone: task not found in DB, ignoring late completion",
          taskId,
        );
        deleteFile(filePath);
        return;
      }

      if (task.status === "cancelled" || task.status === "failed") {
        logger.warn(
          "Manager handleNativeDone: task is",
          task.status,
          "ignoring late completion",
          taskId,
        );
        deleteFile(filePath);
        return;
      }

      // Normalize the native file path
      const resolvedPath = filePath.startsWith("file://")
        ? filePath
        : `file://${filePath}`;

      // ── Bug A fix: verify file using fsCompat (never throws) ──
      const info = await getInfoAsync(resolvedPath);

      if (!info.exists) {
        logger.error(
          "Manager handleNativeDone: file NOT found at native path",
          resolvedPath,
        );

        // Bug C fallback: try the adapter's calculated path as last resort
        if (task) {
          const calcUniqueSuffix =
            task.season != null && task.episode != null
              ? `S${String(task.season).padStart(2, "0")}E${String(task.episode).padStart(2, "0")}`
              : task.id.slice(0, 20);
          const calculatedName = sanitizeForNative(
            buildFileName(task.fileName, task.extension, calcUniqueSuffix),
          );
          const calculatedPath =
            this.adapter.getDestinationPath(calculatedName);

          if (calculatedPath !== resolvedPath) {
            const altInfo = await getInfoAsync(calculatedPath);
            if (altInfo.exists && altInfo.size > 0) {
              logger.debug(
                "Manager handleNativeDone: found at calculated path",
                calculatedPath,
              );
              await this.completeTask(
                taskId,
                calculatedPath,
                altInfo.size,
                task.totalBytes ?? altInfo.size,
              );
              return;
            }
          }
        }

        await this.failTask(
          task,
          `File not found after native completion: ${resolvedPath}`,
        );
        return;
      }

      // Verify file size — guard against 0-byte file
      const actualSize = info.size;
      if (actualSize === 0 && task) {
        await this.failTask(task, "Downloaded file is empty after completion");
        return;
      }

      await this.completeTask(
        taskId,
        resolvedPath,
        actualSize,
        task?.totalBytes ?? actualSize,
      );
    } catch (error) {
      logger.error("Manager handleNativeDone: unexpected error:", error);
      const task = await DownloadDatabase.getById(taskId);
      if (task) await this.failTask(task, error);
    } finally {
      this.activeInstances.delete(taskId);
      this.cleanup(taskId);
      this.notifyQueue();
      this.processQueue();
    }
  }

  /**
   * Shared completion logic. Updates DB, emits status, cleans up maps.
   */
  private async completeTask(
    taskId: string,
    filePath: string,
    fileSize: number,
    totalBytes: number,
  ): Promise<void> {
    logger.debug("Manager completeTask", { taskId, filePath, size: fileSize });

    await DownloadDatabase.update({
      id: taskId,
      status: "completed",
      fileUri: filePath,
      receivedBytes: fileSize,
      totalBytes: totalBytes > 0 ? totalBytes : fileSize,
      resumeData: null,
      updatedAt: Date.now(),
    });

    this.emitStatus({
      taskId,
      status: "completed",
      fileUri: filePath,
      receivedBytes: fileSize,
      totalBytes: totalBytes > 0 ? totalBytes : fileSize,
    });

    // Clean up tracking
    this.liveReceived.delete(taskId);
    this.liveTotal.delete(taskId);
    this.activeInstances.delete(taskId);

    // Process next item in queue
    this.processQueue();
  }

  private async handleNativeError(
    task: DownloadTask,
    error: Error,
  ): Promise<void> {
    logger.debug("Manager handleNativeError", {
      taskId: task.id,
      error: error.message,
      retryCount: task.retryCount,
    });
    this.activeInstances.delete(task.id);

    if (!this.config.autoRetry) {
      logger.debug(
        "Manager handleNativeError: autoRetry disabled, failing task",
      );
      await this.failTask(task, error);
      this.cleanup(task.id);
      this.notifyQueue();
      this.processQueue();
      return;
    }

    const retryCount = (task.retryCount ?? 0) + 1;
    if (retryCount <= this.config.maxRetries) {
      const delay =
        RETRY_DELAYS[Math.min(retryCount - 1, RETRY_DELAYS.length - 1)];

      logger.debug("Manager handleNativeError: scheduling retry", {
        retryCount,
        maxRetries: this.config.maxRetries,
        delay,
      });
      await DownloadDatabase.update({
        id: task.id,
        status: "retrying",
        retryCount,
        error: error.message,
        updatedAt: Date.now(),
      });
      this.emitStatus({
        taskId: task.id,
        status: "retrying",
        error: error.message,
        receivedBytes: this.liveReceived.get(task.id) ?? 0,
        totalBytes: this.liveTotal.get(task.id) ?? 0,
      });

      setTimeout(() => {
        logger.debug(
          "Manager handleNativeError: retry timeout fired for",
          task.id,
        );
        this.queue.push(task.id);
        this.notifyQueue();
        this.processQueue();
      }, delay);
    } else {
      logger.debug(
        "Manager handleNativeError: max retries exceeded, failing task",
      );
      await this.failTask(task, error);
    }

    this.cleanup(task.id);
    this.notifyQueue();
    this.processQueue();
  }

  private async failTask(task: DownloadTask, err: unknown): Promise<void> {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug("Manager failTask", { taskId: task.id, error: msg });
    await DownloadDatabase.update({
      id: task.id,
      status: "failed",
      error: msg,
      updatedAt: Date.now(),
    }).catch(() => {});
    this.emitStatus({
      taskId: task.id,
      status: "failed",
      error: msg,
      receivedBytes: this.liveReceived.get(task.id) ?? 0,
      totalBytes: this.liveTotal.get(task.id) ?? 0,
    });
    logger.debug("Manager failTask done", task.id);
  }

  // ═══════════════════════════════════════════════════════════
  // NETWORK PAUSE/RESUME
  // ═══════════════════════════════════════════════════════════

  private async pauseAllForNetwork(): Promise<void> {
    if (this.config.networkPolicy === "any") return;
    logger.debug(
      "Manager pauseAllForNetwork: pausing",
      this.activeInstances.size,
      "active tasks",
    );
    for (const [taskId] of this.activeInstances) {
      this.pausedForNetwork.add(taskId);
      await this.pause(taskId);
    }
    logger.debug("Manager pauseAllForNetwork done", {
      pausedForNetwork: this.pausedForNetwork.size,
    });
  }

  private async resumeNetworkPaused(): Promise<void> {
    logger.debug(
      "Manager resumeNetworkPaused: resuming",
      this.pausedForNetwork.size,
      "tasks",
    );
    for (const taskId of this.pausedForNetwork) {
      await this.resume(taskId);
    }
    this.pausedForNetwork.clear();
    logger.debug("Manager resumeNetworkPaused done");
  }

  // ═══════════════════════════════════════════════════════════
  // CLEANUP + EMITTERS
  // ═══════════════════════════════════════════════════════════

  private cleanup(taskId: string): void {
    this.activeInstances.delete(taskId);
    this.speedTrackers.delete(taskId);
    this.liveReceived.delete(taskId);
    this.liveTotal.delete(taskId);
    this.pausedForNetwork.delete(taskId);
    this.notifyQueue();
  }

  private emitProgress(p: DownloadProgress): void {
    for (const fn of this.progressListeners) fn(p);
  }

  private emitStatus(s: StatusChange): void {
    for (const fn of this.statusListeners) fn(s);
  }

  private notifyQueue(): void {
    for (const fn of this.queueListeners)
      fn(this.queue.length, this.activeInstances.size);
  }

  async destroy(): Promise<void> {
    logger.debug(
      "Manager destroy: cleaning up",
      this.activeInstances.size,
      "active instances, queue=",
      this.queue.length,
    );
    for (const [, instance] of this.activeInstances) {
      await instance.cancel().catch(() => {});
    }
    this.activeInstances.clear();
    this.queue = [];
    this.networkPolicy.destroy();
    await this.adapter.destroy();
    logger.debug("Manager destroy done");
  }
}
