/**
 * Download Manager — Core service orchestrating downloads.
 *
 * Manages the download lifecycle: queue, priority, retry, speed limiting.
 * Communicates with the adapter for actual downloads and the database for persistence.
 * Tracks download speed and estimated remaining time in real time.
 *
 * Changes from original:
 * - Uses react-native-blob-util DownloadDir instead of expo-file-system documentDirectory
 * - Adds speed tracking (bytes/sec from progress deltas)
 * - Adds error categorization
 * - Supports resume via Range header through adapter headers
 * - LIVE byte counters for atomic pause (no stale DB read)
 * - sanitizeResumeData() to prevent corrupted values
 */

import { DownloadDatabase } from "./database";
import { DownloadNotifications } from "./notifications";
import type { IDownloaderAdapter, DownloadInstance } from "./adapter";
import type {
  DownloadTask,
  DownloadStatus,
  DownloadProgress,
  StatusChange,
  Unsubscribe,
} from "./types";

// ── Lazy-loaded BackgroundService (react-native-background-actions) ──
let BackgroundService: any = null;
try {
  BackgroundService = require("react-native-background-actions").default;
} catch (e) {}

let _RNFB: any = null;
function getRNFB(): any {
  if (_RNFB) return _RNFB;
  try {
    _RNFB = require("react-native-blob-util").default;
  } catch (e) {
    console.warn("[Manager] react-native-blob-util not available:", e);
  }
  return _RNFB;
}

// ── Constants ──

const MAX_CONCURRENT = 3;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [5000, 15000, 60000];
const SPEED_SAMPLE_WINDOW = 5000;
const FOREGROUND_SERVICE_CHECK_INTERVAL = 2000;

// ── Error Categories ──

// ═══════════════════════════════════════════════════════════════
// SerialQueue — per-task ordered write queue.
// Guarantees DB writes for the same task never interleave,
// preventing lost-update races for pause/resume/progress writes.
// ═══════════════════════════════════════════════════════════════
class SerialQueue {
  private chains = new Map<string, Promise<void>>();
  enqueue(taskId: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(taskId) ?? Promise.resolve();
    const next = prev.then(fn, fn); // `fn, fn` = reject handler re-runs on error
    this.chains.set(
      taskId,
      next.catch(() => {}),
    );
    return next;
  }
}

/**
 * CRITICAL: Coerce a raw value to a safe number.
 * RNFB on Android passes bridge values as strings — without coercion,
 * `+` concatenates and `<` does lexicographic comparison.
 */
function toSafeNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

export enum DownloadErrorCode {
  NETWORK_ERROR = "NETWORK_ERROR",
  STORAGE_FULL = "STORAGE_FULL",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  INVALID_URL = "INVALID_URL",
  SERVER_ERROR = "SERVER_ERROR",
  FILE_CORRUPTED = "FILE_CORRUPTED",
  TIMEOUT = "TIMEOUT",
  UNKNOWN = "UNKNOWN",
}

export interface DownloadError {
  code: DownloadErrorCode;
  message: string;
  retryable: boolean;
}

export function categorizeError(err: any): DownloadError {
  const msg = (
    err?.message ||
    err?.toString() ||
    "Unknown error"
  ).toLowerCase();

  if (
    msg.includes("storage") ||
    msg.includes("disk") ||
    msg.includes("space") ||
    msg.includes("enospc")
  ) {
    return {
      code: DownloadErrorCode.STORAGE_FULL,
      message: "Storage is full",
      retryable: false,
    };
  }
  if (
    msg.includes("permission") ||
    msg.includes("denied") ||
    msg.includes("access")
  ) {
    return {
      code: DownloadErrorCode.PERMISSION_DENIED,
      message: "Permission denied",
      retryable: false,
    };
  }
  if (
    msg.includes("invalid url") ||
    msg.includes("malformed") ||
    msg.includes("bad url")
  ) {
    return {
      code: DownloadErrorCode.INVALID_URL,
      message: "Invalid URL",
      retryable: false,
    };
  }
  if (
    msg.includes("corrupt") ||
    msg.includes("integrity") ||
    msg.includes("checksum")
  ) {
    return {
      code: DownloadErrorCode.FILE_CORRUPTED,
      message: "File corrupted",
      retryable: false,
    };
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return {
      code: DownloadErrorCode.TIMEOUT,
      message: "Request timed out",
      retryable: true,
    };
  }
  if (
    msg.includes("network") ||
    msg.includes("dns") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound")
  ) {
    return {
      code: DownloadErrorCode.NETWORK_ERROR,
      message: "Network error",
      retryable: true,
    };
  }
  if (
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("server")
  ) {
    return {
      code: DownloadErrorCode.SERVER_ERROR,
      message: "Server error",
      retryable: true,
    };
  }

  return {
    code: DownloadErrorCode.UNKNOWN,
    message: err?.message || "Unknown error",
    retryable: true,
  };
}

// ── Speed / ETA Tracking ──

interface SpeedSample {
  time: number;
  receivedBytes: number;
}

interface SpeedTracker {
  samples: SpeedSample[];
  currentSpeed: number;
  eta: number;
  /** EMA-smoothed speed (bytes/sec) */
  smoothedSpeed: number;
}

