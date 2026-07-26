/**
 * Download Engine — react-native-blob-util based with proper state management.
 *
 * Uses react-native-blob-util for native downloads with:
 * - True progress tracking via .progress() callback (no setTimeout(0) glitches)
 * - Cancel support via .task.cancel() — pause saves byte offset for Range-based resume
 * - Large file handling via fileCache
 * - State tracking with `starting` Set (prevents duplicate starts)
 *   and `finished` Set (prevents "No active download" on just-completed tasks)
 *
 * Pause/Resume strategy:
 *   Pause → cancel the fetch task, save receivedBytes as resumeData
 *   Resume → add Range: bytes={offset}- header, download remaining bytes
 *            to a temp file, then append temp to original via stream to
 *            avoid loading the entire file into memory
 */

// Lazy-load RNFB to avoid crash if native module not ready at bundle time
let ReactNativeBlobUtil: any = null;
try {
  ReactNativeBlobUtil = require("react-native-blob-util").default;
} catch (e) {
  console.warn("[Engine] react-native-blob-util not available:", e);
}

import type {
  DownloadTask,
  DownloadStatus,
  DownloadProgress,
  StatusChange,
  Unsubscribe,
} from "./types";

// ── Constants ──

function getDownloadDir(): string {
  if (!ReactNativeBlobUtil)
    throw new Error("react-native-blob-util not available");
  const baseDir =
    ReactNativeBlobUtil.fs.dirs.DownloadDir ||
    ReactNativeBlobUtil.fs.dirs.DocumentDir ||
    ReactNativeBlobUtil.fs.dirs.CacheDir;
  return `${baseDir}/Filmsnaps/`;
}

const MIN_VALID_FILE_SIZE = 10_240;
const PROGRESS_THROTTLE = 100; // ms between progress emissions

// ── Interface ──

export interface IDownloadEngine {
  start(task: DownloadTask): Promise<void>;
  pause(taskId: string): Promise<string | null>;
  cancel(taskId: string): Promise<string | null>;
  remove(taskId: string, fileUri: string | null): Promise<void>;
  onProgress(cb: (p: DownloadProgress) => void): Unsubscribe;
  onStatus(cb: (s: StatusChange) => void): Unsubscribe;
  getActiveCount(): number;
  /** True if task has an active fetch (can be paused/cancelled) */
  hasActive(taskId: string): boolean;
  destroy(): Promise<void>;
}

// ── Internal download state ──

interface DownloadState {
  /** The StatefulPromise from RNFB.fetch */
  promise: ReturnType<typeof ReactNativeBlobUtil.config>["fetch"] extends (
    ...args: any[]
  ) => infer R
    ? R
    : any;
  /** User-intentional cancel (pause/cancel/remove) vs real error */
  cancelled: boolean;
  /** Total bytes received so far (includes resume offset) */
  receivedBytes: number;
  /** Path of the file being written */
  filePath: string;
}

// ── Thin wrapper to access .task at runtime (missing from RNFB types) ──

function cancelFetch(promise: any): Promise<void> {
  if (promise?.task?.cancel) {
    return promise.task.cancel();
  }
  return Promise.resolve();
}

// ── Create Engine ──

