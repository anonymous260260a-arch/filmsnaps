# Filmsnaps Download System — Expert Consultation Document

---

## ⚠️ Critical: App Crashes When Starting a Download

**The app crashes immediately when the user taps "Download" on any media item.** We need your expert analysis and exact implementation code to fix this.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Full Code Listing](#2-full-code-listing)
3. [Root Cause Analysis](#3-root-cause-analysis)
4. [Dependency Versions](#4-dependency-versions)
5. [Questions for Expert](#5-questions-for-expert)

---

## 1. Architecture Overview

### Dual Download Engine Problem

The download system has **TWO competing implementations**:

| Component                        | File                | Status                        | Role                                    |
| -------------------------------- | ------------------- | ----------------------------- | --------------------------------------- |
| **OLD** `createDownloadEngine()` | `engine.ts`         | Exported but "no longer used" | Legacy — uses RNFB directly             |
| **NEW** `DownloadManager`        | `manager.ts`        | Active orchestrator           | Queue + retry + SQLite + speed limiting |
| **NEW** `BlobDownloaderAdapter`  | `blobDownloader.ts` | Active adapter                | Actual byte-level download via RNFB     |

The old engine (`engine.ts`) is still **exported** from `index.ts` ("kept for backward compatibility only") but the new `DownloadManager` is supposed to be the sole orchestrator. The old engine has **different file path construction** which means files started with one engine won't be found by the other.

### Data Flow

```
UI (DownloadSheet, etc.)
    ↓ enqueue()
context.tsx (DownloadInfraProvider)
    ├── store.upsert() → synchronously updates React hooks
    └── manager.add() → starts download lifecycle
            ↓
    DownloadManager (manager.ts)
        ├── processQueue() → manages concurrent slots (max 3)
        ├── startDownload() → builds Range headers, manages .resume files
        └── handleError() → categorized retry with backoff
            ↓
    BlobDownloaderAdapter (blobDownloader.ts)
        ├── downloadFullSpeed() → single RNFB fetch with .progress()
        └── downloadChunked() → sequential Range requests for speed limiting
            ↓
    react-native-blob-util (RNFB)
        └── Native Android/iOS download
```

### State Management

```
SQLite (expo-sqlite)
    ↑↓
DownloadDatabase (database.ts)
    ↑↓
IDownloadStore (store.ts) — in-memory + async DB write
    ↑↓
useSyncExternalStore → useDownloadList / useDownload
```

### File Path Construction

| Component        | Path Template                                              | Example                   |
| ---------------- | ---------------------------------------------------------- | ------------------------- |
| OLD `engine.ts`  | `{DownloadDir}/Filmsnaps/{safeName}.{ext}`                 | `.../Filmsnaps/movie.mp4` |
| NEW `manager.ts` | `{DownloadDir}/Filmsnaps/{safeName}` (adds ext internally) | `.../Filmsnaps/movie.mp4` |

Both use `react-native-blob-util.fs.dirs.DownloadDir` as base.

### Resume Architecture

- **Pause**: Cancel native fetch, save `receivedBytes` as `resumeData` → `Range: bytes=N-` header
- **Resume**: Validate partial file on disk, download remaining bytes to `.resume` temp file, merge into original
- **Lazy merge**: `.resume` files merged into original during `startDownload()` (not during pause — keeps pause fast)

### Notification Architecture

- Uses `expo-notifications` with `setNotificationHandler()` at module scope (import-time side effect)
- Progress updates throttled to 10s intervals
- `showCompleted` bug: uses `filePath` as Map key instead of `taskId` for clearing progress tracking

---

## 2. Full Code Listing

### 2.1 File Manifest

| #   | File Path                                         | Lines | Purpose                                         |
| --- | ------------------------------------------------- | ----- | ----------------------------------------------- |
| 1   | `apps/mobile/lib/download/types.ts`               | 112   | Core type definitions                           |
| 2   | `apps/mobile/lib/download/database.ts`            | 473   | SQLite persistence layer                        |
| 3   | `apps/mobile/lib/download/adapter.ts`             | 49    | DownloaderAdapter interface                     |
| 4   | `apps/mobile/lib/download/blobDownloader.ts`      | 707   | RNFB download adapter (IDownloaderAdapter impl) |
| 5   | `apps/mobile/lib/download/engine.ts`              | 559   | Legacy engine (OLD)                             |
| 6   | `apps/mobile/lib/download/manager.ts`             | 1370  | DownloadManager (NEW orchestrator)              |
| 7   | `apps/mobile/lib/download/store.ts`               | 448   | Observable in-memory store + SQLite persistence |
| 8   | `apps/mobile/lib/download/context.tsx`            | 454   | React Provider wiring                           |
| 9   | `apps/mobile/lib/download/notifications.ts`       | 144   | Download notification handling                  |
| 10  | `apps/mobile/lib/download/index.ts`               | 145   | Public API exports                              |
| 11  | `apps/mobile/lib/download/useDownloadList.ts`     | 93    | Hook: all downloads grouped                     |
| 12  | `apps/mobile/lib/download/useDownload.ts`         | 154   | Hook: single task + lifecycle                   |
| 13  | `apps/mobile/lib/download/useDownloadQueue.ts`    | 50    | Hook: queue monitor                             |
| 14  | `apps/mobile/lib/download/useEpisodeDownloads.ts` | 141   | Hook: season batch operations                   |
| 15  | `apps/mobile/lib/download/backgroundTask.ts`      | 33    | Legacy stub                                     |
| 16  | `apps/mobile/components/DownloadSheet.tsx`        | 367   | Source selection bottom sheet                   |
| 17  | `apps/mobile/components/DownloadBanner.tsx`       | 398   | Floating banner pill                            |
| 18  | `apps/mobile/components/DownloadToast.tsx`        | 332   | Global toast overlay                            |
| 19  | `apps/mobile/app/download/nxsha/[...id].tsx`      | 1356  | Nxsha download page                             |
| 20  | `apps/mobile/app/downloads.tsx`                   | 859   | Downloads page                                  |

---

### 2.2 types.ts — Core Type Definitions

```typescript
// apps/mobile/lib/download/types.ts (112 lines)

export type DownloadStatus =
  | "pending" // Created, waiting for a queue slot
  | "downloading" // Actively downloading bytes
  | "paused" // Paused with resumeData saved for true resume
  | "completed" // Finished successfully
  | "failed" // Finished with error
  | "cancelled" // User-cancelled, partial file cleaned
  | "retrying"; // In retry backoff — will auto-resume

export type DownloadServer = "falix" | "nxsha" | "alt-dl";
export type MediaType = "movie" | "tv";

/** What callers provide when enqueuing a download */
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
  /** Speed limit in bytes per second (0 = unlimited) */
  speedLimit?: number;
}

/** Full task record — persisted and observable */
export interface DownloadTask extends DownloadMeta {
  id: string;
  fileUri: string | null;
  totalBytes: number;
  receivedBytes: number;
  status: DownloadStatus;
  error?: string;
  /** Opaque token for true byte-level resume */
  resumeData?: string | null;
  createdAt: number;
  updatedAt: number;
  /** Priority: 0=high, 1=medium, 2=low */
  priority?: number;
  /** Current retry count */
  retryCount?: number;
  /** Maximum retries allowed */
  maxRetries?: number;
}

/** Control action for batch operations */
export type ControlAction = "pause" | "resume" | "cancel" | "retry" | "remove";

/** Target for batch control — single ID, array, or status filter */
export type ControlTarget =
  | string
  | string[]
  | { status?: DownloadStatus | DownloadStatus[] };

/** Progress event payload */
export interface DownloadProgress {
  taskId: string;
  receivedBytes: number;
  totalBytes: number;
}

/** Status change event payload */
export interface StatusChange {
  taskId: string;
  status: DownloadStatus;
  error?: string;
  resumeData?: string | null;
}

/** Aggregate progress for batch operations */
export interface AggregateProgress {
  totalBytes: number;
  receivedBytes: number;
  fraction: number;
  activeCount: number;
  totalCount: number;
  completedCount: number;
}

/** Grouped download state for the list hook */
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

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
```

### 2.3 database.ts — SQLite Persistence

```typescript
// apps/mobile/lib/download/database.ts (473 lines)
// Uses expo-sqlite with lazy initialization

import * as SQLite from "expo-sqlite";
import type { DownloadTask, DownloadStatus } from "./types";

// Database initialization with singleton + retry
let db: SQLite.SQLiteDatabase | null = null;
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    try {
      const database = await SQLite.openDatabaseAsync("filmsnaps_downloads.db");
      await initializeDatabase(database);
      db = database;
      return database;
    } catch (e) {
      dbPromise = null; // Reset so next call retries
      throw e;
    }
  })();
  return dbPromise;
}

// Schema: 26 columns
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

// rowToTask — coerces types from SQLite (which can return INTEGER as TEXT)
function rowToTask(row: DownloadRow): DownloadTask {
  return {
    // ...
    totalBytes: Number(row.file_size) || 0,
    receivedBytes: Number(row.downloaded_bytes) || 0,
    status: row.status as DownloadStatus,
    resumeData: row.resume_data != null ? String(row.resume_data) : null,  // CRITICAL: force string
    // ...
  };
}

// taskToRow — maps DownloadTask to DB row
function taskToRow(task: DownloadTask): DownloadRow {
  return {
    // ...
    file_size: task.totalBytes,
    downloaded_bytes: task.receivedBytes,
    resume_data: task.resumeData ?? null,
    // ...
  };
}

// Key methods:
export const DownloadDatabase = {
  async insert(task: DownloadTask): Promise<void> { /* INSERT OR REPLACE */ },
  async update(task: Partial<DownloadTask> & { id: string }): Promise<void> {
    // Dynamic SET with conditional fields
    // CRITICAL: resume_data is always String() coerced
  },
  async getById(id: string): Promise<DownloadTask | null>,
  async getAll(): Promise<DownloadTask[]>,
  async getByStatus(status: DownloadStatus): Promise<DownloadTask[]>,
  async getByMediaId(mediaId: string): Promise<DownloadTask[]>,
  async getBySeason(mediaId: string, season: number): Promise<DownloadTask[]>,
  async delete(id: string): Promise<void>,
  async deleteCompleted(): Promise<void>,
  async deleteCancelled(): Promise<void>,
  async getCountByStatus(status: DownloadStatus): Promise<number>,
  async getStorageUsed(): Promise<number>,
  async recoverStaleTasks(): Promise<number>,  // Marks active/pending → paused
  async close(): Promise<void>,
};
```

### 2.4 adapter.ts — IDownloaderAdapter Interface

```typescript
// apps/mobile/lib/download/adapter.ts (49 lines)

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
  supportsBackground(): boolean;
  getAvailableStorage(): Promise<number>;
  destroy(): Promise<void>;
}
```

### 2.5 blobDownloader.ts — BlobDownloaderAdapter

```typescript
// apps/mobile/lib/download/blobDownloader.ts (707 lines)
// Main adapter implementing IDownloaderAdapter

// Lazy-loaded RNFB
let RNFBlobUtil: any = null;
try {
  RNFBlobUtil = require("react-native-blob-util").default;
} catch (e) {
  console.warn("[BlobDownloader] react-native-blob-util not available:", e);
}

// ════════════════════════════════════════════════════════════════════
// CRITICAL: toSafeNumber() — RNFB on Android passes bridge values as STRINGS
// Without this, "+" concatenates and "<" does lexicographic comparison
// ════════════════════════════════════════════════════════════════════
function toSafeNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export class BlobDownloaderAdapter implements IDownloaderAdapter {
  // Entry: speed limit check → full-speed or chunked mode
  async download(options: DownloadOptions): Promise<DownloadInstance> {
    this.guard();
    // ...
    if (speedLimit > 0)
      return this.downloadChunked(downloadId, options, speedLimit);
    return this.downloadFullSpeed(downloadId, options);
  }

  // Full-speed mode: single RNFB fetch with .progress()
  private async downloadFullSpeed(
    downloadId: string,
    options: DownloadOptions,
  ): Promise<DownloadInstance> {
    const config = { path: options.filePath, fileCache: false };
    const fetchTask = RNFBlobUtil.config(config).fetch(
      "GET",
      options.url,
      headers,
    );

    // Progress handler with toSafeNumber()
    fetchTask.progress((rawReceived: unknown, rawTotal: unknown) => {
      const received = toSafeNumber(rawReceived, 0);
      const total = toSafeNumber(rawTotal, 0);
      // ...
      options.onProgress?.(received, total);
    });

    // Then: handle completion, path mismatch (res.path() vs options.filePath),
    // HTTP status validation, etc.
  }

  // Speed-limited mode: sequential Range requests with artificial delay
  private async downloadChunked(
    downloadId: string,
    options: DownloadOptions,
    speedLimit: number,
  ): Promise<DownloadInstance> {
    // Probe with Range: bytes=0-0, parse Content-Range for total size
    // Download in chunks of 512KB-2MB (based on speedLimit)
    // After each chunk, calculate elapsed vs target time, insert delay if needed
  }

  // File stream append (256KB chunks for non-chunked mode)
  private async appendFileStream(
    sourcePath: string,
    targetPath: string,
  ): Promise<void> {
    // readStream → writeStream in 256KB base64 chunks
  }

  // DownloadInstance factory
  private createInstance(
    downloadId: string,
    state: ActiveDownload,
    options: DownloadOptions,
  ): DownloadInstance {
    return {
      id: downloadId,
      pause: async () => {
        /* set state.paused=true, cancel fetch */
      },
      resume: async () => {
        /* set state.paused=false, state.cancelled=false */
      },
      cancel: async () => {
        /* set state.cancelled=true, cleanup chunks + file */
      },
    };
  }
}
```

### 2.6 engine.ts — Legacy Engine (OLD)

```typescript
// apps/mobile/lib/download/engine.ts (559 lines)
// NOTE: This is the OLD engine, "no longer used" but still exported

// Different directory construction:
function getDownloadDir(): string {
  const baseDir =
    ReactNativeBlobUtil.fs.dirs.DownloadDir ||
    ReactNativeBlobUtil.fs.dirs.DocumentDir ||
    ReactNativeBlobUtil.fs.dirs.CacheDir;
  return `${baseDir}/Filmsnaps/`; // ← trailing slash!
}

// Different file URI construction:
function buildFileUri(task: DownloadTask): string {
  const dir = getDownloadDir();
  // Builds: {dir}{safeName}.{ext}
  // But the new manager builds it differently
}

// Uses start()/pause()/cancel() instead of download()/pause()/cancel()
// Has its OWN state management (starting Set, finished Set, states Map)
// Has its OWN progress emission system
// Has its OWN file path logic
// Does NOT use toSafeNumber() — raw values from RNFB
```

### 2.7 manager.ts — DownloadManager (NEW Orchestrator)

```typescript
// apps/mobile/lib/download/manager.ts (1370 lines)
// THE SOLE ORCHESTRATOR (claims to be)

// Key components:
// - SerialQueue: per-task ordered DB write queue (prevents lost-update races)
// - SpeedTracker: EMA-smoothed speed tracking (alpha=0.3)
// - Live byte counters (liveReceivedBytes, liveTotalBytes) for atomic pause
// - sanitizeResumeData(): validates/normalizes resumeData to prevent corruption
// - categorizeError(): classifies errors into DownloadErrorCode enum
// - Retry with exponential backoff: [5s, 15s, 60s], max 3 retries
// - Foreground service auto-start/stop via react-native-background-actions
// - Lazy file merge: .resume merged into original during startDownload()

// CRITICAL toSafeNumber():
function toSafeNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

// CRITICAL sanitizeResumeData():
function sanitizeResumeData(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value);
  if (!/^\d+$/.test(str)) return null; // Must be purely numeric
  const num = parseInt(str, 10);
  if (isNaN(num) || num <= 0) return null;
  if (num > 50 * 1024 * 1024 * 1024) return null; // >50GB sanity check
  return String(num);
}

export class DownloadManager {
  private adapter: IDownloaderAdapter;
  private activeInstances = new Map<string, DownloadInstance>();
  private activeTasks = new Map<string, DownloadTask>();
  private activeSpeedTrackers = new Map<string, SpeedTracker>();
  private liveReceivedBytes = new Map<string, number>();
  private liveTotalBytes = new Map<string, number>();
  private queue: string[] = [];
  private pausingTasks = new Set<string>();

  // ─── ADD ───
  async add(task: DownloadTask): Promise<string> {
    // Check duplicates by media_id + url + status
    // Insert to DB
    // Enqueue task ID
    // Notify queue change → processQueue()
  }

  // ─── PAUSE (uses live in-memory byte count, not stale DB) ───
  async pause(taskId: string): Promise<void> {
    // Mutex: one pause per task at a time
    // Read liveReceivedBytes (always current)
    // Cancel native download instance
    // Stat bytes physically on disk (source of truth)
    // Save via SerialQueue to DB
    // Emit status
  }

  // ─── RESUME ───
  async resume(taskId: string): Promise<void> {
    // Validate task exists and is paused/failed
    // Sanitize resumeData
    // Validate partial file on disk
    // Update DB → pending
    // Process queue
  }

  // ─── CANCEL ───
  async cancel(taskId: string): Promise<void> {
    // Cancel instance, cleanup files, update DB
  }

  // ─── PROCESS QUEUE (main loop) ───
  private async processQueue(): Promise<void> {
    // Guard: if already processing, return
    // Start foreground service if needed
    // While queue has items AND active < maxConcurrent:
    //   dequeue task ID
    //   read fresh from DB
    //   startDownload(task)
  }

  // ─── START DOWNLOAD ───
  private async startDownload(task: DownloadTask): Promise<void> {
    // Update DB status → downloading
    // Build file path + headers
    // LAZY MERGE: if .resume file exists, merge into original
    // Initialize speed tracker + live byte counters
    // Call adapter.download() with:
    //   onProgress: update live counters, emit progress, throttled DB write (2s)
    //   onDone: validate file size, merge .resume, update DB → completed
    //   onError: handle retry with backoff
    // Save instance to activeInstances
  }

  // ─── BUILD FILE PATH ───
  private buildFilePath(task: DownloadTask): string {
    const downloadsDir = this.getDownloadsDir();
    // {DownloadDir}/Filmsnaps/{safeName}.{ext}
  }
}
```

### 2.8 store.ts — Observable Store

```typescript
// apps/mobile/lib/download/store.ts (448 lines)
// Synchronous in-memory store + async SQLite persistence

export function createDownloadStore(adapter?: StorageAdapter): IDownloadStore {
  let tasks: DownloadTask[] = [];
  let loaded = false;
  // Listeners: all, per-task, loaded-state

  return {
    getAll(): DownloadTask[] { return tasks; },
    getById(id: string): DownloadTask | undefined,
    getByMedia(tmdbId: string, server?: string): DownloadTask[],
    getBySeason(tmdbId: string, season: number): DownloadTask[],

    async upsert(task: DownloadTask): Promise<void> {
      // STEP 1: Synchronous in-memory update (immediate React notification)
      // STEP 2: Async DB persistence (fire-and-forget)
      // CRITICAL: resumeData is always String() coerced to prevent type corruption
    },

    async load(): Promise<DownloadTask[]> {
      // Read from SQLite
      // Mark active/pending → paused ("App was closed. Tap resume to continue.")
      // Fallback to AsyncStorage for migration
    },

    subscribe, subscribeTask, subscribeLoaded, // useSyncExternalStore compatible
  };
}
```

### 2.9 context.tsx — React Provider

```typescript
// apps/mobile/lib/download/context.tsx (454 lines)
// Wires manager ↔ store ↔ notifications

export function DownloadInfraProvider({ children, storeOverride }) {
  // Creates singleton manager + store in useRef
  // Loads persisted state on mount
  // Wires manager events → store mutations + notifications
  //   - TIERED PROGRESS: O(1) event → 250ms flush → 2s DB write
  //   - Status events → in-app toasts + native notifications
  // ─── NOTIFICATION PERMISSION (BUG!) ───
  // The requestPermissionPrimer() is called on every first enqueue per session.
  // It does NOT persist denial across app restarts:
  // - On iOS: requestPermissionsAsync() shows dialog again even after denial
  // - On Android: does not check canAskAgain
  // - No AsyncStorage flag to remember permanent denial
}
```

### 2.10 notifications.ts — Download Notifications

```typescript
// apps/mobile/lib/download/notifications.ts (144 lines)
// Uses expo-notifications

// ⚠️ MODULE-LEVEL SIDE EFFECT — runs on import!
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

export const DownloadNotifications = {
  async requestPermissions(): Promise<boolean> {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    return finalStatus === "granted";
  },

  // ⚠️ BUG: Uses filePath as Map key instead of taskId
  async showCompleted(title: string, filePath: string): Promise<void> {
    lastProgressUpdate.delete(filePath);  // ← Should be taskId!
    await Notifications.scheduleNotificationAsync({...});
  },
};
```

### 2.11 hooks (useDownloadList, useDownload, etc.)

```typescript
// useDownloadList.ts — useSyncExternalStore + grouping
export function useDownloadList(): DownloadGrouped & { loaded; control } {
  const { store, control } = useDownloadInfra();
  const tasks = useSyncExternalStore(
    (cb) => store.subscribe(() => cb()),
    () => store.getAll(),
  );
  // Groups: all, active, paused, completed, failed, cancelled, retrying
}

// useDownload.ts — single task with lifecycle controls
// Uses actionPendingRef for debounce guard
// Delegates pause/resume/cancel/retry/remove to manager

// useDownloadQueue.ts — monitors queue state via manager.onQueueChange
// useEpisodeDownloads.ts — season batch operations with aggregate progress
```

### 2.12 Component Files (DownloadSheet, DownloadBanner, DownloadToast, downloads page, nxsha page)

- **[DownloadSheet.tsx](apps/mobile/components/DownloadSheet.tsx)** — Modal bottom sheet for source selection, calls `useDownloadInfra()` → `enqueue()`
- **[DownloadBanner.tsx](apps/mobile/components/DownloadBanner.tsx)** — Floating animated pill above tab bar showing download status
- **[DownloadToast.tsx](apps/mobile/components/DownloadToast.tsx)** — Singleton toast emitter for download events
- **[downloads.tsx](apps/mobile/app/downloads.tsx)** — Full download manager screen with task rows, speed/ETA, grouped sections
- **[nxsha/[...id].tsx](apps/mobile/app/download/nxsha/[...id].tsx)** — WebView-based link extraction + CAPTCHA solver for Nxsha source

### 2.13 index.ts — Public API Exports

```typescript
// apps/mobile/lib/download/index.ts (145 lines)

// Infrastructure
export { DownloadInfraProvider, useDownloadInfra } from "./context";
export { DownloadManager } from "./manager";

// Lazy getters (to avoid native module crash at bundle time)
export function getDownloadDatabase() {
  return require("./database").DownloadDatabase;
}
export function getDownloadManager() {
  return require("./manager").DownloadManager;
}
export function getBlobDownloaderAdapter() {
  return require("./blobDownloader").BlobDownloaderAdapter;
}
export function getDownloadNotifications() {
  return require("./notifications").DownloadNotifications;
}

// Factory
export function createDownloadManager(config?) {
  /* creates adapter + manager */
}

// Hooks
export {
  useDownloadList,
  formatBytes,
  formatDate,
  serverLabel,
} from "./useDownloadList";
export { useDownload } from "./useDownload";
export { useEpisodeDownloads } from "./useEpisodeDownloads";
export { useDownloadQueue } from "./useDownloadQueue";

// ⚠️ LEGACY ENGINE STILL EXPORTED:
export { createDownloadEngine } from "./engine"; // ← Comment says "kept for backward compatibility only"
```

---

## 3. Root Cause Analysis

### Crash Cause #1: RNFB Bridge String Coercion (CRITICAL)

**Symptoms**: `resumeData` becomes astronomically large (e.g. `95236469603970` = `"9523646" + "9603970"` — string concatenation). Arithmetic produces NaN. Comparisons (<) do lexicographic comparison.

**Root Cause**: On Android, `react-native-blob-util` passes progress values as **strings** through the native-to-JS bridge. Without immediate coercion to numbers:

- `+` does string concatenation: `9802174 + "9885446"` → `"98021749885446"` (not `19687620`)
- `<` does lexicographic comparison: `"10MB" < "9MB"` → `true` (because "1" < "9")
- `-` works (forces number coercion) but creates NaN when combined with concatenated values

**Affected File**: `blobDownloader.ts` — the `.progress()` callback receives raw values from RNFB:

```typescript
fetchTask.progress((rawReceived: unknown, rawTotal: unknown) => {
  // Without toSafeNumber():
  //   rawReceived could be "9802174" (string!)
  //   rawTotal could be "9885446" (string!)
  //   received + total → "98021749885446" (concatenation!)
  //   received < total → false (because string comparison "9" < "9"? actually
  //                     JavaScript's Abstract Equality Comparison is weird)
});
```

**Current fix**: `toSafeNumber()` is implemented in both `blobDownloader.ts` and `manager.ts`, but **not all call sites are covered**. The progress handler in `blobDownloader.ts` lines 201-240 does use it, but we need to audit every place RNFB values are read.

### Crash Cause #2: Dual Path Construction

**Symptoms**: Download starts fine, but after pause/restart, the .resume file is not found. Resume silently starts from 0 instead of the paused offset. If the Range header misaligns, the merged file corrupts.

**Root Cause**: Two different path-building functions exist:

- `engine.ts` → `getDownloadDir()` returns `{DownloadDir}/Filmsnaps/` (with trailing slash)
- `manager.ts` → `getDownloadsDir()` returns `{DownloadDir}/Filmsnaps` (no trailing slash)

The `buildFileUri()` in engine.ts differs from `buildFilePath()` in manager.ts.

**Impact**: If code paths from both engines are somehow triggered, the same download ends up at different paths. After app restart, the new manager reads from its path, doesn't find the file, and starts fresh.

### Crash Cause #3: Stale resumeData on Pause

**Symptoms**: After pausing a download, `resumeData` contains a value that's ~9.5MB instead of the actual ~33.9MB received. On resume, the server sends bytes from byte 9.5M, but the file already has 33.9M of data. The merged file has a 24.4MB corrupted section.

**Root Cause**: The `pause()` method reads `receivedBytes` from SQLite, but the last DB write was throttled to 2 seconds ago (the 2s interval in `startDownload`'s progress handler). The in-memory `maxReceivedSeen` variable is a **local variable** inside `startDownload()` — inaccessible to `pause()`. The speed tracker is also local.

**Current fix**: Live byte counters (`this.liveReceivedBytes`, `this.liveTotalBytes`) were added as class-level Maps in `manager.ts`. `pause()` now reads from these first, falling back to DB. But we need to verify this works in all edge cases (rapid pause/resume, crash during write, etc.).

### Crash Cause #4: Missing `fileUri` on First Task Creation

**Symptoms**: If the app crashes during a download (before completion), `fileUri` is `null`. On restart, the store tries to find the partial file at `fileUri` which is `null`, so it can't resume.

**Root Cause**: `enqueue()` in `context.tsx` creates tasks with `fileUri: null`:

```typescript
const task: DownloadTask = {
  ...meta,
  id,
  fileUri: null, // ← Only set after download completes!
  totalBytes: 0,
  receivedBytes: 0,
  status: "pending",
  // ...
};
```

**Current mitigation**: `buildFilePath()` in `manager.ts` calculates the path at resume time (during `startDownload()`), so it no longer relies on stored `fileUri`. But the store's `load()` method sets active/pending tasks to paused with a message. The DB row's `file_path` is null, so the recovery has no reference to the partial file location.

### Crash Cause #5: Notification Module-Level Side Effects

**Symptoms**: On cold start, if `expo-notifications` has a native module issue, the entire app crashes at bundle evaluation time — before any screen renders.

**Root Cause**: `notifications.ts` has a module-level call:

```typescript
Notifications.setNotificationHandler({...}); // ← Runs on import!
```

This means ANY static import of `notifications.ts` triggers a native module call at bundle time. If the native module isn't ready, the app crashes during the JavaScript bundle evaluation.

**Current mitigation**: Lazy getters exist in `index.ts` (`getDownloadNotifications()`). The `DownloadInfraProvider` doesn't import `notifications.ts` statically — it uses the lazy getter. But we need to verify no other file imports it statically.

### Crash Cause #6: Legacy Engine Still Exported

**Symptoms**: Unclear — but if any code path imports `createDownloadEngine` from `index.ts`, it creates a SECOND download system with its own state, path logic, and event emissions. This can corrupt the new manager's state.

**Root Cause**: `index.ts` line 126:

```typescript
export { createDownloadEngine } from "./engine";
```

**Comment says**: "The engine.ts module is no longer used by the download system. All downloads now go through the DownloadManager → BlobDownloaderAdapter pipeline."

But it's still exported. If any code uses it (maybe a third-party integration, or leftover code), it runs alongside the new manager.

### Bug #7: Notification Permission Prompts Every Time

**Symptoms**: On iOS, every time a download is started (new app session), the notification permission dialog appears — even if the user previously denied it. iOS does NOT natively support "never ask again" for notifications.

**Root Cause**: `context.tsx`'s `requestPermissionPrimer()`:

```typescript
let permissionPrimerShown = false;  // ← In-memory flag only

function requestPermissionPrimer() {
  if (permissionPrimerShown) return;  // Only blocks per session
  permissionPrimerShown = true;
  DownloadNotifications.requestPermissions()
    .then((granted) => { ... })
    .catch(() => {});
}
```

And `requestPermissions()` in `notifications.ts`:

```typescript
async requestPermissions(): Promise<boolean> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync(); // ← ALWAYS shows dialog!
    finalStatus = status;
  }
  return finalStatus === "granted";
}
```

On iOS, `requestPermissionsAsync()` always shows the system prompt, even after previous denial. There's no built-in "don't ask again" — the OS only offers 3 options: Allow, Allow Once, or Deny. After denial, next `requestPermissionsAsync()` shows the dialog again.

**Need**: Persist denial in AsyncStorage (`@filmsnaps/notification-permission-denied`), check it before calling `requestPermissionsAsync()`, and on Android also check `canAskAgain`.

### Bug #8: `showCompleted` Wrong Map Key

**Symptoms**: Not critical, but `showCompleted` in `notifications.ts` uses `filePath` instead of `taskId` as the Map key for `lastProgressUpdate`:

```typescript
async showCompleted(title: string, filePath: string): Promise<void> {
  lastProgressUpdate.delete(filePath);  // ← Should be taskId!
```

This means progress tracking for future tasks with different `filePath` won't be cleaned up properly.

---

## 4. Dependency Versions

```json
{
  "expo": "~55.0.0",
  "react-native": "0.83.6",
  "react": "19.2.0",
  "react-native-blob-util": "~0.21.2",
  "expo-sqlite": "~15.2.0",
  "expo-notifications": "~0.30.0",
  "react-native-background-actions": "^4.0.1",
  "react-native-reanimated": "~3.17.0",
  "@react-native-async-storage/async-storage": "2.1.2",
  "expo-router": "~4.1.0",
  "@tanstack/react-query": "^5.0.0"
}
```

---

## 5. Questions for Expert

### Q1: CRASH ON START — What is the EXACT crash cause?

The app crashes immediately when `enqueue()` is called from `DownloadSheet.tsx`. We've identified 6 potential causes above. **Which one is the actual crash?** And what exact code change fixes it?

Please provide the **exact code** (diff or complete function) for:

- `manager.ts` — `startDownload()` and `processQueue()`
- `blobDownloader.ts` — `downloadFullSpeed()` entry point
- `context.tsx` — `enqueue()`

### Q2: RNFB String Coercion — Are all call sites covered?

We have `toSafeNumber()` in `blobDownloader.ts` and `manager.ts`. Are there any places in the code that still read raw RNFB values without `toSafeNumber()`? Specifically:

1. `fetchTask.progress((rawReceived, rawTotal) => ...)` — Covers lines 201-240 of blobDownloader.ts
2. `res.status` in the `.then()` handler
3. `probeResult.respInfo?.status` in speed-limited mode
4. `stat.size` from `RNFBlobUtil.fs.stat()`

**Should ALL of these use `toSafeNumber()`?** Or are some guaranteed to be numbers?

### Q3: Resume Architecture — Is the .resume file approach correct?

Current resume flow:

1. Pause: Set `state.paused = true`, cancel fetch task, save `receivedBytes` as `resumeData`
2. Resume: `DownloadManager.resume()` → validates partial file → `startDownload()` merges `.resume` → new download goes to `.resume` temp file
3. Complete: Merge `.resume` back into original → validate → set completed

**Is this the right architecture?** The "merge at resume start, then download to .resume, then merge again" approach seems fragile. Would a simpler "download everything to .resume, then atomically rename on completion" be better?

### Q4: Safe Removal of Legacy Engine

The old `engine.ts` is still exported from `index.ts`. **Can we safely remove `export { createDownloadEngine } from "./engine"` without causing import errors anywhere in the app?** Or does some code still reference it?

### Q5: Notification Permission Once-Only

**What is the correct pattern for iOS `expo-notifications` to show the permission dialog only once, and never again if denied?**

Options:

1. Store a flag in AsyncStorage (`@filmsnaps/notification-permission-denied`)
2. Check `Platform.OS === "ios"` and `canAskAgain` on Android
3. After denial, never call `requestPermissionsAsync()` again

**Please provide the exact code for `requestPermissions()` in `notifications.ts`.**

### Q6: Foreground Service — Is it causing the crash?

`react-native-background-actions` is started in `processQueue()` when downloads are active. Could the foreground service startup (which happens in a `try-catch` but has a complex retry-with-icon-fallback logic) be the crash cause?

```typescript
// manager.ts lines 740-793
if (BackgroundService && !BackgroundService.isRunning() && !this.fsIconFailure) {
  try {
    await BackgroundService.start(..., { taskIcon: { name: "ic_launcher_foreground", ... } });
  } catch (err) {
    if (err?.message?.includes("icon")) {
      // Retry without icon
    }
  }
}
```

**Should we add error boundaries here?** Or remove the foreground service entirely as a potential crash cause?

### Q7: Complete Production-Grade Implementation

**If you were to rewrite the download system from scratch for production use, what would the architecture look like?**

Specifically:

1. Single file for all download orchestration (vs. current 19 files)?
2. What state management pattern for progress?
3. What error handling strategy?
4. How would you structure file path management?
5. Should we use a different native download library instead of `react-native-blob-util`?

Please provide **complete, copy-paste-ready code** for your recommended architecture.

---

## Appendix: Key Files Reference

| File (relative to `apps/mobile/`)     | Lines | Description        |
| ------------------------------------- | ----- | ------------------ |
| `lib/download/types.ts`               | 112   | Type definitions   |
| `lib/download/database.ts`            | 473   | SQLite persistence |
| `lib/download/adapter.ts`             | 49    | Adapter interface  |
| `lib/download/blobDownloader.ts`      | 707   | RNFB adapter       |
| `lib/download/engine.ts`              | 559   | Legacy engine      |
| `lib/download/manager.ts`             | 1370  | New manager        |
| `lib/download/store.ts`               | 448   | Observable store   |
| `lib/download/context.tsx`            | 454   | Provider wiring    |
| `lib/download/notifications.ts`       | 144   | Notifications      |
| `lib/download/index.ts`               | 145   | Public API         |
| `lib/download/useDownloadList.ts`     | 93    | List hook          |
| `lib/download/useDownload.ts`         | 154   | Single task hook   |
| `lib/download/useDownloadQueue.ts`    | 50    | Queue hook         |
| `lib/download/useEpisodeDownloads.ts` | 141   | Season hook        |
| `lib/download/backgroundTask.ts`      | 33    | Legacy stub        |
| `components/DownloadSheet.tsx`        | 367   | Source picker      |
| `components/DownloadBanner.tsx`       | 398   | Status banner      |
| `components/DownloadToast.tsx`        | 332   | Toast system       |
| `app/download/nxsha/[...id].tsx`      | 1356  | Nxsha page         |
| `app/downloads.tsx`                   | 859   | Downloads page     |

---

_Generated for expert consultation — v1.0.5_
