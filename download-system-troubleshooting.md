# Download System Troubleshooting Report — 1 Byte File Size Issue

---

## 1. Executive Summary

The Filmsnaps mobile app (React Native / Expo SDK 55) has a download system that successfully enqueues downloads and reports them as "completed," but the resulting file on disk has a size of **1.0 B** (one byte). This indicates the native download engine (`react-native-blob-util`, v0.17.3) either writes an empty/truncated file or the download pipeline completes without actually streaming any content bytes into the target file. Debug logging shows enqueue succeeds, the manager starts the download, but no BlobDownloader output is ever observed in the logs.

---

## 2. Environment

| Field                       | Value                                                                           |
| --------------------------- | ------------------------------------------------------------------------------- |
| **App**                     | Filmsnaps mobile (React Native / Expo)                                          |
| **RN Version**              | 0.83.6                                                                          |
| **Expo SDK**                | 55                                                                              |
| **Native Download Library** | `react-native-blob-util` v0.17.3                                                |
| **Persistence**             | `expo-sqlite` (SQLite) + `@react-native-async-storage/async-storage` (fallback) |
| **Notifications**           | `expo-notifications`                                                            |
| **Background Tasks**        | `expo-task-manager` + `expo-background-fetch`                                   |
| **Platform Tested**         | Android (emulator and physical device)                                          |

---

## 3. System Architecture

```
UI (download/[...id].tsx, download/nxsha/[...id].tsx, etc.)
  │  enqueue({ url, fileName, server, ... })
  ▼
DownloadInfraProvider (context.tsx)
  │  createEnqueue → store.upsert(task) + manager.add(task)
  ▼
DownloadManager (manager.ts)
  │  Queue processing (max 3 concurrent)
  │  processQueue() → startDownload(task)
  │    ├─ ensureDownloadDir() – creates Filmsnaps/ directory
  │    ├─ buildFilePath(task) – constructs target path
  │    ├─ adapter.download({ url, filePath, headers, onProgress, onDone, onError })
  │    └─ handleError(task, error) – retry logic with exponential backoff
  ▼
BlobDownloaderAdapter (blobDownloader.ts)
  │  download(options) → downloadFullSpeed(downloadId, options)
  │    └─ fetchWithTimeout(config, 'GET', url, headers, timeout)
  │       └─ RNFBlobUtil.config(config).fetch('GET', url, headers)
  │          ├─ .progress((received, total) => { ... })
  │          └─ .then(res => { options.onDone(res.path()) })
  │             .catch(err => { options.onError(err) })
  ▼
react-native-blob-util (native module)
  │  fetch('GET', url, headers)
  │  └─ Writes response to path (filePath in config)
  ▼
Android /data/.../Filmsnaps/ or /storage/emulated/0/Download/Filmsnaps/
```

### Component Responsibility

| Module              | Role                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------ |
| `context.tsx`       | React provider, wires Manager + Store, exposes `enqueue` and `control`               |
| `manager.ts`        | `DownloadManager` class — queue orchestration, retry, speed tracking, DB persistence |
| `blobDownloader.ts` | `BlobDownloaderAdapter` — the actual native download via RNFB                        |
| `database.ts`       | `DownloadDatabase` — SQLite CRUD for task metadata                                   |
| `adapter.ts`        | `IDownloaderAdapter` interface definition                                            |
| `types.ts`          | All shared TypeScript types (`DownloadTask`, `DownloadMeta`, etc.)                   |
| `store.ts`          | `IDownloadStore` — in-memory observable store backed by SQLite                       |
| `engine.ts`         | Legacy engine (not actively used)                                                    |
| `backgroundTask.ts` | Background fetch task (periodic resume of paused downloads)                          |
| `notifications.ts`  | `expo-notifications` wrappers for download completion/failure                        |
| `index.ts`          | Public API barrel — lazy getters for all native-dependent modules                    |

---

## 4. Problem Description

### Symptom

When a user taps "Download" on a movie/show page:

