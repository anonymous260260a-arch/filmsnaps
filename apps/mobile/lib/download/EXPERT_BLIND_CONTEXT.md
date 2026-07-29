# DOCUMENT B — BLIND EXPERT CONSULTATION

## React Native Download Engine — Complete Codebase for Architecture Review

---

## ⚠️ REQUEST

We need you to **design and implement a bulletproof Android download engine** for our React Native (Expo SDK 55) mobile app. The current system is broken — pause doesn't actually pause, resume sends corrupted byte offsets, the stack overflows from repeated pause calls, progress events go missing, and the entire system has become an unmaintainable tangle of patches.

**DO NOT suggest incremental fixes. Give us a complete replacement architecture.**

---

## STACK

| Layer                | Technology                      | Version                                   |
| -------------------- | ------------------------------- | ----------------------------------------- |
| Framework            | React Native via Expo           | SDK 55                                    |
| React Native         | react-native                    | 0.83.6                                    |
| React                | react                           | 19.2.0                                    |
| Language             | TypeScript                      | 5.x                                       |
| Native Android       | Kotlin                          | Android DownloadManager API               |
| Native iOS           | Swift                           | URLSessionDownloadTask                    |
| Expo Router          | expo-router                     | 55.x                                      |
| SQLite               | expo-sqlite                     | 55.x                                      |
| File System          | expo-file-system                | 55.x (modern API: File, Directory, Paths) |
| Notifications        | expo-notifications              | 55.x                                      |
| Networking           | @react-native-community/netinfo | 11.x                                      |
| Styling              | NativeWind (TailwindCSS)        | 4.x                                       |
| Plugin System        | @expo/config-plugins            | (prebuild-time Kotlin injection)          |
| Custom Native Module | appNameDownloader (Kotlin)      | Android DownloadManager wrapper           |

---

## CURRENT ARCHITECTURE

```
UI Components (downloads screen, download sheets, etc.)
    ⇅ (React hooks via useSyncExternalStore)
Download Hooks (useDownloadList, useDownload, useBatchDownloads, useDownloadQueue)
    ⇅
DownloadInfraProvider (context — manager + store + enqueue + control)
    ├── In-Memory Store (store.ts) — synchronous, subscribe/notify pattern
    │       ⇅ (fire-and-forget persistence)
    │   DownloadDatabase (database.ts) — SQLite via expo-sqlite
    │
    └── DownloadManager (manager.ts) — orchestrator: queue, pause/resume/cancel, retry, network policy
            ⇅ (calls adapter)
        NativeDownloaderAdapter (nativeAdapter.ts) — bridges JS ↔ Kotlin/Swift
            ⇅
        NativeDownloadBridge (nativeBridge.ts) — NativeModules.appNameDownloader
            ⇅
        appNameDownloadModule.kt (Kotlin — Android DownloadManager wrapper)
```

---

## KNOWN BUGS (💀 All Unfixed Despite Many Patches)

### 💀 BUG 1: Pause Doesn't Actually Pause (Stack Overflow)

**Symptom**: User taps Pause, ~200 identical `[DL] Manager pause:` logs flood, then `Maximum call stack size exceeded`.
**Root cause**: The "Pause All" button triggers `control("pause", { status: "downloading" })` which filters store tasks by `status === 'downloading'`. But pause never transitions the task to 'paused' successfully (native call silently fails or the event loop piles up), so the button keeps finding the same task and calling pause() again. Each call starts a new `control()` → `manager.pause()` cycle. After ~200 rapid re-entrant calls, the stack overflows.
**Real root cause**: `nativeAdapter.ts:createInstance().pause()` **deletes `activeCallbacks` BEFORE calling native pause** (`this.activeCallbacks.delete(id)` then `NativeDownloadBridge.pause(id)`). If the native pause doesn't fire JS events back in the expected way, or the callback deletion happens too early, the manager's `await instance.pause()` resolves before the native module actually pauses, so `emitStatus` never fires → store never gets `status='paused'` → "Pause All" sees the task still as `'downloading'` → calls pause again.

### 💀 BUG 2: Resume Sends Corrupted Byte Offset (`95236469603970`)

**Symptom**: On resume, `resumeData` reads as `"95236469603970"` — this is `"9523646" + "9603970"` (string concatenation of two numbers).
**Root cause**: `resumeData` is stored as INTEGER in SQLite sometimes, read back as a Number by `rowToTask`, then passed to `store.upsert()` which fires `db.update()` with a string somewhere else. The type mismatch between Number and String through expo-sqlite's parameter binding causes concatenation instead of addition.

### 💀 BUG 3: Resume Downloads Don't Actually Progress

**Symptom**: After resume, progress shows the same offset bytes forever. No new bytes are downloaded.
**Root cause**:

- **Resume ALWAYS DELETES THE PARTIAL FILE** in `resumeDownload()` (Kotlin: `if (existingFile.exists()) existingFile.delete()`). So even with a correct Range header, there's no partial file to append to.
- Even if the file is kept, Android DownloadManager **does NOT support Range headers for resume** — it ignores them and re-downloads from scratch.

### 💀 BUG 4: Progress Events Emit 0 Bytes for Resumed Tasks

**Root cause**: The Kotlin cursor reports `COLUMN_BYTES_DOWNLOADED_SO_FAR=0` for a new DownloadManager task starting from scratch (because the file was deleted). The adapter adds the resume offset (26MB + 0 = 26MB) but this doesn't match the actual situation where no bytes were actually kept.

### 💀 BUG 5: `getInfoAsync` Throws at Runtime (SDK 55 Breaking API)

**Symptom**: `FileSystem.getInfoAsync(...)` throws `TypeError: Cannot read properties of undefined (reading 'getInfoAsync')` in SDK 55.
**Root cause**: Expo SDK 55 removed the default export. `import * as FileSystem from 'expo-file-system'` no longer has `getInfoAsync`.