function createSpeedTracker(): SpeedTracker {
  return { samples: [], currentSpeed: 0, eta: 0, smoothedSpeed: 0 };
}

/** EMA alpha constant (0.3 = smooths jitter, reacts within ~3 samples) */
const SPEED_EMA_ALPHA = 0.3;
/** Minimum samples (15s of data) before showing ETA */
const ETA_MIN_SAMPLES = 3;

function updateSpeed(
  tracker: SpeedTracker,
  receivedBytes: number,
  totalBytes: number,
): { speed: number; eta: number } {
  const now = Date.now();
  tracker.samples.push({ time: now, receivedBytes });

  const cutoff = now - SPEED_SAMPLE_WINDOW;
  tracker.samples = tracker.samples.filter((s) => s.time >= cutoff);

  if (tracker.samples.length < 2) {
    return { speed: 0, eta: 0 };
  }

  const first = tracker.samples[0];
  const last = tracker.samples[tracker.samples.length - 1];
  const timeDelta = (last.time - first.time) / 1000;
  const byteDelta = last.receivedBytes - first.receivedBytes;

  if (timeDelta <= 0 || byteDelta <= 0) {
    return { speed: tracker.smoothedSpeed, eta: tracker.eta };
  }

  const rawSpeed = byteDelta / timeDelta;
  tracker.currentSpeed = rawSpeed;

  // EMA smoothing
  if (tracker.smoothedSpeed === 0) {
    tracker.smoothedSpeed = rawSpeed;
  } else {
    tracker.smoothedSpeed =
      SPEED_EMA_ALPHA * rawSpeed +
      (1 - SPEED_EMA_ALPHA) * tracker.smoothedSpeed;
  }

  const speed = tracker.smoothedSpeed;

  if (
    speed > 0 &&
    totalBytes > 0 &&
    tracker.samples.length >= ETA_MIN_SAMPLES
  ) {
    const remaining = totalBytes - receivedBytes;
    const etaSec = remaining / speed;
    // Round generously: <1m, ~2m, ~10m, >1h
    tracker.eta =
      etaSec < 60
        ? Math.round(etaSec / 10) * 10 + 10
        : etaSec < 600
          ? Math.round(etaSec / 30) * 30
          : etaSec < 3600
            ? Math.round(etaSec / 60) * 60
            : Math.round(etaSec / 300) * 300;
  } else {
    tracker.eta = 0;
  }

  return { speed, eta: tracker.eta };
}

/**
 * FIX: Validate and normalize resumeData to prevent corrupted values.
 * Always returns a clean numeric string or null.
 */
function sanitizeResumeData(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  // Coerce to string first (handles number, string, etc.)
  const str = String(value);
  // Must be purely numeric (no concatenation artifacts, no decimals, no negatives)
  if (!/^\d+$/.test(str)) return null;
  const num = parseInt(str, 10);
  if (isNaN(num) || num <= 0) return null;
  // Sanity check: no file should be > 50GB
  if (num > 50 * 1024 * 1024 * 1024) return null;
  return String(num);
}

// ── Download Manager Config ──

export interface DownloadManagerConfig {
  maxConcurrent?: number;
  maxRetries?: number;
  enableNotifications?: boolean;
}

// ── Download Manager ──

export class DownloadManager {
  private adapter: IDownloaderAdapter;
  private activeInstances = new Map<string, DownloadInstance>();
  private activeTasks = new Map<string, DownloadTask>();
  private activeSpeedTrackers = new Map<string, SpeedTracker>();
  /**
   * FIX: Live byte counters — updated synchronously on every progress tick.
   * pause() reads from here instead of stale DB.
   */
  private liveReceivedBytes = new Map<string, number>();
  private liveTotalBytes = new Map<string, number>();

  private queue: string[] = [];
  /**
   * FIX: Per-task pause mutex. Prevents concurrent pause() calls from racing.
   * A taskId is added when pause starts and removed when it completes.
   */
  private pausingTasks = new Set<string>();
  private config: Required<DownloadManagerConfig>;
  private progressListeners = new Set<
    (p: DownloadProgress & { speed?: number; eta?: number }) => void
  >();
  private statusListeners = new Set<(s: StatusChange) => void>();
  private queueListeners = new Set<() => void>();
  private notificationsEnabled: boolean;
  private processingQueue = false;
  private fsIconFailure = false;
  /** Per-task serial DB write queue */
  private dbQueue = new SerialQueue();

  constructor(adapter: IDownloaderAdapter, config?: DownloadManagerConfig) {
    this.adapter = adapter;
    this.config = {
      maxConcurrent: config?.maxConcurrent ?? MAX_CONCURRENT,
      maxRetries: config?.maxRetries ?? MAX_RETRIES,
      enableNotifications: config?.enableNotifications ?? false,
    };
    this.notificationsEnabled = config?.enableNotifications ?? false;
  }

  get maxConcurrent(): number {
    return this.config.maxConcurrent;
  }
  get activeCount(): number {
    return this.activeInstances.size;
  }
  get queuedCount(): number {
    return this.queue.length;
  }