1. The task is enqueued successfully (visible in the downloads list)
2. The download briefly shows as "downloading" then transitions to "completed"
3. The file on disk is exactly **1.0 B** — not playable
4. The log shows `[Enqueue] Download URL: https://...` but **no** `[BlobDownloader]` output

### Expected Behavior

The download should:

1. Open an HTTP connection to the video URL
2. Stream content bytes to a file in `/storage/emulated/0/Download/Filmsnaps/`
3. Report progress via `onProgress` callbacks
4. On completion, verify file size > 10 KB, then mark as completed

### Logs Captured

```
[Enqueue] Download URL: https://download-falix-.../dl/.../Silo%20S03E01%20480p%20English.mkv
[Enqueue] File: Silo-480p.mkv, Server: falix, Speed limit: 0 B/s
[Manager] Starting download: https://download-falix-.../dl/.../Silo%20S03E01%20480p%20English.mkv
[Manager] File: Silo-480p.mkv, Resume: false, Path: /storage/emulated/0/Download/Filmsnaps/Silo-480p.mkv, Speed limit: 0
```

After that, no `[BlobDownloader]` line appears. The task transitions to completed with file size 1, resulting in a file that is only 1 byte.

---

## 5. Root Cause Hypotheses

### Hypothesis A — `fileCache: true` vs `path` conflict (PARTIALLY FIXED, MAY PERSIST)

In RNFB, when `fileCache: true` is set in the config AND a `path` is provided, the library ignores the `path` and writes to a temp location. The `.then()` handler in `downloadFullSpeed` calls `res.path()` which may return the temp path, but the file the user sees at the original path is 1 B (or empty).

**Evidence**: The original blobDownloader.ts had `fileCache: true` alongside a custom `path`. We changed it to `fileCache: false`. However, the `backgroundTask.ts` still had `fileCache: true` until recently.

**Status**: `fileCache: false` is now set in blobDownloader.ts, backgroundTask.ts, and all RNFB configs. But this alone didn't fix the 1.0 B issue.

### Hypothesis B — Native Module Not Fully Loaded (module.exports vs .default)

The `require('react-native-blob-util')` call returns the CommonJS module namespace, but the actual RNFB object is under `.default` (since RNFB uses `export default { ... }`). All lazy `require()` sites originally did NOT access `.default`, which would cause `RNFBlobUtil.fs` to be `undefined`.

**Evidence**: We saw the error `TypeError: Cannot read property 'dirs' of undefined` at runtime, confirming this. We added `.default` to all 4 lazy require sites.

**Status**: Just fixed. Awaiting re-test.

### Hypothesis C — Directory Not Created Before Download

If the `/Filmsnaps/` subdirectory doesn't exist and RNFB can't create parent directories when writing a file to a custom path, the write silently fails, producing a 0 or 1 B file.

**Evidence**: The `ensureParentDir()` helper exists in blobDownloader.ts but may not be executed before the RNFB `fetch()` in `downloadFullSpeed()`. The `fetchWithTimeout()` uses `Promise.race()` with a timeout — the RNFB `fetch` promise could resolve to a 1-byte error file before the directory creation completes.

**Status**: `ensureParentDir()` runs before `download()` returns, but `downloadFullSpeed()` calls `fetchWithTimeout()` which races the fetch. The fetch may complete before the directory setup.

### Hypothesis D — Download URL Not Actually Reachable / Returns 1 Byte

The URL may redirect to an error page or the server may return a 1-byte "blocked" response. The RNFB fetch would write this directly to disk.

**Evidence**: The providers work fine in the WebView player (user confirmed), but direct HTTP download from the same URL may behave differently (user-agent, referrer, cookie requirements).

**Status**: Not yet investigated at the native fetch level. No URL validation or response status checking before writing.

### Hypothesis E — `fetchWithTimeout` Always Time Out Then Resolve to Empty

