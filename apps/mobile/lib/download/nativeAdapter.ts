import {
  NativeDownloadBridge,
  type CompleteEvent,
  type PausedEvent,
} from "./nativeBridge";
import type { DownloadInstance } from "./adapter";
import { sanitizeForNative, buildFileName } from "./fileNameUtils";
import { getNativeDownloadDir, deleteFile } from "./fsCompat";

interface PerTaskCallbacks {
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
  onDone?: (filePath: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Fix for Bug 1 (pause stack overflow): the previous version deleted `activeCallbacks`
 * for a task BEFORE the native pause call resolved, so `manager.pause()` would resolve
 * as "done" even though the task's status never truthfully became 'paused'. That let
 * "Pause All" find the same 'downloading' task again and recurse.
 *
 * Now: pause() does not resolve until the native side has emitted a genuine
 * `onDownloadPaused` event (or an error), and callbacks are only cleared once we know
 * the terminal state. The manager also adds a per-task in-flight lock (see manager.ts)
 * as defense in depth.
 *
 * All byte values here are already absolute (see nativeBridge.ts) — no more adding
 * resume offsets in JS, which was the second half of the corrupted-offset bug.
 */
export class NativeDownloaderAdapter {
  private subscriptions: Array<{ remove: () => void }> = [];
  private globalListenersAttached = false;
  private activeCallbacks = new Map<string, PerTaskCallbacks>();
  private pauseWaiters = new Map<
    string,
    { resolve: () => void; reject: (e: Error) => void }
  >();
  private deadTasks = new Set<string>();

  constructor() {
    this.attachGlobalListeners();
  }

  private attachGlobalListeners(): void {
    if (this.globalListenersAttached) return;
    this.globalListenersAttached = true;

    this.subscriptions.push(
      NativeDownloadBridge.onProgress((e) => {
        if (this.deadTasks.has(e.taskId)) return;
        this.activeCallbacks
          .get(e.taskId)
          ?.onProgress?.(e.bytesDownloaded, e.bytesTotal);
      }),
    );

    this.subscriptions.push(
      NativeDownloadBridge.onComplete((e: CompleteEvent) => {
        if (this.deadTasks.has(e.taskId)) return;
        const cb = this.activeCallbacks.get(e.taskId);
        this.activeCallbacks.delete(e.taskId);
        cb?.onDone?.(e.filePath);
      }),
    );

    this.subscriptions.push(
      NativeDownloadBridge.onError((e) => {
        this.deadTasks.add(e.taskId);
        const cb = this.activeCallbacks.get(e.taskId);
        this.activeCallbacks.delete(e.taskId);
        const waiter = this.pauseWaiters.get(e.taskId);
        if (waiter) {
          this.pauseWaiters.delete(e.taskId);
          waiter.reject(new Error(e.error));
        }
        cb?.onError?.(new Error(e.error));
      }),
    );

    this.subscriptions.push(
      NativeDownloadBridge.onPaused((e: PausedEvent) => {
        // This is the truthful signal that the task actually stopped. Only NOW do we
        // clear the callback map — resolving pause() before this was Bug 1's root cause.
        this.activeCallbacks.delete(e.taskId);
        const waiter = this.pauseWaiters.get(e.taskId);
        if (waiter) {
          this.pauseWaiters.delete(e.taskId);
          waiter.resolve();
        }
      }),
    );
  }

  destroy(): void {
    this.subscriptions.forEach((s) => s.remove());
    this.subscriptions = [];
    this.globalListenersAttached = false;
    this.activeCallbacks.clear();
    this.pauseWaiters.clear();
    this.deadTasks.clear();
  }

  markTaskDead(taskId: string): void {
    this.deadTasks.add(taskId);
    this.activeCallbacks.delete(taskId);
    this.pauseWaiters.delete(taskId);
    setTimeout(() => this.deadTasks.delete(taskId), 30_000);
  }

  getDestinationPath(fileName: string): string {
    return `${getNativeDownloadDir()}${fileName}`;
  }

  async download(options: {
    url: string;
    filePath: string;
    headers?: Record<string, string>;
    externalId?: string;
    onProgress?: (receivedBytes: number, totalBytes: number) => void;
    onDone?: (filePath: string) => void;
    onError?: (error: Error) => void;
  }): Promise<DownloadInstance> {
    const id =
      options.externalId ??
      `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fileName = options.filePath.split("/").pop() ?? `${id}.mp4`;
    this.deadTasks.delete(id);
    this.activeCallbacks.set(id, {
      onProgress: options.onProgress,
      onDone: options.onDone,
      onError: options.onError,
    });
    await NativeDownloadBridge.start(
      id,
      options.url,
      fileName,
      options.headers,
    );
    return this.createInstance(id, fileName);
  }

  async resumeDownload(
    taskId: string,
    url: string,
    fileName: string,
    offsetBytes: number,
    options: {
      onProgress?: (receivedBytes: number, totalBytes: number) => void;
      onDone?: (filePath: string) => void;
      onError?: (error: Error) => void;
    },
  ): Promise<DownloadInstance> {
    const safeName = sanitizeForNative(buildFileName(fileName));
    this.deadTasks.delete(taskId);
    this.activeCallbacks.set(taskId, {
      onProgress: options.onProgress,
      onDone: options.onDone,
      onError: options.onError,
    });
    await NativeDownloadBridge.resume(taskId, url, safeName, offsetBytes);
    return this.createInstance(taskId, safeName);
  }

  hasActiveTask(taskId: string): boolean {
    return this.activeCallbacks.has(taskId) && !this.deadTasks.has(taskId);
  }

  supportsBackground(): boolean {
    return true;
  }

  async getAvailableStorage(): Promise<number> {
    try {
      return await NativeDownloadBridge.getAvailableStorage();
    } catch {
      return 0;
    }
  }

  /** Cold-start reconciliation: ask the (already-running) service what's active instead
   *  of assuming nothing is, which is what previously made downloads invisible until a
   *  full app restart. */
  async getActiveTaskIds(): Promise<string[]> {
    try {
      return await NativeDownloadBridge.getActiveTaskIds();
    } catch {
      return [];
    }
  }

  /** Re-attach JS callbacks to a task already running in the native ForegroundService.
   *  Unlike download() and resumeDownload(), this does NOT call start/resume on the
   *  native side — it only registers callbacks so events flowing from the already-running
   *  service reach the manager. */
  attachToRunningTask(
    taskId: string,
    callbacks: {
      onProgress?: (receivedBytes: number, totalBytes: number) => void;
      onDone?: (filePath: string) => void;
      onError?: (error: Error) => void;
    },
    fileName: string,
  ): DownloadInstance {
    this.deadTasks.delete(taskId);
    this.activeCallbacks.set(taskId, callbacks);
    return this.createInstance(taskId, fileName);
  }

  private createInstance(id: string, fileName: string): DownloadInstance {
    return {
      id,
      pause: () => this.pauseAndAwaitConfirmation(id),
      resume: async () => {},
      cancel: async () => {
        this.markTaskDead(id);
        this.pauseWaiters.delete(id);
        await NativeDownloadBridge.cancel(id).catch(() => {});
        const path = `${getNativeDownloadDir()}${this.sanitize(fileName)}`;
        deleteFile(path);
      },
    };
  }

  private pauseAndAwaitConfirmation(taskId: string): Promise<void> {
    // If there's no active callback for this task, it already isn't downloading —
    // resolve immediately instead of waiting for an event that will never come
    // (this alone prevents most re-entrant "Pause All" loops).
    if (!this.activeCallbacks.has(taskId)) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      // Only one pause can be in flight per task; a second call joins the same wait.
      if (this.pauseWaiters.has(taskId)) {
        const existing = this.pauseWaiters.get(taskId)!;
        this.pauseWaiters.set(taskId, {
          resolve: () => {
            existing.resolve();
            resolve();
          },
          reject: (e) => {
            existing.reject(e);
            reject(e);
          },
        });
        return;
      }
      this.pauseWaiters.set(taskId, { resolve, reject });
      NativeDownloadBridge.pause(taskId).catch((e) => {
        this.pauseWaiters.delete(taskId);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
      // Safety timeout: if native never confirms (shouldn't happen, but don't hang forever
      // or leave the caller's UI stuck), clear the waiter and resolve so the UI can recover.
      setTimeout(() => {
        if (this.pauseWaiters.get(taskId)?.resolve === resolve) {
          this.pauseWaiters.delete(taskId);
          this.activeCallbacks.delete(taskId);
          resolve();
        }
      }, 8_000);
    });
  }

  private sanitize(name: string): string {
    return name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 200);
  }
}