  async initialize(): Promise<void> {
    const recovered = await DownloadDatabase.recoverStaleTasks();
    if (recovered > 0) {
      console.log(`[Manager] Recovered ${recovered} stale tasks`);
    }
  }

  // ─── ADD ───
  async add(task: DownloadTask): Promise<string> {
    const existing = await DownloadDatabase.getByMediaId(task.tmdbId ?? "");
    const duplicate = existing.find(
      (t) =>
        t.url === task.url &&
        t.status !== "completed" &&
        t.status !== "cancelled",
    );
    if (duplicate) {
      console.log(`[Manager] Duplicate download: ${duplicate.id}`);
      return duplicate.id;
    }

    await DownloadDatabase.insert(task);

    if (!this.queue.includes(task.id)) {
      this.queue.push(task.id);
    }
    this.notifyQueue();

    if (this.notificationsEnabled) {
      DownloadNotifications.showStarted(task.title || "Download").catch(
        () => {},
      );
    }

    this.processQueue();

    return task.id;
  }

  // ─── PAUSE (FAST — NO FILE MERGE) ───
  async pause(taskId: string): Promise<void> {
    // Mutex: only one pause per task at a time
    if (this.pausingTasks.has(taskId)) {
      console.log(`[PAUSE] Already pausing ${taskId} — skipping`);
      return;
    }
    this.pausingTasks.add(taskId);

    try {
      const instance = this.activeInstances.get(taskId);

      // Coerce EVERYTHING — RNFB bridge values arrive as strings on Android
      const liveReceived = toSafeNumber(this.liveReceivedBytes.get(taskId), 0);
      const liveTotal = toSafeNumber(this.liveTotalBytes.get(taskId), 0);
      // Capture task BEFORE deletion — needed by statDownloadedBytes
      const pausingTask = this.activeTasks.get(taskId);

      // Step 1: Stop the native download
      if (instance) {
        try {
          await instance.pause();
        } catch {}
        this.activeInstances.delete(taskId);
        this.activeTasks.delete(taskId);
        this.activeSpeedTrackers.delete(taskId);
      }

      // Step 2: Source of truth = bytes physically on disk (what Range resumes from).
      // Never sum live + disk — the in-memory counter can run ahead of flushed bytes.
      // Fall back to live counter only if stat fails.
      const onDisk = pausingTask
        ? await this.statDownloadedBytes(pausingTask)
        : 0;
      const resumeBytes = onDisk > 0 ? onDisk : liveReceived;
      const resumeData = sanitizeResumeData(resumeBytes);

      console.log(
        `[PAUSE] taskId=${taskId}, liveReceived=${liveReceived} (${typeof liveReceived}), diskBytes=${onDisk}, resumeBytes=${resumeBytes}, resumeData=${resumeData}`,
      );

      // Step 3: Save state via serial queue (prevents lost-update races)
      await this.dbQueue.enqueue(taskId, () =>
        DownloadDatabase.update({
          id: taskId,
          status: "paused",
          receivedBytes: resumeBytes,
          totalBytes: liveTotal,
          resumeData,
        }),
      );

      // Step 4: Emit status (triggers React re-render)
      this.emitStatus(taskId, "paused", undefined, resumeData);

      // Step 5: Clean up live trackers
      this.liveReceivedBytes.delete(taskId);
      this.liveTotalBytes.delete(taskId);

      this.queue = this.queue.filter((id) => id !== taskId);
      this.notifyQueue();
      this.processQueue();

      // ═══════════════════════════════════════════════════════════════
      // NO FILE MERGE HERE. The .resume file stays on disk.
      // Merge happens lazily in startDownload() when the user resumes.
      // This keeps pause() under 100ms.
      // ═══════════════════════════════════════════════════════════════
    } finally {
      this.pausingTasks.delete(taskId);
    }
  }

  // ─── RESUME (FAST — NO FILE MERGE) ───
  async resume(taskId: string): Promise<void> {
    const task = await DownloadDatabase.getById(taskId);
    if (!task) {
      console.warn(`[RESUME] Task ${taskId} not found`);
      return;
    }

    if (
      task.status !== "paused" &&
      task.status !== "failed" &&
      task.status !== "retrying"
    ) {
      console.warn(
        `[RESUME] Task ${taskId} status='${task.status}', cannot resume`,
      );
      return;
    }

    // Sanitize resumeData
    let validatedResumeData = sanitizeResumeData(task.resumeData);

    if (validatedResumeData) {
      const resumeOffset = parseInt(validatedResumeData, 10);
      const filePath = this.buildFilePath(task);

      try {
        const rnfb = getRNFB();
        if (rnfb) {
          // Validate: sum of original + .resume must be >= resumeOffset
          let totalOnDisk = 0;

          const origExists = await rnfb.fs.exists(filePath);
          if (origExists) {
            const origStat = await rnfb.fs.stat(filePath);
            totalOnDisk += Number(origStat.size) || 0;
          }

          const resumePath = `${filePath}.resume`;
          const resumeExists = await rnfb.fs.exists(resumePath);
          if (resumeExists) {
            const resumeStat = await rnfb.fs.stat(resumePath);
            totalOnDisk += Number(resumeStat.size) || 0;
          }

          if (totalOnDisk === 0) {
            console.warn(`[RESUME] No files on disk for ${taskId}, resetting`);
            validatedResumeData = null;
          } else if (totalOnDisk < resumeOffset) {
            console.warn(
              `[RESUME] Disk ${totalOnDisk} < resumeOffset ${resumeOffset}, resetting`,
            );
            validatedResumeData = null;
          } else if (totalOnDisk > resumeOffset) {
            // Disk has more data than resumeData indicates — use actual disk size
            console.log(
              `[RESUME] Disk ${totalOnDisk} > resumeOffset ${resumeOffset}, using disk size`,
            );
            validatedResumeData = String(totalOnDisk);
          }
          // If equal, use as-is
        }
      } catch (e) {
        console.warn(`[RESUME] Validation error:`, e);
        validatedResumeData = null;
      }
    }

    console.log(
      `[RESUME] taskId=${taskId}, validatedResumeData=${validatedResumeData}`,
    );

    await this.dbQueue.enqueue(taskId, () =>
      DownloadDatabase.update({
        id: taskId,
        status: "pending",
        error: undefined,
        resumeData: validatedResumeData,
        ...(validatedResumeData === null
          ? { receivedBytes: 0, totalBytes: 0 }
          : {}),
      }),
    );

    if (!this.queue.includes(taskId)) {
      this.queue.push(taskId);
    }
    this.notifyQueue();
    this.processQueue();
  }