The `Promise.race()` in `fetchWithTimeout` races the actual fetch against a timeout. If the timeout fires first and rejects, the outer catch in `downloadFullSpeed` throws an error. But if the RNFB fetch resolves anyway (since `Promise.race` doesn't cancel the losing promise), the `.then()` handler could fire later on a stale reference.

**Status**: Not confirmed. The actual RNFB fetch promise resolution after timeout could create race conditions.

### Hypothesis F — The `onDone` / `onError` Callbacks Are Never Called

The `downloadFullSpeed` method returns a `DownloadInstance` immediately (via `createInstance`) without waiting for the fetch to complete. The fetch `.then()` and `.catch()` handlers fire asynchronously. If they never fire (e.g., the promise stays pending), the manager's `startDownload` would wait forever on `adapter.download()` since it awaits the returned promise. But the log shows the task completes — so `onDone` must be firing.

**Status**: Contradictory — if `onDone` fires with a 1-byte file, either:

- The file at `options.filePath` only has 1 byte written by the server
- Or the file at `res.path()` (temp location) is 1 byte and that path is returned

---

## 6. Attempted Fixes

All fixes below have been applied to the codebase. The 1.0 B issue persists.

### 6.1 Database retryCount Persistence

**File**: `database.ts` — `rowToTask()` was returning `undefined` for `retryCount`, `maxRetries`, `speedLimit`, `priority`. `taskToRow()` hardcoded `retry_count: 0` and `max_retries: 3`. `update()` didn't handle `retryCount`.
**Result**: Fixed infinite "Retrying... (attempt 1)" loop. **Did not fix 1.0 B.**

### 6.2 SQLite Race Condition

**File**: `database.ts` — `getDatabase()` had concurrent callers all seeing `db === null` and all calling `openDatabaseAsync`.
**Result**: Fixed with promise-based singleton. **Did not fix 1.0 B.**

### 6.3 Notifications Deprecation

**File**: `notifications.ts` — Removed `shouldShowAlert`, kept `shouldShowBanner`/`shouldShowList`.
**Result**: Fixed deprecation warnings. **Did not fix 1.0 B.**

### 6.4 fileName/posterPath Schema Migration

**File**: `database.ts` — Added `file_name TEXT` and `poster_path TEXT` columns to SQLite schema, plus runtime migration. Updated `rowToTask` and `taskToRow` to serialize/deserialize these fields. Added them to `update()`.
**Result**: Filename corruption "Silo-480p.mkv" → "Silo" fixed. **Did not fix 1.0 B.**

### 6.5 File Extension Handling

**File**: `context.tsx`, `manager.ts`, `engine.ts` — Fixed `fileName.split('.').pop()` that returned the whole filename when no dot existed.
**Result**: Correct extension extraction. **Did not fix 1.0 B.**

### 6.6 Cross-Platform Directory Fallbacks

**File**: `manager.ts`, `engine.ts`, `backgroundTask.ts` — Replaced direct `dirs.DownloadDir` (undefined on iOS) with `DownloadDir || DocumentDir || CacheDir` fallback chain.
**Result**: iOS crash fixed. **Did not fix 1.0 B.**

### 6.7 RNFB `.default` Access on `require()`

**Files**: `engine.ts`, `manager.ts`, `blobDownloader.ts`, `backgroundTask.ts` — Changed `require('react-native-blob-util')` to `require('react-native-blob-util').default`.
**Result**: Fixed `TypeError: Cannot read property 'dirs' of undefined`. **Just applied — pending re-test.**

### 6.8 Binary Stream Encoding (ASCII → base64)

**File**: `backgroundTask.ts` — Changed `appendFileStream` from `'ascii'` to `'base64'`.
**Result**: Fixed corruption of binary video data during resume. **Not related to 1.0 B on fresh downloads.**

### 6.9 fileCache Conflict Fix

**Files**: `blobDownloader.ts`, `backgroundTask.ts` — Changed `fileCache: true` to `fileCache: false` when custom `path` is provided.
**Result**: RNFB now writes to the exact path specified. **Did not fix 1.0 B.**

### 6.10 RNFB Safety Null Guards

**File**: `manager.ts`, `blobDownloader.ts` — Added `rnfb &&` checks before accessing `.fs` in file cleanup operations.
**Result**: Prevents crashes when RNFB is null. **Did not fix 1.0 B.**

---

## 7. Current File Contents

### `apps/mobile/lib/download/adapter.ts`

```typescript
export interface DownloadOptions {
  url: string;
  filePath: string;
  headers?: Record<string, string>;
  speedLimit?: number;
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
  supportsBackground(): boolean;
  getAvailableStorage(): Promise<number>;
  destroy(): Promise<void>;
}
```

### `apps/mobile/lib/download/types.ts`

```typescript
export type DownloadStatus =
  | "pending"
  | "downloading"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type DownloadServer = "falix" | "nxsha" | "alt-dl";
export type MediaType = "movie" | "tv";

export interface DownloadMeta {
  url: string;
  fileName: string;
  server: DownloadServer;
  mediaType?: MediaType;
  tmdbId?: string;
  quality?: string;
  title?: string;
  posterPath?: string;
  season?: number;
  episode?: number;
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
}

export interface DownloadProgress {
  taskId: string;
  receivedBytes: number;
  totalBytes: number;
}

export interface StatusChange {
  taskId: string;
  status: DownloadStatus;
  error?: string;
  resumeData?: string | null;
}
```

### `apps/mobile/lib/download/blobDownloader.ts`

Full file (662 lines):

```typescript
/**
 * Blob Downloader — react-native-blob-util based download engine.
 *
 * Implements IDownloaderAdapter using RNFB. Supports:
 * - Full-speed and speed-limited (chunked) downloads
 * - True pause/resume via Range requests
 * - Cancel with file cleanup
 * - Progress tracking
 * - Background download support
 */

// @ts-ignore — react-native-blob-util types may not be available
let RNFBlobUtil: any = null;
try {
  RNFBlobUtil = require("react-native-blob-util").default;
} catch (e) {
  console.warn("[BlobDownloader] react-native-blob-util not available:", e);
}

import type {
  IDownloaderAdapter,
  DownloadOptions,
  DownloadInstance,
} from "./adapter";

// ── Constants ──

function adjustChunkSize(speedLimit: number): number {
  if (speedLimit <= 1024 * 1024) return 512 * 1024;
  if (speedLimit <= 5 * 1024 * 1024) return 1024 * 1024;
  return 2 * 1024 * 1024;
}

const MIN_VALID_FILE_SIZE = 10_240;
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const CHUNK_TIMEOUT_MS = 10 * 60 * 1000;

// ── Active Downloads Tracking ──

interface ActiveDownload {
  cancelled: boolean;
  paused: boolean;
  receivedBytes: number;
  totalBytes: number;
  options: DownloadOptions;
  fetchTask: any;
  chunkPaths: string[];
  filePath: string;
  currentOffset: number;
  chunkedMode: boolean;
}

const activeDownloads = new Map<string, ActiveDownload>();

// ── Helper: Ensure parent directory exists ──

async function ensureParentDir(filePath: string): Promise<void> {
  if (!RNFBlobUtil) return;
  const normalized = filePath.replace(/\\/g, "/");
  const lastSep = normalized.lastIndexOf("/");
  if (lastSep <= 0) return;
  const dir = normalized.substring(0, lastSep);
  try {
    const exists = await RNFBlobUtil.fs.exists(dir);
    if (!exists) {
      await RNFBlobUtil.fs.mkdir(dir);
    }
  } catch {
    // Directory creation failed — RNFB may create parents automatically
  }
}

// ── Helper: Cancel a RNFB fetch task ──

function cancelFetch(fetchTask: any): Promise<void> {
  if (fetchTask?.task?.cancel) {
    return fetchTask.task.cancel();
  }
  return Promise.resolve();
}

// ── Helper: Wrap fetch with timeout ──

function fetchWithTimeout(
  config: any,
  method: string,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): any {
  const fetchPromise = RNFBlobUtil.config(config).fetch(method, url, headers);
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("Download timed out")), timeoutMs);
  });
  return Promise.race([fetchPromise, timeoutPromise]);
}

// ── Adapter Implementation ──

export class BlobDownloaderAdapter implements IDownloaderAdapter {
  private guard(): void {
    if (!RNFBlobUtil) {
      throw new Error(
        "react-native-blob-util is not available. Ensure it is installed and " +
          "you are running a development build (not Expo Go).",
      );
    }
  }

  async download(options: DownloadOptions): Promise<DownloadInstance> {
    this.guard();
    if (!options.url || typeof options.url !== "string") {
      throw new Error("Invalid download URL");
    }
    await ensureParentDir(options.filePath);
    const speedLimit = options.speedLimit ?? 0;
    const downloadId = `dl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    if (speedLimit > 0) {
      return this.downloadChunked(downloadId, options, speedLimit);
    }
    return this.downloadFullSpeed(downloadId, options);
  }

  private async downloadFullSpeed(
    downloadId: string,
    options: DownloadOptions,
  ): Promise<DownloadInstance> {
    const config = {
      path: options.filePath,
      fileCache: false,
      addAndroidDownloads: {
        useDownloadManager: false,
        notification: false,
      },
    };

    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      ...(options.headers || {}),
    };

    console.log(
      `[BlobDownloader] Full-speed download: ${options.url.slice(0, 200)}`,
    );

    let fetchTask: any;
    try {
      fetchTask = await fetchWithTimeout(
        config,
        "GET",
        options.url,
        headers,
        DOWNLOAD_TIMEOUT_MS,
      );
    } catch (err: any) {
      throw new Error(`Download failed: ${err.message || "Unknown error"}`);
    }

    const state: ActiveDownload = {
      cancelled: false,
      paused: false,
      receivedBytes: 0,
      totalBytes: 0,
      options,
      fetchTask,
      chunkPaths: [],
      filePath: options.filePath,
      currentOffset: 0,
      chunkedMode: false,
    };
    activeDownloads.set(downloadId, state);

    // Progress
    fetchTask.progress((received: number, total: number) => {
      try {
        if (state.cancelled || state.paused) return;
        state.receivedBytes = received;
        state.totalBytes = total;
        options.onProgress?.(received, total);
      } catch {
        // Swallow progress callback errors
      }
    });

    // Completion
    fetchTask
      .then((res: any) => {
        activeDownloads.delete(downloadId);
        if (!state.cancelled && !state.paused) {
          const filePath = res.path();
          options.onDone?.(filePath);
        }
      })
      .catch((err: any) => {
        activeDownloads.delete(downloadId);
        if (!state.cancelled && !state.paused) {
          options.onError?.(new Error(err.message || "Download failed"));
        }
      });

    return this.createInstance(downloadId, state, options);
  }

  // (Chunked download methods and helpers omitted for brevity — full file is in the repo)
}
```

### `apps/mobile/lib/download/manager.ts`

Key areas — `startDownload` and file path building:

```typescript
private getDownloadsDir(): string {
  const rnfb = getRNFB();
  if (!rnfb) throw new Error('react-native-blob-util not available');
  const baseDir = rnfb.fs.dirs.DownloadDir || rnfb.fs.dirs.DocumentDir || rnfb.fs.dirs.CacheDir;
  return `${baseDir}/Filmsnaps`;
}