### 💀 BUG 6: Double Extension (`.mkv.mp4`)

**Root cause**: `DownloadMeta.fileName` already contains the extension (e.g. `"File.mkv"`), and then `task.extension || "mp4"` is appended, producing `.mkv.mp4`.

### 💀 BUG 7: `documentDirectory` is null

**Symptom**: On some Android devices, `documentDirectory` from `expo-file-system` can be null, producing paths like `"undefinedappName/"`.

---

## THE PROBLEM STATEMENT

Android `DownloadManager` is fundamentally not designed for:

1. Reliable pause/resume (it stops progress when you call `remove()`, Range headers are ignored)
2. Real-time progress polling (we use a 500ms Handler+Runnable cursor poll — janky)
3. File-level resume (DownloadManager doesn't support appending to partial files)

**You have two options:**

### Option A: Replace Android DownloadManager with Custom Download Service

Implement a proper `ForegroundService` in Kotlin that uses `URLConnection` or OkHttp with:

- Real HTTP Range-request resume (partial file + append mode)
- True pause (just stop reading the InputStream, save the offset)
- Accurate byte-level progress (from InputStream counter, not cursor polling)
- Background notification with real progress percent
- Thread-safe pause/resume with proper mutex/lock

### Option B: Keep DownloadManager But Fix All The Wrapping

Massively simpler but DownloadManager fundamentally doesn't support true pause/resume well.

**We strongly prefer Option A — a proper native download service.**

---

## REQUIRED FEATURES

The new engine must handle ALL of these reliably:

1. **Fresh download**: Start from URL, save to destination file, track progress
2. **Pause**: Stop downloading immediately, save byte offset. MUST work every time on first tap.
3. **Resume**: Continue from saved offset using HTTP Range header. Must verify partial file exists and has correct size.
4. **Cancel**: Kill download, delete partial file, clean up all state
5. **Batch Pause/Resume/Cancel**: Operate on all active/paused tasks
6. **Queue**: Max 3 concurrent downloads, queue the rest, auto-start when a slot opens
7. **Progress**: Real-time byte-level progress (every 300-400ms at most), speed + ETA
8. **Completion**: Verify file exists on disk, mark complete
9. **Error handling**: Auto-retry with exponential backoff (5s → 15s → 60s), max 3 retries
10. **Network awareness**: Pause all on connectivity loss, auto-resume when reconnected
11. **Notifications**: Show native notification with real progress, dismiss on complete/fail
12. **Storage management**: Track used/free space, evict old downloads
13. **App restart recovery**: On cold start, recover "downloading" tasks as "paused", verify OS-completed files
14. **SQLite persistence**: Full task metadata in SQLite, sync with in-memory store
15. **React integration**: useSyncExternalStore hooks for reactive UI, no stale reads
16. **Thread safety**: No re-entrancy bugs, no stack overflows, no race conditions
17. **File naming**: Single extension (no `.mkv.mp4`), sanitized for native filesystem
18. **Dead task suppression**: Late native completions for cancelled tasks must be ignored

---

## FILES INCLUDED IN THIS PACKAGE

All source files are in the `lib/download/` directory. Below is every file in the download engine, labeled with its path.

---

### 1. [`types.ts`](lib/download/types.ts) — Core type definitions

```typescript
export type DownloadStatus =
  | "pending"
  | "downloading"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "retrying";

export type DownloadServer = "service-1" | "service-2" | "service-3";
export type MediaType = "type-a" | "type-b";

export interface DownloadMeta {
  url: string;
  fileName: string;
  server: DownloadServer;
  mediaType?: MediaType;
  contentId?: string;
  quality?: string;
  title?: string;
  posterPath?: string;
  batchNumber?: number;
  itemNumber?: number;
  extension?: string;
  speedLimit?: number;
}

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
  priority?: number;
  retryCount?: number;
  maxRetries?: number;
  nativeTaskId?: string | null;
  expectedHash?: string | null;
  startedOnWifi?: boolean;
  speed?: number;
  eta?: number;
}

export type ControlAction = "pause" | "resume" | "cancel" | "retry" | "remove";
export type ControlTarget =
  | string
  | string[]
  | { status?: DownloadStatus | DownloadStatus[] };

export interface DownloadProgress {
  taskId: string;
  receivedBytes: number;
  totalBytes: number;
  speed?: number;
  eta?: number;
}

export interface StatusChange {
  taskId: string;
  status: DownloadStatus;
  error?: string;
  fileUri?: string | null;
  receivedBytes?: number;
  totalBytes?: number;
  removed?: boolean;
}

export interface AggregateProgress {
  totalBytes: number;
  receivedBytes: number;
  fraction: number;
  activeCount: number;
  totalCount: number;
  completedCount: number;
}

export interface DownloadGrouped {
  all: DownloadTask[];
  active: DownloadTask[];
  paused: DownloadTask[];
  completed: DownloadTask[];
  failed: DownloadTask[];
  cancelled: DownloadTask[];
  retrying: DownloadTask[];
}

export type Unsubscribe = () => void;
export type NetworkPolicy = "wifi-only" | "any" | "ask";

export interface DownloadConfig {
  maxConcurrent: number;
  networkPolicy: NetworkPolicy;
  autoRetry: boolean;
  maxRetries: number;
  showNativeNotification: boolean;
}

export const DEFAULT_CONFIG: DownloadConfig = {
  maxConcurrent: 3,
  networkPolicy: "any",
  autoRetry: true,
  maxRetries: 3,
  showNativeNotification: true,
};
```

### 2. [`adapter.ts`](lib/download/adapter.ts) — Adapter interfaces

```typescript
export interface DownloadOptions {
  url: string;
  filePath: string;
  headers?: Record<string, string>;
  speedLimit?: number;
  externalId?: string;
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
  onDone?: (filePath: string) => void;
  onError?: (error: Error) => void;
}

export interface DownloadInstance {
  id: string;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
}

export interface IDownloaderAdapter {
  download(options: DownloadOptions): Promise<DownloadInstance>;
  resumeDownload(
    taskId: string,
    url: string,
    fileName: string,
    offsetBytes: number,
    options: Pick<DownloadOptions, "onProgress" | "onDone" | "onError">,
  ): Promise<DownloadInstance>;
  hasActiveTask(taskId: string): boolean;
  getDestinationPath(fileName: string): string;
  supportsBackground(): boolean;
  getAvailableStorage(): Promise<number>;
  destroy(): Promise<void>;
}
```

### 3. [`nativeBridge.ts`](lib/download/nativeBridge.ts) — React Native → Kotlin bridge

```typescript
import { NativeModules, NativeEventEmitter, Platform } from "react-native";

const { appNameDownloader } = NativeModules;
if (!appNameDownloader) {
  throw new Error("[appNameDownloader] Native module not found.");
}

const emitter = new NativeEventEmitter(appNameDownloader);

export interface ProgressEvent {
  taskId: string;
  bytesDownloaded: number;
  bytesTotal: number;
}

export interface CompleteEvent {
  taskId: string;
  filePath: string;
  bytesTotal: number;
}

export interface ErrorEvent {
  taskId: string;
  error: string;
  errorCode?: number;
}

export interface PausedEvent {
  taskId: string;
  bytesDownloaded: number;
  bytesTotal: number;
}

export const NativeDownloadBridge = {
  start(
    taskId: string,
    url: string,
    fileName: string,
    headers?: Record<string, string>,
  ): Promise<string> {
    return appNameDownloader.startDownload(
      taskId,
      url,
      fileName,
      headers ?? {},
    );
  },
  pause(taskId: string): Promise<void> {
    return appNameDownloader.pauseDownload(taskId);
  },
  resume(
    taskId: string,
    url: string,
    fileName: string,
    offsetBytes: number,
    headers?: Record<string, string>,
  ): Promise<string> {
    return appNameDownloader.resumeDownload(
      taskId,
      url,
      fileName,
      offsetBytes,
      headers ?? {},
    );
  },
  cancel(taskId: string): Promise<void> {
    return appNameDownloader.cancelDownload(taskId);
  },
  getAvailableStorage(): Promise<number> {
    return appNameDownloader.getAvailableStorage();
  },
  async resumeDownload(params: {
    taskId: string;
    url: string;
    fileName: string;
    offsetBytes: number;
    totalBytes: number;
  }): Promise<void> {
    const headers: Record<string, string> = {
      __totalBytes: String(params.totalBytes),
    };
    await appNameDownloader.resumeDownload(
      params.taskId,
      params.url,
      params.fileName,
      params.offsetBytes,
      headers,
    );
  },
  onProgress(callback: (e: ProgressEvent) => void): () => void {
    const sub = emitter.addListener("onDownloadProgress", callback);
    return () => sub.remove();
  },
  onComplete(callback: (e: CompleteEvent) => void): () => void {
    const sub = emitter.addListener("onDownloadComplete", callback);
    return () => sub.remove();
  },
  onError(callback: (e: ErrorEvent) => void): () => void {
    const sub = emitter.addListener("onDownloadError", callback);
    return () => sub.remove();
  },
  onPaused(callback: (e: PausedEvent) => void): () => void {
    const sub = emitter.addListener("onDownloadPaused", callback);
    return () => sub.remove();
  },
  removeAllListeners(): void {
    emitter.removeAllListeners("onDownloadProgress");
    emitter.removeAllListeners("onDownloadComplete");
    emitter.removeAllListeners("onDownloadError");
    emitter.removeAllListeners("onDownloadPaused");
  },
};
```

### 4. [`nativeAdapter.ts`](lib/download/nativeAdapter.ts) — Event-driven adapter with per-task callbacks

```typescript
import {
  NativeDownloadBridge,
  type CompleteEvent as NativeCompleteEvent,
} from "./nativeBridge";
import type { DownloadInstance } from "./adapter";
import { buildFileName, sanitizeForNative } from "./fileNameUtils";
import { getNativeDownloadDir, ensureDirectory, deleteFile } from "./fsCompat";

interface ProgressEvent {
  taskId: string;
  bytesDownloaded: number; // RAW from Kotlin cursor (0 at start of resume)
  bytesTotal: number; // RAW from Kotlin cursor (-1 if unknown)
}

interface PerTaskCallbacks {
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
  onDone?: (filePath: string) => void;
  onError?: (error: Error) => void;
}

export class NativeDownloaderAdapter {
  private subscriptions: Array<{ remove: () => void }> = [];
  private globalListenersAttached = false;
  private activeCallbacks = new Map<string, PerTaskCallbacks>();
  private resumeOffsets = new Map<string, number>();
  private lastKnownTotals = new Map<string, number>();
  private lastProgressTime = new Map<string, number>();
  private lastProgressBytes = new Map<string, number>();
  private deadTasks = new Set<string>();

  private static readonly THROTTLE_MS = 300;
  private static readonly THROTTLE_BYTES = 1_000_000;

  constructor() {
    this.attachGlobalListeners();
  }

  private attachGlobalListeners(): void {
    if (this.globalListenersAttached) return;
    this.globalListenersAttached = true;
    this.subscriptions.push(
      NativeDownloadBridge.onProgress((e: ProgressEvent) =>
        this.handleProgress(e),
      ),
    );
    this.subscriptions.push(
      NativeDownloadBridge.onComplete((e: NativeCompleteEvent) =>
        this.handleComplete(e),
      ),
    );
    this.subscriptions.push(
      NativeDownloadBridge.onError((e) => {
        this.deadTasks.add(e.taskId);
        const cb = this.activeCallbacks.get(e.taskId);
        if (cb?.onError) cb.onError(new Error(e.error));
        this.activeCallbacks.delete(e.taskId);
      }),
    );
    this.subscriptions.push(
      NativeDownloadBridge.onPaused((e) => {
        /* no action */
      }),
    );
  }

  destroy(): void {
    this.subscriptions.forEach((s) => s.remove());
    this.subscriptions = [];
    this.globalListenersAttached = false;
    this.activeCallbacks.clear();
    this.resumeOffsets.clear();
    this.lastKnownTotals.clear();
    this.lastProgressTime.clear();
    this.lastProgressBytes.clear();
    this.deadTasks.clear();
  }

  setResumeOffset(taskId: string, offsetBytes: number): void {
    this.resumeOffsets.set(taskId, offsetBytes);
    this.lastProgressTime.delete(taskId);
    this.lastProgressBytes.delete(taskId);
  }
  clearResumeOffset(taskId: string): void {
    this.resumeOffsets.set(taskId, 0);
    this.lastProgressTime.delete(taskId);
    this.lastProgressBytes.delete(taskId);
  }
  setLastKnownTotal(taskId: string, totalBytes: number): void {
    if (totalBytes > 0) {
      this.lastKnownTotals.set(taskId, totalBytes);
    }
  }
  markTaskDead(taskId: string): void {
    this.deadTasks.add(taskId);
    this.resumeOffsets.delete(taskId);
    this.lastKnownTotals.delete(taskId);
    this.lastProgressTime.delete(taskId);
    this.lastProgressBytes.delete(taskId);
    this.activeCallbacks.delete(taskId);
    setTimeout(() => this.deadTasks.delete(taskId), 30_000);
  }

  private handleProgress(e: ProgressEvent): void {
    if (this.deadTasks.has(e.taskId)) return;
    const offset = this.resumeOffsets.get(e.taskId) ?? 0;
    const absoluteDownloaded = offset + e.bytesDownloaded;
    let absoluteTotal: number;
    if (e.bytesTotal > 0) {
      absoluteTotal = offset + e.bytesTotal;
      this.lastKnownTotals.set(e.taskId, absoluteTotal);
    } else {
      absoluteTotal = this.lastKnownTotals.get(e.taskId) ?? 0;
    }
    if (absoluteDownloaded <= 0 && absoluteTotal <= 0) return;
    const lastBytes = this.lastProgressBytes.get(e.taskId) ?? -1;
    if (absoluteDownloaded === lastBytes && lastBytes > 0) return;
    const now = Date.now();
    const lastTime = this.lastProgressTime.get(e.taskId) ?? 0;
    const timeDelta = now - lastTime;
    const bytesDelta = absoluteDownloaded - Math.max(lastBytes, 0);
    const isFirstEvent = lastBytes < 0;
    const shouldEmit =
      isFirstEvent ||
      timeDelta >= NativeDownloaderAdapter.THROTTLE_MS ||
      bytesDelta >= NativeDownloaderAdapter.THROTTLE_BYTES;
    if (!shouldEmit) return;
    this.lastProgressTime.set(e.taskId, now);
    this.lastProgressBytes.set(e.taskId, absoluteDownloaded);
    this.activeCallbacks
      .get(e.taskId)
      ?.onProgress?.(absoluteDownloaded, absoluteTotal);
  }

  private handleComplete(e: NativeCompleteEvent): void {
    this.resumeOffsets.delete(e.taskId);
    this.lastKnownTotals.delete(e.taskId);
    this.lastProgressTime.delete(e.taskId);
    this.lastProgressBytes.delete(e.taskId);
    const cb = this.activeCallbacks.get(e.taskId);
    if (cb?.onDone) {
      cb.onDone(e.filePath);
    }
    this.activeCallbacks.delete(e.taskId);
  }

  getDestinationPath(fileName: string): string {
    return `${getNativeDownloadDir()}${fileName}`;
  }

  async download(options: {
    url: string;
    filePath: string;
    headers?: Record<string, string>;
    speedLimit?: number;
    externalId?: string;
    onProgress?: (receivedBytes: number, totalBytes: number) => void;
    onDone?: (filePath: string) => void;
    onError?: (error: Error) => void;
  }): Promise<DownloadInstance> {
    const id =
      options.externalId ??
      `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fileName = options.filePath.split("/").pop() ?? `${id}.mp4`;
    this.clearResumeOffset(id);
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
    this.setResumeOffset(taskId, offsetBytes);
    this.activeCallbacks.set(taskId, {
      onProgress: options.onProgress,
      onDone: options.onDone,
      onError: options.onError,
    });
    await NativeDownloadBridge.resumeDownload({
      taskId,
      url,
      fileName: safeName,
      offsetBytes,
      totalBytes: -1,
    });
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

  private createInstance(id: string, fileName: string): DownloadInstance {
    return {
      id,
      pause: async () => {
        this.activeCallbacks.delete(id);
        await NativeDownloadBridge.pause(id);
      },
      resume: async () => {},
      cancel: async () => {
        this.markTaskDead(id);
        await NativeDownloadBridge.cancel(id).catch(() => {});
        const path = `${getNativeDownloadDir()}${this.sanitize(fileName)}`;
        deleteFile(path);
      },
    };
  }

  private sanitize(name: string): string {
    return name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 200);
  }
}
```

### 5. [`appNameDownloadModule.kt`](android/app/src/main/java/app/appName/mobile/download/appNameDownloadModule.kt) — 502 lines

Full Kotlin module. Uses Android `DownloadManager` with:

- `startDownload()`: Enqueues a `DownloadManager.Request` + starts 500ms polling loop via Handler+Runnable cursor query
- `pauseDownload()`: Stops polling, reads bytes from cursor, calls `downloadManager.remove(nativeId)`, saves offset
- `resumeDownload()`: Deletes existing partial file (!), creates new DownloadManager request with Range header, starts new polling
- `cancelDownload()`: Stops polling, removes from DownloadManager, cleans up maps
- `startProgressPolling()`: 500ms Runnable that queries DownloadManager cursor for STATUS, BYTES_DOWNLOADED_SO_FAR, TOTAL_SIZE_BYTES
- `completionReceiver()`: BroadcastReceiver for ACTION_DOWNLOAD_COMPLETE, queries cursor for localUri
- Event emission via `DeviceEventManagerModule.RCTDeviceEventEmitter`
- Maps: `taskToNativeId`, `nativeToTaskId`, `taskResumeOffsets`, `taskOriginalTotalBytes`

```kotlin
package app.appName.mobile.download

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.Cursor
import android.net.Uri
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class appNameDownloadModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "appNameDownloader"
        private const val POLL_INTERVAL_MS = 500L
        private const val TAG = "appNameDownloader"
    }

    override fun getName(): String = NAME

    private val downloadManager: DownloadManager by lazy {
        reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    }

    // ─── Task Tracking Maps ────────────────────────────────────────
    private val taskToNativeId = mutableMapOf<String, Long>()
    private val nativeToTaskId = mutableMapOf<Long, String>()
    private val taskUrls = mutableMapOf<String, String>()
    private val taskFileNames = mutableMapOf<String, String>()
    private val taskOriginalTotalBytes = mutableMapOf<String, Long>()
    private val taskResumeOffsets = mutableMapOf<String, Long>()

    // Polling infrastructure
    private val pollingHandlers = mutableMapOf<String, Handler>()
    private val pollingRunnables = mutableMapOf<String, Runnable>()
    private var listenerCount = 0

    // ─── Completion BroadcastReceiver ──────────────────────────────
    private val completionReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val nativeId = intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) ?: -1
            if (nativeId == -1L) return
            val taskId = nativeToTaskId[nativeId] ?: return
            stopProgressPolling(taskId)
            val cursor = downloadManager.query(DownloadManager.Query().setFilterById(nativeId))
            if (cursor != null && cursor.moveToFirst()) {
                val statusIdx = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS)
                val localUriIdx = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)
                val totalIdx = cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
                val reasonIdx = cursor.getColumnIndex(DownloadManager.COLUMN_REASON)
                val status = if (statusIdx >= 0) cursor.getInt(statusIdx) else -1
                val localUri = if (localUriIdx >= 0) cursor.getString(localUriIdx) ?: "" else ""
                val totalBytes = if (totalIdx >= 0) cursor.getLong(totalIdx) else -1L
                val reason = if (reasonIdx >= 0) cursor.getInt(reasonIdx) else -1
                cursor.close()
                if (status == DownloadManager.STATUS_SUCCESSFUL) {
                    val offset = taskResumeOffsets[taskId] ?: 0L
                    val absoluteTotal = when {
                        totalBytes > 0 -> offset + totalBytes
                        else -> taskOriginalTotalBytes[taskId] ?: -1L
                    }
                    sendEvent("onDownloadComplete", Arguments.createMap().apply {
                        putString("taskId", taskId)
                        putString("filePath", localUri)
                        putDouble("totalBytes", absoluteTotal.toDouble())
                    })
                } else {
                    sendEvent("onDownloadError", Arguments.createMap().apply {
                        putString("taskId", taskId)
                        putString("error", "Download failed (status=$status reason=$reason)")
                        putInt("errorCode", reason)
                    })
                }
            } else {
                cursor?.close()
                sendEvent("onDownloadError", Arguments.createMap().apply {
                    putString("taskId", taskId)
                    putString("error", "Download completed but cursor was empty")
                    putInt("errorCode", -1)
                })
            }
            taskToNativeId.remove(taskId)
            nativeToTaskId.remove(nativeId)
        }
    }

    init {
        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        reactContext.registerReceiver(completionReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    }

    override fun invalidate() {
        super.invalidate()
        try { reactContext.unregisterReceiver(completionReceiver) } catch (_: Exception) {}
        pollingHandlers.keys.toList().forEach { stopProgressPolling(it) }
    }

    @ReactMethod fun addListener(eventName: String) { listenerCount++ }
    @ReactMethod fun removeListeners(count: Int) { listenerCount -= count; if (listenerCount < 0) listenerCount = 0 }

    @ReactMethod
    fun startDownload(taskId: String, url: String, fileName: String, headers: ReadableMap?, promise: Promise) {
        try {
            val safeName = fileName.replace(Regex("[<>:\"/\\\\|?*\\x00-\\x1f]"), "_")
            try {
                val existingFile = java.io.File(
                    reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                    "appName/$safeName"
                )
                if (existingFile.exists()) existingFile.delete()
            } catch (_: Exception) {}
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setTitle(safeName); setDescription("appName")
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalFilesDir(reactContext, Environment.DIRECTORY_DOWNLOADS, "appName/$safeName")
                setAllowedOverMetered(true); setAllowedOverRoaming(false); setRequiresCharging(false)
                headers?.let { h -> val iter = h.keySetIterator()
                    while (iter.hasNextKey()) { val key = iter.nextKey(); h.getString(key)?.let { addRequestHeader(key, it) } } }
            }
            val nativeId = downloadManager.enqueue(request)
            taskToNativeId[taskId] = nativeId; nativeToTaskId[nativeId] = taskId
            taskUrls[taskId] = url; taskFileNames[taskId] = fileName
            taskResumeOffsets[taskId] = 0L; taskOriginalTotalBytes.remove(taskId)
            startProgressPolling(taskId, nativeId)
            promise.resolve(nativeId.toString())
        } catch (e: Exception) {
            promise.reject("START_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun pauseDownload(taskId: String, promise: Promise) {
        val nativeId = taskToNativeId[taskId]
        if (nativeId == null) { promise.resolve(null); return }
        stopProgressPolling(taskId)
        val bytesDownloaded = queryBytesDownloaded(nativeId)
        val offset = taskResumeOffsets[taskId] ?: 0L
        val absoluteBytes = offset + bytesDownloaded
        downloadManager.remove(nativeId)
        taskToNativeId.remove(taskId); nativeToTaskId.remove(nativeId)
        taskResumeOffsets[taskId] = absoluteBytes
        sendEvent("onDownloadPaused", Arguments.createMap().apply {
            putString("taskId", taskId); putDouble("bytesDownloaded", absoluteBytes.toDouble())
        })
        promise.resolve(null)
    }

    @ReactMethod
    fun resumeDownload(taskId: String, url: String, fileName: String, offsetBytes: Double, headers: ReadableMap?, promise: Promise) {
        try {
            val safeName = fileName.replace(Regex("[<>:\"/\\\\|?*\\x00-\\x1f]"), "_")
            try {
                val existingFile = java.io.File(
                    reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                    "appName/$safeName"
                )
                if (existingFile.exists()) existingFile.delete()
            } catch (_: Exception) {}
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setTitle(safeName); setDescription("appName")
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalFilesDir(reactContext, Environment.DIRECTORY_DOWNLOADS, "appName/$safeName")
                setAllowedOverMetered(true); setAllowedOverRoaming(false); setRequiresCharging(false)
                if (offsetBytes > 0) { addRequestHeader("Range", "bytes=${offsetBytes.toLong()}-") }
                headers?.let { h -> val iter = h.keySetIterator()
                    while (iter.hasNextKey()) { val key = iter.nextKey(); h.getString(key)?.let { addRequestHeader(key, it) } } }
            }
            val newNativeId = downloadManager.enqueue(request)
            stopProgressPolling(taskId)
            val oldNativeId = taskToNativeId[taskId]
            if (oldNativeId != null) nativeToTaskId.remove(oldNativeId)
            taskToNativeId[taskId] = newNativeId; nativeToTaskId[newNativeId] = taskId
            taskResumeOffsets[taskId] = offsetBytes.toLong()
            headers?.let { h -> if (h.hasKey("__totalBytes")) {
                val raw = h.getString("__totalBytes"); if (raw != null) taskOriginalTotalBytes[taskId] = raw.toLongOrNull() ?: 0L
            } }
            taskUrls[taskId] = url; taskFileNames[taskId] = fileName
            startProgressPolling(taskId, newNativeId)
            promise.resolve(newNativeId.toString())
        } catch (e: Exception) {
            promise.reject("E_RESUME_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun cancelDownload(taskId: String, promise: Promise) {
        stopProgressPolling(taskId)
        val nativeId = taskToNativeId[taskId]
        if (nativeId != null) { downloadManager.remove(nativeId); taskToNativeId.remove(taskId); nativeToTaskId.remove(nativeId) }
        taskUrls.remove(taskId); taskFileNames.remove(taskId); taskResumeOffsets.remove(taskId); taskOriginalTotalBytes.remove(taskId)
        promise.resolve(null)
    }

    @ReactMethod
    fun getAvailableStorage(promise: Promise) {
        try { val stat = android.os.StatFs(Environment.getDataDirectory().path); promise.resolve(stat.availableBytes.toDouble()) }
        catch (e: Exception) { promise.resolve(0.0) }
    }

    private fun startProgressPolling(taskId: String, nativeId: Long) {
        stopProgressPolling(taskId)
        val handler = Handler(Looper.getMainLooper())
        val runnable = object : Runnable {
            override fun run() {
                var cursor: Cursor? = null
                try {
                    val currentNativeId = taskToNativeId[taskId]
                    if (currentNativeId == null || currentNativeId != nativeId) { stopProgressPolling(taskId); return }
                    cursor = downloadManager.query(DownloadManager.Query().setFilterById(nativeId))
                    if (cursor != null && cursor.moveToFirst()) {
                        val statusIdx = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS)
                        val bytesIdx = cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
                        val totalIdx = cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
                        val reasonIdx = cursor.getColumnIndex(DownloadManager.COLUMN_REASON)
                        val localUriIdx = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)
                        val status = if (statusIdx >= 0) cursor.getInt(statusIdx) else -1
                        val bytesDownloaded = if (bytesIdx >= 0) cursor.getLong(bytesIdx) else 0L
                        val cursorTotalBytes = if (totalIdx >= 0) cursor.getLong(totalIdx) else -1L

                        when (status) {
                            DownloadManager.STATUS_RUNNING, DownloadManager.STATUS_PAUSED -> {
                                sendEvent("onDownloadProgress", Arguments.createMap().apply {
                                    putString("taskId", taskId)
                                    putDouble("bytesDownloaded", bytesDownloaded.toDouble())
                                    putDouble("bytesTotal", if (cursorTotalBytes > 0) cursorTotalBytes.toDouble() else -1.0)
                                })
                            }
                            DownloadManager.STATUS_FAILED -> {
                                val reason = if (reasonIdx >= 0) cursor.getInt(reasonIdx) else -1
                                sendEvent("onDownloadError", Arguments.createMap().apply {
                                    putString("taskId", taskId); putString("error", "Download failed (code: $reason)"); putInt("errorCode", reason)
                                })
                                taskToNativeId.remove(taskId); nativeToTaskId.remove(nativeId)
                                taskUrls.remove(taskId); taskFileNames.remove(taskId); taskResumeOffsets.remove(taskId); taskOriginalTotalBytes.remove(taskId)
                                stopProgressPolling(taskId); return
                            }
                            DownloadManager.STATUS_SUCCESSFUL -> {
                                val localUri = if (localUriIdx >= 0) cursor.getString(localUriIdx) ?: "" else ""
                                val totalZ = if (totalIdx >= 0) cursor.getLong(totalIdx) else -1L
                                val offset = taskResumeOffsets[taskId] ?: 0L
                                val absoluteTotal = if (totalZ > 0) offset + totalZ else (taskOriginalTotalBytes[taskId] ?: totalZ)
                                sendEvent("onDownloadComplete", Arguments.createMap().apply {
                                    putString("taskId", taskId); putString("filePath", localUri); putDouble("totalBytes", absoluteTotal.toDouble())
                                })
                                taskToNativeId.remove(taskId); nativeToTaskId.remove(nativeId)
                                taskUrls.remove(taskId); taskFileNames.remove(taskId); taskResumeOffsets.remove(taskId); taskOriginalTotalBytes.remove(taskId)
                                stopProgressPolling(taskId); return
                            }
                        }
                    }
                } catch (e: Exception) { Log.e(TAG, "Polling error: taskId=$taskId", e) }
                finally { cursor?.close() }
                handler.postDelayed(this, POLL_INTERVAL_MS)
            }
        }
        pollingHandlers[taskId] = handler
        pollingRunnables[taskId] = runnable
        handler.post(runnable)
    }

    private fun stopProgressPolling(taskId: String) {
        pollingRunnables[taskId]?.let { r -> pollingHandlers[taskId]?.removeCallbacks(r) }
        pollingHandlers.remove(taskId); pollingRunnables.remove(taskId)
    }

    private fun queryBytesDownloaded(nativeId: Long): Long {
        val cursor = downloadManager.query(DownloadManager.Query().setFilterById(nativeId))
        var bytes = 0L
        if (cursor != null && cursor.moveToFirst()) {
            val idx = cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
            if (idx >= 0) bytes = cursor.getLong(idx)
        }
        cursor?.close(); return bytes
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        if (listenerCount > 0) {
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        }
    }
}
```

### 6. [`appNameDownloadPackage.kt`](android/app/src/main/java/app/appName/mobile/download/appNameDownloadPackage.kt)

```kotlin
package app.appName.mobile.download
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class appNameDownloadPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(appNameDownloadModule(reactContext))
    }
    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