  // ─── CANCEL ───
  async cancel(taskId: string): Promise<void> {
    const instance = this.activeInstances.get(taskId);
    if (instance) {
      try {
        await instance.cancel();
      } catch {}
      this.activeInstances.delete(taskId);
      this.activeTasks.delete(taskId);
      this.activeSpeedTrackers.delete(taskId);
    }
    this.liveReceivedBytes.delete(taskId);
    this.liveTotalBytes.delete(taskId);

    const task = await DownloadDatabase.getById(taskId);
    if (task?.fileUri) {
      try {
        const rnfb = getRNFB();
        if (rnfb && (await rnfb.fs.exists(task.fileUri))) {
          await rnfb.fs.unlink(task.fileUri);
        }
      } catch {}
    }
    if (task?.resumeData) {
      const tempPath = task.fileUri ? `${task.fileUri}.resume` : null;
      if (tempPath) {
        try {
          const rnfb = getRNFB();
          if (rnfb && (await rnfb.fs.exists(tempPath))) {
            await rnfb.fs.unlink(tempPath);
          }
        } catch {}
      }
    }

    await this.dbQueue.enqueue(taskId, () =>
      DownloadDatabase.update({
        id: taskId,
        status: "cancelled",
        resumeData: null,
      }),
    );
    this.emitStatus(taskId, "cancelled");

    this.queue = this.queue.filter((id) => id !== taskId);
    this.notifyQueue();
    this.processQueue();
  }

  // ─── REMOVE ───
  async remove(taskId: string): Promise<void> {
    const task = await DownloadDatabase.getById(taskId);
    await this.cancel(taskId);
    await DownloadDatabase.delete(taskId);

    if (task?.fileUri) {
      try {
        const rnfb = getRNFB();
        if (rnfb && (await rnfb.fs.exists(task.fileUri))) {
          await rnfb.fs.unlink(task.fileUri);
        }
      } catch {}
    }
  }

  // ─── RETRY ───
  async retry(taskId: string): Promise<void> {
    const task = await DownloadDatabase.getById(taskId);
    if (!task) return;

    await this.dbQueue.enqueue(taskId, () =>
      DownloadDatabase.update({
        id: taskId,
        status: "pending",
        receivedBytes: 0,
        totalBytes: 0,
        error: undefined,
        retryCount: 0,
        resumeData: null,
      }),
    );

    if (!this.queue.includes(taskId)) {
      this.queue.push(taskId);
    }
    this.notifyQueue();
    this.processQueue();
  }

  // ─── GET PROGRESS ───
  async getProgress(
    taskId: string,
  ): Promise<(DownloadProgress & { speed?: number; eta?: number }) | null> {
    // FIX: Prefer live in-memory data over stale DB
    const liveReceived = this.liveReceivedBytes.get(taskId);
    const liveTotal = this.liveTotalBytes.get(taskId);
    const tracker = this.activeSpeedTrackers.get(taskId);

    if (liveReceived !== undefined && liveTotal !== undefined) {
      return {
        taskId,
        receivedBytes: liveReceived,
        totalBytes: liveTotal,
        speed: tracker?.currentSpeed ?? 0,
        eta: tracker?.eta ?? 0,
      };
    }

    const task = await DownloadDatabase.getById(taskId);
    if (!task) return null;
    return {
      taskId: task.id,
      receivedBytes: task.receivedBytes,
      totalBytes: task.totalBytes,
      speed: tracker?.currentSpeed ?? 0,
      eta: tracker?.eta ?? 0,
    };
  }

  async getAll(): Promise<DownloadTask[]> {
    return DownloadDatabase.getAll();
  }
  async getByStatus(status: DownloadStatus): Promise<DownloadTask[]> {
    return DownloadDatabase.getByStatus(status);
  }