private buildFilePath(task: DownloadTask): string {
  const downloadsDir = this.getDownloadsDir();
  let fileName = task.fileName || 'download';
  const ext = task.extension || 'mp4';
  if (!fileName.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
    fileName = `${fileName}.${ext}`;
  }
  const safeName = fileName.replace(/[<>:"/\\|?*]/g, '_');
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

private async startDownload(task: DownloadTask): Promise<void> {
  await DownloadDatabase.update({ id: task.id, status: 'downloading' });
  this.emitStatus(task.id, 'downloading');
  await this.ensureDownloadDir();
  const filePath = this.buildFilePath(task);

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };
  if (task.resumeData) {
    const parsed = parseInt(task.resumeData, 10);
    if (!isNaN(parsed) && parsed > 0) {
      headers['Range'] = `bytes=${parsed}-`;
    }
  }

  const isResume = !!headers['Range'];
  const actualPath = isResume ? `${filePath}.resume` : filePath;
  const speedTracker = createSpeedTracker();
  this.activeSpeedTrackers.set(task.id, speedTracker);

  try {
    console.log(`[Manager] Starting download: ${task.url}`);
    console.log(`[Manager] File: ${task.fileName}, Resume: ${isResume}, Path: ${actualPath}, Speed limit: ${task.speedLimit ?? 0}`);
    const instance = await this.adapter.download({
      url: task.url,
      filePath: actualPath,
      headers,
      speedLimit: task.speedLimit ?? 0,
      onProgress: (received: number, total: number) => {
        // ... speed tracking + DB update + event emission
      },
      onDone: async (finalPath: string) => {
        // ... file validation + DB update + notification
      },
      onError: async (error: Error) => {
        // ... error handling + retry
      },
    });
    this.activeInstances.set(task.id, instance);
    this.activeTasks.set(task.id, task);
  } catch (error: any) {
    // ... error handling
  }
}
```

### `apps/mobile/lib/download/database.ts`

```typescript
// Schema with added file_name and poster_path columns
const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS downloads (
    id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL,
    media_type TEXT NOT NULL DEFAULT 'movie',
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    file_path TEXT,
    file_size INTEGER DEFAULT 0,
    downloaded_bytes INTEGER DEFAULT 0,
    progress REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued',
    priority INTEGER DEFAULT 1,
    speed_limit INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    error_message TEXT,
    error_type TEXT,
    server TEXT NOT NULL,
    quality TEXT,
    season INTEGER,
    episode INTEGER,
    extension TEXT DEFAULT 'mp4',
    resume_data TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    file_name TEXT,
    poster_path TEXT
  );
`;

// Row-to-task and task-to-row mappings handle file_name/poster_path correctly
```

### `apps/mobile/lib/download/context.tsx`

Key — extension extraction and enqueue:

```typescript
function createEnqueue(manager: DownloadManager, store: IDownloadStore) {
  return function enqueue(meta: DownloadMeta): string {
    const existing = store
      .getAll()
      .find(
        (t) =>
          t.url === meta.url &&
          t.fileName === meta.fileName &&
          !["completed", "cancelled"].includes(t.status),
      );
    if (existing) return existing.id;

    const id = generateId();
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

    console.log(`[Enqueue] Download URL: ${meta.url}`);
    console.log(
      `[Enqueue] File: ${meta.fileName}, Server: ${meta.server}, Speed limit: ${meta.speedLimit ?? 0} B/s`,
    );

    store.upsert(task);
    manager.add(task).catch((err) => {
      console.error("[Enqueue] manager.add failed:", err);
      const current = store.getById(id);
      if (current && current.status === "pending") {
        store.upsert({
          ...current,
          status: "failed",
          error: err?.message || "Failed to enqueue",
        });
      }
    });
    return id;
  };
}
```

### `apps/mobile/lib/download/notifications.ts`

```typescript
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});
```

### `apps/mobile/lib/download/store.ts`

Full in-memory store backed by SQLite with AsyncStorage fallback. Key operations: `upsert()` writes to SQLite then updates in-memory array; `load()` reads from SQLite; `persistAll()` batch-updates SQLite.

### `apps/mobile/lib/download/engine.ts`

Legacy module — no longer actively used for new downloads but re-exported from `index.ts`. Uses lazy `require().default` for RNFB.

### `apps/mobile/lib/download/backgroundTask.ts`

Background fetch module — uses TaskManager + BackgroundFetch. Configures downloads with `fileCache: false` and `base64` streams. Uses the same `DownloadDir || DocumentDir || CacheDir` fallback.

### `apps/mobile/lib/download/index.ts`

Public barrel — lazy getters (`getDownloadDatabase()`, `getDownloadManager()`, etc.) and static re-exports (`createDownloadEngine` from `engine.ts`).

### `apps/mobile/lib/download/useDownloadList.ts`

```
export function useDownloadList() {
  // Subscribes to store via useSyncExternalStore
  // Groups tasks by status: all, active, paused, completed, failed, cancelled
}
```

### `apps/mobile/lib/download/useDownload.ts`

```
export function useDownload(taskId: string | undefined) {
  // Single-task hook with pause/resume/cancel/retry/remove
  // All actions delegated to DownloadManager
}
```

### `apps/mobile/lib/download/useEpisodeDownloads.ts`

```
export function useEpisodeDownloads(tmdbId: string, season?: number) {
  // Batch operations for TV episodes: startAll, pauseAll, cancelAll, resumeAll
}
```

### `apps/mobile/lib/download/useDownloadQueue.ts`

```
export function useDownloadQueue(config?: QueueConfig) {
  // Monitors activeCount and queuedCount via manager.onQueueChange
}
```

---

## 8. Implementation Flow Trace

Here is the exact path a download request follows, with all relevant code paths:

1. **UI** calls `enqueue({ url, fileName, server, ... })`

2. **`context.tsx` — `createEnqueue`**:
   - Deduplicates by URL + fileName
   - Generates `id = dl_<timestamp>_<random>`
   - Extracts extension via `fileName.split('.').pop()` (now fixed to only pop when there's a dot)
   - Creates `DownloadTask` with `status: 'pending'`
   - Calls `store.upsert(task)` — writes to SQLite
   - Calls `manager.add(task)` — adds to queue

3. **`manager.ts` — `add`**:
   - Checks for duplicates in SQLite
   - Calls `DownloadDatabase.insert(task)` — persists to SQLite
   - Adds `task.id` to `this.queue`
   - Calls `this.processQueue()`

4. **`manager.ts` — `processQueue`**:
   - While `activeInstances.size < maxConcurrent`:
     - Reads task from SQLite via `DownloadDatabase.getById(taskId)`
     - Calls `setImmediate(() => this.startDownload(task!))`

5. **`manager.ts` — `startDownload`**:
   - Updates status to `'downloading'` in SQLite
   - Calls `this.ensureDownloadDir()` — creates Filmsnaps/ directory
   - Calls `this.buildFilePath(task)` — constructs full path
   - Calls `this.adapter.download({ url, filePath, headers, onProgress, onDone, onError })`

6. **`blobDownloader.ts` — `download`**:
   - Calls `this.guard()` — checks RNFBlobUtil is not null
   - Calls `ensureParentDir(options.filePath)` — creates parent directory
   - Delegates to `downloadFullSpeed()`

7. **`blobDownloader.ts` — `downloadFullSpeed`**:
   - Builds RNFB config with `path: options.filePath, fileCache: false`
   - Calls `fetchWithTimeout(config, 'GET', url, headers, timeout)`:
     - `RNFBlobUtil.config(config).fetch('GET', url, headers)`
     - Raced against a `setTimeout` rejection
   - On fetch resolve:
     - Attaches `.progress()` for progress callbacks
     - Returns `this.createInstance()` (the DownloadInstance)
   - `.then()` fires async: calls `res.path()`, then `options.onDone(path)`
   - `.catch()` fires async: calls `options.onError(err)`

8. **`manager.ts` — `startDownload` continues**:
   - `await instance` resolves (the instance, not the fetch result — because `download()` returns `createInstance()` which is NOT a promise-wrapped fetch)
   - Stores instance in `this.activeInstances`
   - **The fetch is still in-flight** at this point
   - When `onDone` fires, file validation runs via `getRNFB().fs.stat(resolvedPath)`
   - If size < 10240, marks as failed with "Server returned invalid response"

---

## 9. Questions for the Expert

### 9.1 The Core Mystery

Why does RNFB write only 1 byte to the designated file path when we provide `fileCache: false` and an explicit `path`?

**Suspicion**: The RNFB fetch resolves with `res.path()` pointing to a temp file (because even with `fileCache: false`, RNFB may write to an intermediary location), while only 1 byte was written to the `path` we configured.

### 9.2 Requested Code Fix / Implementation

Please provide the exact code changes needed to fix the 1.0 B file size issue. Specifically:

1. **Is the `fetchWithTimeout` pattern with `Promise.race` causing problems?** Should we remove the timeout and rely on RNFB's own timeout, or use a different timeout pattern?

2. **Should we validate the HTTP response status code before treating the file as downloaded?** Currently `downloadFullSpeed` doesn't check the response's `respInfo.status` — it assumes success. A 403, 404, or redirect to an error page would be written as a valid file.

3. **Is the directory creation happening early enough?** The flow is:

   ```
   manager.ts: ensureDownloadDir() → adapter.download() → ensureParentDir() → fetchWithTimeout()
   ```

   Is there a risk that the fetch resolves before the parent directory exists?

4. **Should the `download` method wait for the actual fetch completion before resolving?** Currently `downloadFullSpeed()` returns immediately after calling `fetchTask.progress()` and setting up `fetchTask.then()`. The actual download completes asynchronously. Could this cause a race where `manager.ts` marks the task completed before the file is fully written?

5. **Is there a known issue with RNFB v0.17.3 where `fileCache: false` + `path` produces a 1-byte file?** If so, what is the workaround?

6. **Should we verify that the download URL's host is reachable before passing to RNFB?** Could the URL require a specific `Referer` header, cookie, or TLS configuration that RNFB's native HTTP client doesn't send?

7. **What is the correct way to download a large binary file (500 MB - 2 GB MKV/MP4) to a specific path using RNFB?** Provide a minimal, proven code snippet.

### 9.3 Additional Diagnostics Needed

Tell us what additional diagnostics to add (specific console.log statements, error checks, or file system probes) to determine exactly where the 1-byte file is created and whether the RNFB fetch is receiving a valid response stream.

---

## 10. Files Summary

| File                   | Path                                              | Lines | Status                             |
| ---------------------- | ------------------------------------------------- | ----- | ---------------------------------- |
| adapter.ts             | `apps/mobile/lib/download/adapter.ts`             | 47    | Stable — interface definition      |
| types.ts               | `apps/mobile/lib/download/types.ts`               | 110   | Stable — type definitions          |
| blobDownloader.ts      | `apps/mobile/lib/download/blobDownloader.ts`      | 662   | Buggy — core of the 1.0 B issue    |
| manager.ts             | `apps/mobile/lib/download/manager.ts`             | ~710  | Stable — many fixes applied        |
| database.ts            | `apps/mobile/lib/download/database.ts`            | 354   | Stable — schema + migrations fixed |
| context.tsx            | `apps/mobile/lib/download/context.tsx`            | ~200  | Stable — enqueue + provider wiring |
| store.ts               | `apps/mobile/lib/download/store.ts`               | 392   | Stable — in-memory + SQLite        |
| engine.ts              | `apps/mobile/lib/download/engine.ts`              | ~300  | Legacy — not actively used         |
| backgroundTask.ts      | `apps/mobile/lib/download/backgroundTask.ts`      | 366   | Stable — encoding + paths fixed    |
| notifications.ts       | `apps/mobile/lib/download/notifications.ts`       | 143   | Stable — deprecations fixed        |
| index.ts               | `apps/mobile/lib/download/index.ts`               | 123   | Stable — barrel exports            |
| useDownloadList.ts     | `apps/mobile/lib/download/useDownloadList.ts`     | 77    | Stable — hook                      |
| useDownload.ts         | `apps/mobile/lib/download/useDownload.ts`         | 71    | Stable — hook                      |
| useDownloadQueue.ts    | `apps/mobile/lib/download/useDownloadQueue.ts`    | 45    | Stable — hook                      |
| useEpisodeDownloads.ts | `apps/mobile/lib/download/useEpisodeDownloads.ts` | 122   | Stable — hook                      |

---

_Generated for Filmsnaps download system expert consultation. All code paths and fixes current as of this writing._