```

### 7. [`manager.ts`](lib/download/manager.ts) — Main orchestrator (partially shown — key sections)

**Imports & Constants:**

```typescript
import { DownloadDatabase } from "./database";
import { NativeDownloaderAdapter } from "./nativeAdapter";
import { NetworkAwarePolicy } from "./networkPolicy";
import { StorageManager } from "./storageManager";
import type { DownloadInstance } from "./adapter";
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

const RETRY_DELAYS = [5_000, 15_000, 60_000];
const DB_WRITE_INTERVAL = 3_000;
const PROGRESS_EMIT_INTERVAL = 400;
```

**SpeedTracker & DownloadManager class:**

```typescript
class SpeedTracker {
  private samples: Array<{ time: number; bytes: number }> = [];
  private windowMs = 5_000;
  update(bytes: number): void { /* sliding window */ }
  getSpeed(): number { /* returns bytes/sec from samples */ }
  getEta(remainingBytes: number): number { /* seconds */ }
  reset(): void { this.samples = []; }
}

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
  private processQueuePromise: Promise<void> | null = null;
  private initialized = false;
  private pausedForNetwork = new Set<string>();
  private networkDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private progressListeners = new Set<...>();
  private statusListeners = new Set<...>();
  private queueListeners = new Set<...>();

  constructor(config?: Partial<DownloadConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.adapter = new NativeDownloaderAdapter();
    this.networkPolicy = new NetworkAwarePolicy(this.config.networkPolicy);
    this.storage = new StorageManager();
    this.networkPolicy.onChange((canDownload, isWifi) => {
      if (this.networkDebounceTimer) clearTimeout(this.networkDebounceTimer);
      this.networkDebounceTimer = setTimeout(() => {
        this.networkDebounceTimer = null;
        if (!canDownload) this.pauseAllForNetwork();
        else { this.resumeNetworkPaused(); this.processQueue(); }
      }, 1000);
    });
  }

  // initialize(), add(), pause(), resume(), cancel(), retry(), remove(),
  // pauseAll(), resumeAll(), cancelAll(), startDownload(),
  // handleNativeDone(), completeTask(), handleNativeError(), failTask(),
  // processQueue() (shared-promise), _drainQueue(), cleanup(),
  // emitProgress(), emitStatus(), notifyQueue(), destroy()
}
```

The full manager.ts is ~1160 lines. Key method signatures:

- `async initialize(): Promise<void>` — Marks stale tasks, checks OS-completed, queues pending
- `async add(task: DownloadTask): Promise<string>` — Adds to DB, pushes to queue, deduplicates by URL
- `async pause(taskId: string): Promise<void>` — Awaits native pause, reads liveReceived, stats file if 0, updates DB
- `async resume(taskId: string): Promise<void>` — Validates partial file, calls adapter.resumeDownload with offset
- `async cancel(taskId: string): Promise<void>` — DB mark first, then native cancel, cleanup
- `async retry(taskId: string): Promise<void>` — Resets to pending + queue

---

## KEY FILE SUMMARIES (not fully listed — all follow similar patterns)

### [`database.ts`](lib/download/database.ts) — 360 lines

SQLite via `expo-sqlite`. Schema: `downloads` table with 27 columns (id, item_id, item_type, title, url, file_path, file_size, downloaded_bytes, status, priority, resume_data, etc.).

### [`store.ts`](lib/download/store.ts) — 147 lines

Synchronous in-memory store with subscription pattern. `upsert` finds/replaces tasks synchronously, notifies listeners, fire-and-forget DB insert. `subscribe`, `subscribeTask`, `subscribeLoaded` return Unsubscribe. `load()` hydrates from SQLite.

### [`context.tsx`](lib/download/context.tsx) — 257 lines

React Context provider. Creates DownloadManager singleton, loads store from DB, initializes manager. Wires manager events → store mutations. Exposes `enqueue(meta)` and `control(action, target)` for batch operations. Has Strict Mode mount guard.

### [`fsCompat.ts`](lib/download/fsCompat.ts) — ~90 lines

SDK 55 modern API wrappers. Uses `File`, `Directory`, `Paths` from `expo-file-system`. `getInfoAsync` never throws. `getNativeDownloadDir()` returns platform-specific directory matching Kotlin's `setDestinationInExternalFilesDir`.

### [`fileNameUtils.ts`](lib/download/fileNameUtils.ts) — ~60 lines

`buildFileName(fileName, extension?, uniqueSuffix?)`: strips existing extension, appends canonical one. `sanitizeForNative(fileName)`: matches Kotlin safe-name regex.

### [`storageManager.ts`](lib/download/storageManager.ts) — 131 lines

Disk space management: `canFit`, `getUsedSpace`, `getFreeSpace`, `evictOldest`, `deleteFile`.

### [`networkPolicy.ts`](lib/download/networkPolicy.ts) — 81 lines

NetInfo-based wifi-only/any/ask policies with change callbacks.

### [`notifications.ts`](lib/download/notifications.ts) — 93 lines

expo-notifications wrapper: request permissions, show completed/failed.

### [`migration.ts`](lib/download/migration.ts) — 105 lines

One-time migration from legacy system. Verifies completed files, marks in-progress as paused.

### Hook files

**`useDownloadList.ts`**: Groups tasks by status, uses useSyncExternalStore.
**`useDownload.ts`**: Single-task hook with 300ms action debounce.
**`useDownloadQueue.ts`**: Queue monitor with pauseAll/resumeAll/cancelAll.
**`useBatchDownloads.ts`**: Batch download management with aggregate progress.

### [`index.ts`](lib/download/index.ts) — Public API

Re-exports: DownloadInfraProvider, useDownloadInfra, DownloadManager, NativeDownloaderAdapter, NetworkAwarePolicy, StorageManager, DownloadDatabase, DownloadNotifications, createDownloadStore, all hooks and types.

### [`utils.ts`](lib/download/utils.ts)

`sanitizeResumeData(value)`: validates and normalizes resume data. `toSafeNumber(value, fallback)`, `formatBytes(bytes)`.

---

## EXPORT CONFIG PLUGIN — with-appName-downloader

The config plugin (`plugins/with-appName-downloader/index.js`) calls `withAndroidDownloader` and `withIOSDownloader`.

**`withAndroidDownloader.js`** (104 lines):

1. Writes appNameDownloadModule.kt and appNameDownloadPackage.kt into the generated android/ tree via `withDangerousMod`
2. Patches MainApplication.kt to import and register appNameDownloadPackage via `withMainApplication`
3. Adds Android permissions (INTERNET, ACCESS_NETWORK_STATE, POST_NOTIFICATIONS, FOREGROUND_SERVICE, WAKE_LOCK) via `withAndroidManifest`

---

## PACKAGE.JSON

```json
{
  "name": "@appName/mobile",
  "version": "0.1.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "web": "expo start --web"
  },
  "dependencies": {
    "expo": "~55.0.27",
    "react": "19.2.0",
    "react-native": "0.83.6",
    "expo-file-system": "~55.0.23",
    "expo-sqlite": "~55.0.0",
    "expo-notifications": "~55.0.25",
    "expo-router": "~55.0.16",
    "expo-constants": "~55.0.16",
    "expo-task-manager": "~55.0.0",
    "expo-background-fetch": "~55.0.0",
    "react-native-safe-area-context": "~5.6.2",
    "@react-native-community/netinfo": "^11.4.1",
    "@react-native-async-storage/async-storage": "^2.2.0",
    "expo-haptics": "^55.0.0",
    "expo-image": "~55.0.11",
    "expo-sharing": "~55.0.21",
    "expo-video": "~55.0.18",
    "react-native-gesture-handler": "^3.1.0",
    "react-native-reanimated": "4.2.1",
    "react-native-svg": "^15.15.3",
    "react-native-webview": "13.16.0",
    "react-native-web": "^0.21.0",
    "react-native-css-interop": "^0.2.5",
    "nativewind": "^4.0.0",
    "tailwindcss": "^3.4.17"
  },
  "devDependencies": {
    "@types/react": "~19.2.10",
    "typescript": "^5"
  }
}
```

---

## WHAT WE NEED FROM YOU

1. **Complete architectural analysis** of what's wrong at the design level
2. **A full rewrite** of the native Kotlin module (appNameDownloadModule.kt) — replace Android DownloadManager with a proper download service (OkHttp-based ForegroundService) that supports true pause/resume
3. **Updated plugin copies** for the prebuild plugin template at `plugins/with-appName-downloader/files/appNameDownloadModule.kt`
4. **Minor JS-side adapter changes** if needed in `nativeAdapter.ts` and `nativeBridge.ts`
5. **Any new plugin code** needed (manifest permissions, foreground service registration, etc.)
6. **Explanation of key design decisions** — thread safety, byte tracking, range headers
7. **Implementation priority order**

**The most critical issues to solve, in order:**

1. Pause actually pauses (this is the #1 complaint)
2. Downloads appear in the UI immediately after enqueue (no restart needed)
3. Resume produces correct byte offsets (no corrupted resumeData)
4. Progress is smooth and correct (no stale bytes from DB)
5. No stack overflows from rapid button taps