  /** Returns the 1-indexed position of a task in the queue, or null if not queued */
  getQueuePosition(taskId: string): { position: number; total: number } | null {
    const idx = this.queue.indexOf(taskId);
    if (idx === -1) return null;
    return { position: idx + 1, total: this.queue.length };
  }

  async getStorageInfo(): Promise<{ available: number; used: number }> {
    const used = await DownloadDatabase.getStorageUsed();
    const available = await this.adapter.getAvailableStorage();
    return { available, used };
  }

  async clearCompleted(): Promise<void> {
    const completed = await DownloadDatabase.getByStatus("completed");
    for (const task of completed) {
      if (task.fileUri) {
        try {
          const rnfb = getRNFB();
          if (rnfb && (await rnfb.fs.exists(task.fileUri))) {
            await rnfb.fs.unlink(task.fileUri);
          }
        } catch {}
      }
    }
    await DownloadDatabase.deleteCompleted();
  }

  async clearCancelled(): Promise<void> {
    const cancelled = await DownloadDatabase.getByStatus("cancelled");
    for (const task of cancelled) {
      if (task.fileUri) {
        try {
          const rnfb = getRNFB();
          if (rnfb && (await rnfb.fs.exists(task.fileUri))) {
            await rnfb.fs.unlink(task.fileUri);
          }
        } catch {}
      }
    }
    await DownloadDatabase.deleteCancelled();
  }