export function createDownloadEngine(): IDownloadEngine {
  // Active download states — only while download is in progress
  const states = new Map<string, DownloadState>();

  // Set of task IDs that have started — checked SYNCHRONOUSLY before any await
  const starting = new Set<string>();

  // Set of task IDs that have finished (completed/failed/paused) — prevents
  // "No active download" when user clicks pause on a just-finished task
  const finished = new Set<string>();

  // Resolved file URIs (set on completion)
  const fileUris = new Map<string, string>();

  const progressListeners = new Set<(p: DownloadProgress) => void>();
  const statusListeners = new Set<(s: StatusChange) => void>();

  function emitProgress(
    taskId: string,
    receivedBytes: number,
    totalBytes: number,
  ) {
    const event: DownloadProgress = { taskId, receivedBytes, totalBytes };
    for (const cb of progressListeners) {
      try {
        cb(event);
      } catch {}
    }
  }

  function emitStatus(
    taskId: string,
    status: DownloadStatus,
    error?: string,
    resumeData?: string | null,
  ) {
    const event: StatusChange = { taskId, status, error, resumeData };
    for (const cb of statusListeners) {
      try {
        cb(event);
      } catch {}
    }
  }

  /** Clean up all in-memory tracking for a task */
  function cleanup(taskId: string) {
    states.delete(taskId);
    starting.delete(taskId);
    // NOTE: Not clearing finished here — that's only cleared by cancel/remove
  }

  async function ensureDir(): Promise<void> {
    if (!ReactNativeBlobUtil) return;
    const dir = getDownloadDir();
    const exists = await ReactNativeBlobUtil.fs.exists(dir);
    if (!exists) {
      await ReactNativeBlobUtil.fs.mkdir(dir);
    }
  }

  function buildFileUri(task: DownloadTask): string {
    const dir = getDownloadDir();
    const parts = task.fileName.split(".");
    const ext = task.extension || (parts.length > 1 ? parts.pop()! : "mp4");
    const baseName = parts.join(".");
    const safeName = baseName.replace(/[<>:"/\\|?*]/g, "_");
    if (!safeName.endsWith(`.${ext}`)) {
      return `${dir}${safeName}.${ext}`;
    }
    return `${dir}${safeName}`;
  }

  /**
   * Append one file to another using streaming reads/writes so we don't
   * load the entire file into memory. Used for resume: the temp file
   * (remaining bytes) is appended to the original partial file.
   */
  async function appendFileStream(
    sourcePath: string,
    targetPath: string,
  ): Promise<void> {
    const readStream = await ReactNativeBlobUtil.fs.readStream(
      sourcePath,
      "base64",
      1024 * 256, // 256KB chunks
    );
    const writeStream = await ReactNativeBlobUtil.fs.writeStream(
      targetPath,
      "base64",
      true, // append mode
    );

    return new Promise<void>((resolve, reject) => {
      let writeError: Error | null = null;
      let done = false;

      readStream.onData((chunk: string | number[]) => {
        if (done) return;
        try {
          if (typeof chunk === "string") {
            writeStream.write(chunk);
          } else {
            // number[] — convert to string (only used with non-base64 encodings)
            writeStream.write(String.fromCharCode(...chunk));
          }
        } catch (err: any) {
          writeError = err;
          done = true;
        }
      });

      readStream.onEnd(() => {
        done = true;
        writeStream
          .close()
          .catch(() => {})
          .then(resolve)
          .catch(resolve);
      });

      readStream.onError((err: any) => {
        done = true;
        writeError = writeError || err;
        writeStream
          .close()
          .catch(() => {})
          .then(() => reject(writeError))
          .catch(() => reject(writeError));
      });

      readStream.open();
    });
  }

  return {
    async start(task: DownloadTask): Promise<void> {
      // ── Synchronous guard — no await before this check ──
      if (starting.has(task.id)) {
        console.log(`[Engine] Already starting ${task.id}, skipping`);
        return;
      }
      starting.add(task.id);
      // Remove from finished if re-starting a paused/failed task
      finished.delete(task.id);

      try {
        await ensureDir();
      } catch (err: any) {
        starting.delete(task.id);
        emitStatus(
          task.id,
          "failed",
          `Failed to create directory: ${err?.message}`,
        );
        return;
      }

      const fileUri = buildFileUri(task);
      fileUris.set(task.id, fileUri);

      console.log(
        `[Engine] Starting: id=${task.id} resume=${!!task.resumeData}`,
      );

      let lastThrottleTime = 0;
      let resumeOffset = 0;

      // ── Build headers ──
      const headers: Record<string, string> = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      };

      // Parse resume data — if it's a positive number, use as byte offset
      if (task.resumeData) {
        const parsed = parseInt(task.resumeData, 10);
        if (!isNaN(parsed) && parsed > 0) {
          resumeOffset = parsed;
          headers["Range"] = `bytes=${resumeOffset}-`;
        }
      }

      const isResume = resumeOffset > 0;

      // If resuming, download to a temp file then append to original
      const downloadPath = isResume ? `${fileUri}.resume` : fileUri;

      // ── Start the download ──
      console.log(
        `[Engine] fetch: id=${task.id} resumeOffset=${resumeOffset} path=${downloadPath}`,
      );

      // EXPERT FIX: Removed addAndroidDownloads block to prevent 1-byte stub files.
      // Changed fileCache from true to false — fileCache:true conflicts with explicit path
      // and causes RNFB to write to a temp location instead.
      const promise = ReactNativeBlobUtil.config({
        path: downloadPath,
        fileCache: false,
      }).fetch("GET", task.url, headers);

      const state: DownloadState = {
        promise,
        cancelled: false,
        receivedBytes: resumeOffset,
        filePath: downloadPath,
      };
      states.set(task.id, state);

      // ── Progress tracking — called BEFORE the promise resolves ──
      promise.progress(
        { interval: PROGRESS_THROTTLE },
        (received: number, total: number) => {
          if (state.cancelled) return;
          state.receivedBytes = resumeOffset + received;

          const now = Date.now();
          if (now - lastThrottleTime < PROGRESS_THROTTLE) return;
          lastThrottleTime = now;

          const totalBytes = total > 0 ? resumeOffset + total : 0;
          emitProgress(task.id, state.receivedBytes, totalBytes);
        },
      );

      // ── Wait for completion ──
      try {
        await promise;

        // If cancelled during the download, don't emit anything — pause()
        // or cancel() will have already emitted the status
        if (state.cancelled) {
          console.log(`[Engine] Task ${task.id} was cancelled during download`);
          return;
        }

        // EXPERT FIX: Validate HTTP status. A 403/404 HTML page is not a valid video file.
        const respInfo = promise.respInfo;
        if (respInfo?.status && respInfo.status >= 400) {
          cleanup(task.id);
          finished.add(task.id);
          emitStatus(
            task.id,
            "failed",
            `Server returned HTTP ${respInfo.status}`,
          );
          return;
        }

        let finalPath = downloadPath;

        // EXPERT FIX: Handle path mismatch — RNFB may write to cache even with fileCache:false
        try {
          const actualPath = promise.path();
          if (actualPath && actualPath !== downloadPath) {
            console.log(
              `[Engine] Path mismatch: ${actualPath} !== ${downloadPath}, copying...`,
            );
            await ReactNativeBlobUtil.fs.cp(actualPath, downloadPath);
            try {
              await ReactNativeBlobUtil.fs.unlink(actualPath);
            } catch {}
          }
        } catch (pathErr) {
          console.warn(
            `[Engine] Path resolution error for ${task.id}:`,
            pathErr,
          );
        }

        // ── If this was a resumed download, append temp to original ──
        if (isResume) {
          // Check that original file exists before appending
          const origExists = await ReactNativeBlobUtil.fs.exists(fileUri);
          if (origExists) {
            try {
              await appendFileStream(downloadPath, fileUri);
              // Clean up temp file
              try {
                // Verify temp file is gone
                if (await ReactNativeBlobUtil.fs.exists(downloadPath)) {
                  await ReactNativeBlobUtil.fs.unlink(downloadPath);
                }
              } catch {}
              finalPath = fileUri;
            } catch (appendErr: any) {
              console.warn(
                `[Engine] Resume append failed for ${task.id}:`,
                appendErr,
              );
              // If append fails but the temp file has data, use it as-is
              const tempExists =
                await ReactNativeBlobUtil.fs.exists(downloadPath);
              if (tempExists) {
                finalPath = downloadPath;
              } else {
                throw new Error(
                  `Resume failed: ${appendErr?.message || "append error"}`,
                );
              }
            }
          } else {
            // Original file gone — just use the temp file (data from offset onwards)
            console.warn(
              `[Engine] Original file missing for resume ${task.id}, using partial`,
            );
            finalPath = downloadPath;
          }
        }

        // ── Validate file ──
        const stat = await ReactNativeBlobUtil.fs.stat(finalPath);
        if (stat.size < MIN_VALID_FILE_SIZE) {
          try {
            await ReactNativeBlobUtil.fs.unlink(finalPath);
          } catch {}
          cleanup(task.id);
          finished.add(task.id);
          emitStatus(
            task.id,
            "failed",
            "Server returned invalid response (server may be down)",
          );
          return;
        }

        fileUris.set(task.id, finalPath);
        emitProgress(task.id, stat.size, stat.size);
        cleanup(task.id);
        finished.add(task.id);
        emitStatus(task.id, "completed");
      } catch (err: any) {
        cleanup(task.id);

        // Check if the cancellation was intentional
        if (state.cancelled) {
          // Was paused or cancelled — the pause()/cancel() method handles status emission
          console.log(
            `[Engine] Task ${task.id} cancelled (intentional), no error emission`,
          );
          return;
        }

        // Check if there was a real network/protocol error
        finished.add(task.id);
        emitStatus(task.id, "failed", err?.message || "Download failed");
      }
    },

    async pause(taskId: string): Promise<string | null> {
      // If task already finished, emit paused without real pause
      if (finished.has(taskId)) {
        console.log(`[Engine] Task ${taskId} already finished, marking paused`);
        emitStatus(taskId, "paused");
        return null;
      }

      const state = states.get(taskId);
      if (!state) {
        console.log(`[Engine] No active download for ${taskId}`);
        emitStatus(taskId, "paused");
        return null;
      }

      // Mark as intentional cancel — prevents the catch() from emitting 'failed'
      state.cancelled = true;
      const offset = state.receivedBytes;

      try {
        await cancelFetch(state.promise);
      } catch (err) {
        console.warn(`[Engine] Cancel on pause failed for ${taskId}:`, err);
      }

      cleanup(taskId);
      finished.add(taskId);

      // Emit paused with byte offset as resumeData
      emitStatus(taskId, "paused", undefined, String(offset));
      return String(offset);
    },

    async cancel(taskId: string): Promise<string | null> {
      finished.delete(taskId);

      const state = states.get(taskId);
      if (state) {
        state.cancelled = true;
        try {
          await cancelFetch(state.promise);
        } catch {}
      }

      cleanup(taskId);
      emitStatus(taskId, "cancelled");

      // Delete any partial / completed file
      const fileUri = fileUris.get(taskId);
      if (fileUri) {
        try {
          if (await ReactNativeBlobUtil.fs.exists(fileUri)) {
            await ReactNativeBlobUtil.fs.unlink(fileUri);
          }
        } catch {}
        fileUris.delete(taskId);
      }

      return fileUri ?? null;
    },

    async remove(taskId: string, fileUri: string | null): Promise<void> {
      finished.delete(taskId);

      const state = states.get(taskId);
      if (state) {
        state.cancelled = true;
        try {
          await cancelFetch(state.promise);
        } catch {}
      }

      cleanup(taskId);

      const uri = fileUri || fileUris.get(taskId);
      if (uri) {
        try {
          if (await ReactNativeBlobUtil.fs.exists(uri)) {
            await ReactNativeBlobUtil.fs.unlink(uri);
          }
        } catch {}
        fileUris.delete(taskId);
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

    getActiveCount(): number {
      return states.size;
    },

    hasActive(taskId: string): boolean {
      return states.has(taskId);
    },

    async destroy(): Promise<void> {
      for (const [, state] of states) {
        state.cancelled = true;
        try {
          await cancelFetch(state.promise);
        } catch {}
      }
      states.clear();
      starting.clear();
      finished.clear();
      fileUris.clear();
      progressListeners.clear();
      statusListeners.clear();
    },
  };
}
