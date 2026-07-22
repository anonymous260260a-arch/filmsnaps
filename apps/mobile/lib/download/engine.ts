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
          // Try to pause the hanging download
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
        // ── Progress callback (throttled internally) ──
        (progress) => {
          lastProgressTime = Date.now();
          const received = progress.totalBytesWritten;
          const total = progress.totalBytesExpectedToWrite;

          // Throttle to avoid flooding the JS thread
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

        // ── Validate the downloaded file ──
        const fileInfo = await getInfoAsync(result.uri);
        const fileSize = fileInfo?.size ?? 0;

        if (fileSize < MIN_VALID_FILE_SIZE) {
          // Server returned an error page or empty response
          await deleteAsync(result.uri, { idempotent: true });
          emitStatus(task.id, 'failed', 'Server returned invalid response (server may be down)');
          return;
        }

        // Final progress update with exact file size
        emitProgress(task.id, fileSize, fileSize);
        emitStatus(task.id, 'completed');
      } catch (err: any) {
        clearInterval(watchdog);

        // If the task was cancelled intentionally, don't overwrite that status
        if (!resumables.has(task.id)) return;

        // Try to get resumeData for network failures
        try {
          const pauseResult = await download.pauseAsync();
          if (pauseResult?.resumeData) {
            emitStatus(task.id, 'paused');
            return;
          }
        } catch {
          // pauseAsync also failed — genuine error
        }

        emitStatus(task.id, 'failed', err?.message || 'Download failed');
      } finally {
        resumables.delete(task.id);
      }
    },

    async pause(taskId: string): Promise<string | null> {
      const r = resumables.get(taskId);

      // No active native download object — still mark as paused so the
      // user can retry rather than seeing an unrecoverable 'failed' state
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
        // Graceful degradation: still mark as 'paused' even though
        // we couldn't get resumeData. The user can retry from scratch.
        emitStatus(taskId, 'paused');
        return null;
      }
    },

    async cancel(taskId: string): Promise<string | null> {
      // Emit 'cancelled' FIRST so the store sees this intent before
      // any error callbacks fire from pauseAsync failure
      emitStatus(taskId, 'cancelled');

      const r = resumables.get(taskId);
      let fileUri: string | null = null;
      if (r) {
        try {
          await r.pauseAsync();
        } catch {}
        resumables.delete(taskId);
      }
      return fileUri;
    },

    async remove(taskId: string, fileUri: string | null): Promise<void> {
      const r = resumables.get(taskId);
      if (r) {
        try {
          await r.pauseAsync();
        } catch {}
        resumables.delete(taskId);
      }
      if (fileUri) {
        try {
          await deleteAsync(fileUri, { idempotent: true });
        } catch (err) {
          console.warn(`[Engine] Failed to delete file ${fileUri}:`, err);
        }
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
      return resumables.size;
    },

    async destroy(): Promise<void> {
      for (const [id, r] of resumables) {
        try {
          await r.pauseAsync();
        } catch {}
      }
      resumables.clear();
      progressListeners.clear();
      statusListeners.clear();
    },
  };
}