  // ─── PROCESS QUEUE ───
  private async processQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    try {
      const hasPendingWork = this.queue.length > 0;
      const hasActiveWork = this.activeInstances.size > 0;

      if (
        (hasPendingWork || hasActiveWork) &&
        BackgroundService &&
        !BackgroundService.isRunning() &&
        !this.fsIconFailure
      ) {
        try {
          await BackgroundService.start(
            async () => {
              while (this.activeInstances.size > 0 || this.queue.length > 0) {
                await new Promise((resolve) =>
                  setTimeout(resolve, FOREGROUND_SERVICE_CHECK_INTERVAL),
                );
              }
            },
            {
              taskName: "Filmsnaps Download",
              taskTitle: "Downloading Media",
              taskDesc: "Filmsnaps is downloading your movies and shows",
              taskIcon: { name: "ic_launcher_foreground", type: "mipmap" },
              color: "#09090b",
              linkingUri: "filmsnaps://",
              progressBar: { max: 100, value: 0 },
            },
          );
        } catch (err: any) {
          if (err?.message?.includes("icon")) {
            try {
              await BackgroundService.start(
                async () => {
                  while (
                    this.activeInstances.size > 0 ||
                    this.queue.length > 0
                  ) {
                    await new Promise((resolve) =>
                      setTimeout(resolve, FOREGROUND_SERVICE_CHECK_INTERVAL),
                    );
                  }
                },
                {
                  taskName: "Filmsnaps Download",
                  taskTitle: "Downloading Media",
                  taskDesc: "Filmsnaps is downloading your movies and shows",
                  color: "#09090b",
                  linkingUri: "filmsnaps://",
                  progressBar: { max: 100, value: 0 },
                },
              );
            } catch (err2: any) {
              this.fsIconFailure = true;
            }
          }
        }
      }

      while (
        this.queue.length > 0 &&
        this.activeInstances.size < this.maxConcurrent
      ) {
        const taskId = this.queue.shift();
        if (!taskId) break;

        if (this.activeInstances.has(taskId) || this.activeTasks.has(taskId))
          continue;

        // FIX: Always re-read from DB for freshest state
        const task = await DownloadDatabase.getById(taskId);
        if (!task || task.status === "completed" || task.status === "cancelled")
          continue;

        this.activeTasks.set(taskId, task);
        await this.startDownload(task).catch((err) => {
          console.error(`[Manager] Error starting task ${taskId}:`, err);
          this.activeTasks.delete(taskId);
        });
      }
      this.notifyQueue();
    } finally {
      this.processingQueue = false;
    }
  }

  // ─── START DOWNLOAD (WITH LAZY MERGE) ───
  private async startDownload(task: DownloadTask): Promise<void> {
    const freshTask = await DownloadDatabase.getById(task.id);
    const effectiveTask = freshTask ?? task;

    await this.dbQueue.enqueue(effectiveTask.id, () =>
      DownloadDatabase.update({ id: effectiveTask.id, status: "downloading" }),
    );
    this.emitStatus(effectiveTask.id, "downloading");
    await this.ensureDownloadDir();

    const filePath = this.buildFilePath(effectiveTask);

    // Build headers
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };

    let resumeOffset = 0;
    const rawResumeData = sanitizeResumeData(effectiveTask.resumeData);
    if (rawResumeData) {
      resumeOffset = parseInt(rawResumeData, 10);
      headers["Range"] = `bytes=${resumeOffset}-`;
    }

    // ═══════════════════════════════════════════════════════════════
    // LAZY MERGE: If a .resume file exists from a previous cycle,
    // merge it into the original file NOW (before starting download).
    // Uses 4MB chunks — completes in ~100-200ms for 100MB.
    // This is acceptable here because the user just tapped "resume"
    // and expects a brief "starting download" delay.
    // ═══════════════════════════════════════════════════════════════
    if (resumeOffset > 0) {
      try {
        const rnfb = getRNFB();
        if (rnfb) {
          const resumePath = `${filePath}.resume`;
          const resumeExists = await rnfb.fs.exists(resumePath);

          if (resumeExists) {
            const resumeStat = await rnfb.fs.stat(resumePath);
            const resumeSize = Number(resumeStat.size) || 0;

            if (resumeSize > 0) {
              const origExists = await rnfb.fs.exists(filePath);
              if (origExists) {
                console.log(
                  `[START] Merging .resume (${(resumeSize / 1048576).toFixed(1)}MB) into original before download`,
                );
                await this.appendFileStreamFast(resumePath, filePath);
                try {
                  await rnfb.fs.unlink(resumePath);
                } catch {}
              } else {
                // No original — rename .resume to original
                await rnfb.fs.mv(resumePath, filePath);
              }

              // Re-read file size after merge to get accurate offset
              const mergedStat = await rnfb.fs.stat(filePath);
              const mergedSize = Number(mergedStat.size) || 0;
              if (mergedSize > resumeOffset) {
                resumeOffset = mergedSize;
                headers["Range"] = `bytes=${resumeOffset}-`;
              }
              console.log(
                `[START] Merge complete. File size: ${(mergedSize / 1048576).toFixed(1)}MB, resuming from ${resumeOffset}`,
              );
            } else {
              // Empty .resume — delete it
              try {
                await rnfb.fs.unlink(resumePath);
              } catch {}
            }
          }

          // Validate original file exists and is large enough
          const origExists = await rnfb.fs.exists(filePath);
          if (!origExists) {
            console.warn(
              `[START] Original file missing after merge, resetting`,
            );
            delete headers["Range"];
            resumeOffset = 0;
          } else {
            const origStat = await rnfb.fs.stat(filePath);
            const origSize = Number(origStat.size) || 0;
            if (origSize < resumeOffset) {
              console.warn(
                `[START] File ${origSize} < offset ${resumeOffset}, resetting`,
              );
              delete headers["Range"];
              resumeOffset = 0;
            } else if (origSize > resumeOffset) {
              resumeOffset = origSize;
              headers["Range"] = `bytes=${resumeOffset}-`;
            }
          }
        }
      } catch (e) {
        console.warn(`[START] Merge/validation error:`, e);
        delete headers["Range"];
        resumeOffset = 0;
      }
    }

    const isResume = resumeOffset > 0;
    const actualPath = isResume ? `${filePath}.resume` : filePath;

    let lastSaveTime = 0;
    let maxReceivedSeen = resumeOffset;

    const speedTracker = createSpeedTracker();
    this.activeSpeedTrackers.set(effectiveTask.id, speedTracker);
    this.liveReceivedBytes.set(effectiveTask.id, resumeOffset);
    this.liveTotalBytes.set(effectiveTask.id, effectiveTask.totalBytes || 0);

    try {
      console.log(
        `[START] File: ${effectiveTask.fileName}, Resume: ${isResume}, Offset: ${resumeOffset}, Path: ${actualPath}, speedLimit: ${effectiveTask.speedLimit ?? 0} → ${(effectiveTask.speedLimit ?? 0) > 0 ? "CHUNKED" : "full-speed"}`,
      );

      const instance = await this.adapter.download({
        url: effectiveTask.url,
        filePath: actualPath,
        headers,
        speedLimit: effectiveTask.speedLimit ?? 0,
        externalId: effectiveTask.id,
        onProgress: (rawReceived: number, rawTotal: number) => {
          const received = Number(rawReceived) || 0;
          const total = Number(rawTotal) || 0;

          const adjustedReceived = isResume
            ? resumeOffset + received
            : received;
          const adjustedTotal =
            total > 0 ? (isResume ? resumeOffset + total : total) : 0;

          if (Number(adjustedReceived) <= Number(maxReceivedSeen)) return;
          maxReceivedSeen = adjustedReceived;

          this.liveReceivedBytes.set(effectiveTask.id, maxReceivedSeen);
          if (adjustedTotal > 0) {
            this.liveTotalBytes.set(effectiveTask.id, adjustedTotal);
          }

          const { speed, eta } = updateSpeed(
            speedTracker,
            maxReceivedSeen,
            adjustedTotal,
          );
          this.emitProgress(
            effectiveTask.id,
            maxReceivedSeen,
            adjustedTotal,
            speed,
            eta,
          );

          const now = Date.now();
          if (now - lastSaveTime > 2000 || maxReceivedSeen === adjustedTotal) {
            lastSaveTime = now;
            this.dbQueue
              .enqueue(effectiveTask.id, () =>
                DownloadDatabase.update({
                  id: effectiveTask.id,
                  receivedBytes: maxReceivedSeen,
                  totalBytes: adjustedTotal,
                  resumeData: sanitizeResumeData(maxReceivedSeen),
                }),
              )
              .catch(() => {});
          }
        },
        onDone: async (finalPath: string) => {
          this.activeInstances.delete(effectiveTask.id);
          this.activeTasks.delete(effectiveTask.id);
          this.activeSpeedTrackers.delete(effectiveTask.id);
          this.liveReceivedBytes.delete(effectiveTask.id);
          this.liveTotalBytes.delete(effectiveTask.id);

          let resolvedPath = finalPath;

          // Merge .resume into original on completion
          if (isResume && filePath !== finalPath) {
            const rnfb = getRNFB();
            const origExists = rnfb && (await rnfb.fs.exists(filePath));
            if (origExists) {
              try {
                await this.appendFileStreamFast(finalPath, filePath);
                try {
                  if (rnfb) await rnfb.fs.unlink(finalPath);
                } catch {}
                resolvedPath = filePath;
              } catch (e) {
                console.warn(`[DONE] Merge failed:`, e);
                resolvedPath = finalPath;
              }
            } else {
              try {
                if (rnfb) await rnfb.fs.mv(finalPath, filePath);
                resolvedPath = filePath;
              } catch {
                resolvedPath = finalPath;
              }
            }
          }

          try {
            const rnfb = getRNFB();
            if (!rnfb) throw new Error("react-native-blob-util not available");
            const stat = await rnfb.fs.stat(resolvedPath);
            const fileSize = Number(stat.size) || 0;
            if (fileSize < 10240) {
              throw new Error(
                "Server returned invalid response (file too small)",
              );
            }
            await this.dbQueue.enqueue(effectiveTask.id, () =>
              DownloadDatabase.update({
                id: effectiveTask.id,
                status: "completed",
                fileUri: resolvedPath,
                receivedBytes: fileSize,
                totalBytes: fileSize,
                resumeData: null,
              }),
            );
            this.emitStatus(effectiveTask.id, "completed");
            if (this.notificationsEnabled) {
              DownloadNotifications.showCompleted(
                effectiveTask.title || "Download",
                resolvedPath,
              ).catch(() => {});
            }
          } catch (e: any) {
            const cat = categorizeError(e);
            await this.dbQueue.enqueue(effectiveTask.id, () =>
              DownloadDatabase.update({
                id: effectiveTask.id,
                status: "failed",
                error: cat.message,
              }),
            );
            this.emitStatus(effectiveTask.id, "failed", cat.message);
            if (this.notificationsEnabled) {
              DownloadNotifications.showFailed(
                effectiveTask.title || "Download",
                cat.message,
              ).catch(() => {});
            }
          }

          this.processQueue();
        },
        onError: async (error: Error) => {
          this.activeInstances.delete(effectiveTask.id);
          this.activeTasks.delete(effectiveTask.id);
          this.activeSpeedTrackers.delete(effectiveTask.id);
          this.liveReceivedBytes.delete(effectiveTask.id);
          this.liveTotalBytes.delete(effectiveTask.id);
          console.error(
            `[Manager] onError for ${effectiveTask.id}:`,
            error?.message || error,
          );
          await this.handleError(effectiveTask, error);
          this.processQueue();
        },
      });

      this.activeInstances.set(effectiveTask.id, instance);
      this.activeTasks.set(effectiveTask.id, effectiveTask);
    } catch (error: any) {
      this.activeInstances.delete(effectiveTask.id);
      this.activeTasks.delete(effectiveTask.id);
      this.activeSpeedTrackers.delete(effectiveTask.id);
      this.liveReceivedBytes.delete(effectiveTask.id);
      this.liveTotalBytes.delete(effectiveTask.id);
      await this.handleError(effectiveTask, error);
    }
  }

  // ── Error Handling w/ Retry ──

  private async handleError(task: DownloadTask, error: Error): Promise<void> {
    const cat = categorizeError(error);
    const retryCount = task.retryCount ?? 0;

    if (cat.retryable && retryCount < this.config.maxRetries) {
      const delay = RETRY_DELAYS[retryCount] || 60000;
      const nextRetry = retryCount + 1;

      await this.dbQueue.enqueue(task.id, () =>
        DownloadDatabase.update({
          id: task.id,
          status: "retrying",
          retryCount: nextRetry,
          error: `Retry ${nextRetry}/${this.config.maxRetries}: ${cat.message}`,
        }),
      );
      this.emitStatus(
        task.id,
        "retrying",
        `Retry ${nextRetry}/${this.config.maxRetries}: ${cat.message}`,
      );

      setTimeout(() => {
        this.resume(task.id).catch(() => {});
      }, delay);
    } else {
      await this.dbQueue.enqueue(task.id, () =>
        DownloadDatabase.update({
          id: task.id,
          status: "failed",
          error: cat.message,
        }),
      );
      this.emitStatus(task.id, "failed", cat.message);
      if (this.notificationsEnabled) {
        DownloadNotifications.showFailed(
          task.title || "Download",
          cat.message,
        ).catch(() => {});
      }
    }
  }

  // ── File Path ──

  /**
   * Stat bytes physically on disk (source of truth for resume).
   * Never adds liveReceived — the in-memory counter can run ahead of flushed data.
   */
  private async statDownloadedBytes(task: DownloadTask): Promise<number> {
    let bytes = 0;
    const rnfb = getRNFB();
    if (!rnfb) return 0;
    try {
      for (const p of [
        `${this.buildFilePath(task)}.resume`,
        this.buildFilePath(task),
      ]) {
        const exists = await rnfb.fs.exists(p);
        if (exists) {
          const stat = await rnfb.fs.stat(p);
          bytes += toSafeNumber(stat.size, 0);
        }
      }
      return bytes;
    } catch {
      return 0;
    }
  }

  private getDownloadsDir(): string {
    const rnfb = getRNFB();
    if (!rnfb) throw new Error("react-native-blob-util not available");
    const baseDir =
      rnfb.fs.dirs.DownloadDir ||
      rnfb.fs.dirs.DocumentDir ||
      rnfb.fs.dirs.CacheDir;
    return `${baseDir}/Filmsnaps`;
  }

  private buildFilePath(task: DownloadTask): string {
    const downloadsDir = this.getDownloadsDir();
    let fileName = task.fileName || "download";
    const ext = task.extension || "mp4";

    if (!fileName.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
      fileName = `${fileName}.${ext}`;
    }

    const safeName = fileName.replace(/[<>:"/\\|?*]/g, "_");
    return `${downloadsDir}/${safeName}`;
  }

  private async ensureDownloadDir(): Promise<void> {
    try {
      const downloadsDir = this.getDownloadsDir();
      const rnfb = getRNFB();
      if (rnfb) {
        const exists = await rnfb.fs.exists(downloadsDir);
        if (!exists) {
          await rnfb.fs.mkdir(downloadsDir);
        }
      }
    } catch {}
  }

  // ═══════════════════════════════════════════════════════════════
  // FAST FILE APPEND: 4MB chunks instead of 256KB.
  // Reduces bridge round-trips from ~400 to ~25 for a 100MB file.
  // ═══════════════════════════════════════════════════════════════
  private async appendFileStreamFast(
    sourcePath: string,
    targetPath: string,
  ): Promise<void> {
    const rnfb = getRNFB();
    if (!rnfb) throw new Error("react-native-blob-util not available");

    const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB per chunk

    const readStream = await rnfb.fs.readStream(
      sourcePath,
      "base64",
      CHUNK_SIZE,
    );
    const writeStream = await rnfb.fs.writeStream(targetPath, "base64", true); // append mode

    return new Promise<void>((resolve, reject) => {
      let done = false;
      let writeError: Error | null = null;

      readStream.onData((chunk: string | number[]) => {
        if (done) return;
        try {
          if (typeof chunk === "string") {
            writeStream.write(chunk);
          } else {
            // For number arrays, convert in sub-chunks to avoid stack overflow
            const subSize = 65536;
            for (let i = 0; i < chunk.length; i += subSize) {
              const sub = chunk.slice(i, i + subSize);
              writeStream.write(String.fromCharCode(...sub));
            }
          }
        } catch (err: any) {
          writeError = err;
          done = true;
        }
      });

      readStream.onEnd(() => {
        done = true;
        writeStream.close().then(resolve).catch(resolve);
      });

      readStream.onError((err: any) => {
        done = true;
        const finalErr = writeError || err;
        writeStream
          .close()
          .then(() => reject(finalErr))
          .catch(() => reject(finalErr));
      });

      readStream.open();
    });
  }

  // Keep the old method name as an alias for any other callers
  private async appendFileStream(
    sourcePath: string,
    targetPath: string,
  ): Promise<void> {
    return this.appendFileStreamFast(sourcePath, targetPath);
  }

  // ── Event System ──

  onProgress(
    cb: (p: DownloadProgress & { speed?: number; eta?: number }) => void,
  ): Unsubscribe {
    this.progressListeners.add(cb);
    return () => this.progressListeners.delete(cb);
  }

  onStatus(cb: (s: StatusChange) => void): Unsubscribe {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  onQueueChange(cb: () => void): Unsubscribe {
    this.queueListeners.add(cb);
    return () => this.queueListeners.delete(cb);
  }

  private emitProgress(
    taskId: string,
    received: number,
    total: number,
    speed?: number,
    eta?: number,
  ) {
    const event = {
      taskId,
      receivedBytes: received,
      totalBytes: total,
      speed,
      eta,
    };
    for (const cb of this.progressListeners) {
      try {
        cb(event);
      } catch {}
    }
  }

  // FIX: emitStatus now accepts resumeData
  private emitStatus(
    taskId: string,
    status: DownloadStatus,
    error?: string,
    resumeData?: string | null,
  ) {
    const event: StatusChange = { taskId, status, error, resumeData };
    for (const cb of this.statusListeners) {
      try {
        cb(event);
      } catch {}
    }
  }

  private notifyQueue() {
    for (const cb of this.queueListeners) {
      try {
        cb();
      } catch {}
    }
  }

  async destroy(): Promise<void> {
    for (const [, instance] of this.activeInstances) {
      try {
        await instance.pause();
      } catch {}
    }
    this.activeInstances.clear();
    this.activeTasks.clear();
    this.activeSpeedTrackers.clear();
    this.liveReceivedBytes.clear();
    this.liveTotalBytes.clear();
    this.queue = [];
    this.progressListeners.clear();
    this.statusListeners.clear();
    this.queueListeners.clear();

    if (BackgroundService?.isRunning()) {
      try {
        await BackgroundService.stop();
      } catch {}
    }

    await this.adapter.destroy();
  }
}
