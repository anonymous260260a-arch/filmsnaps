# Filmsnaps Download System — Expert Diagnostic

## Overview

This document is prepared for expert consultation. It contains the complete download system code for the Filmsnaps mobile app and describes two critical bugs that need exact code fixes.

### Environment

| Field                       | Value                                  |
| --------------------------- | -------------------------------------- |
| **App**                     | Filmsnaps mobile (React Native / Expo) |
| **RN Version**              | 0.83.6                                 |
| **Expo SDK**                | 55                                     |
| **Native Download Library** | `react-native-blob-util` v0.17.3       |
| **Persistence**             | `expo-sqlite` (SQLite)                 |
| **Notifications**           | `expo-notifications`                   |
| **Foreground Service**      | `react-native-background-actions` v4.x |
| **Platform Tested**         | Android 11+ (physical device)          |

---

## Bug 1: Progress Bar Stops Updating at ~9.5MB

### Symptom

The download actually continues in the background (confirmed by `[BlobDownloader] Progress` logs showing 18MB, 25MB), but the React UI progress bar freezes at ~9.5MB and never updates.

### Log Evidence

```
 LOG  [BlobDownloader] Progress: 9.1MB / 201.0MB (4.5%)
 LOG  [BlobDownloader] Progress: 18.4MB / 201.0MB (9.2%)
 LOG  [BlobDownloader] Progress: 25.4MB / 201.0MB (12.6%)
```

The `BlobDownloader` logs show progress advancing from 9.1 → 18.4 → 25.4 MB, but the UI progress bar stuck at 9.5MB.

---

## Bug 2: Pause/Resume Restarts from 0

### Symptom

User pauses download at 25.4MB, taps resume, and the download starts from 0. Log shows `Resume: false` on the resumed download, meaning `resumeData` was lost or never persisted.

### Log Evidence

```
 LOG  [BlobDownloader] Progress: 25.4MB / 201.0MB (12.6%)
 LOG  [BlobDownloader] Download paused: dl_1785001009347_auju8a, received=30142901/210739946
 LOG  [Manager] processQueue: queue=0, active=0, processing=true
 LOG  [Manager] processQueue: queue=1, active=0, processing=true
 LOG  [Manager] Starting Foreground Service for downloads
 LOG  [Manager] Starting download: https://download-falix-.../Silo%20S03E01...x264-Falix.mkv
 LOG  [Manager] File: Silo-480p.mkv, Resume: false, Path: /storage/.../Filmsnaps/Silo-480p.mkv, Speed limit: 0
 LOG  [BlobDownloader] Progress: 8.0MB / 201.0MB (4.0%)    ← started from 0 again
```

Key observations:

- `Download paused` fires at 30,142,901 bytes (28.7MB)
- `processQueue` shows `queue=0, active=0` (instance cleaned up)
- Immediately becomes `queue=1` (something re-enqueued)
- `Resume: false` — `resumeData` was `null` so no Range header was sent
- Download starts from 0 (8.0MB reported)

---

## Complete Source Code

### File 1: `adapter.ts` — Interface Definitions

```typescript
// apps/mobile/lib/download/adapter.ts

export interface DownloadOptions {
  url: string;
  filePath: string;
  headers?: Record<string, string>;
  /** Speed limit in bytes per second (0 = unlimited) */
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

### File 2: `types.ts` — Shared Types

```typescript
// apps/mobile/lib/download/types.ts

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

export type ControlAction = "pause" | "resume" | "cancel" | "retry" | "remove";
export type ControlTarget =
  | string
  | string[]
  | { status?: DownloadStatus | DownloadStatus[] };

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
}

export type Unsubscribe = () => void;

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
```

### File 3: `database.ts` — SQLite Persistence

```typescript
// apps/mobile/lib/download/database.ts

import * as SQLite from "expo-sqlite";
import type { DownloadTask, DownloadStatus } from "./types";

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
      dbPromise = null;
      throw e;
    }
  })();
  return dbPromise;
}

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

const CREATE_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
  CREATE INDEX IF NOT EXISTS idx_downloads_media_id ON downloads(media_id);
  CREATE INDEX IF NOT EXISTS idx_downloads_priority ON downloads(priority);
  CREATE INDEX IF NOT EXISTS idx_downloads_created_at ON downloads(created_at);
`;

async function initializeDatabase(
  database: SQLite.SQLiteDatabase,
): Promise<void> {
  await database.execAsync(CREATE_TABLE);
  await database.execAsync(CREATE_INDEXES);
  try {
    const tableInfo = await database.getAllAsync<{ name: string }>(
      "PRAGMA table_info(downloads)",
    );
    const columns = tableInfo.map((info) => info.name);
    if (!columns.includes("file_name")) {
      await database.execAsync(
        "ALTER TABLE downloads ADD COLUMN file_name TEXT;",
      );
    }
    if (!columns.includes("poster_path")) {
      await database.execAsync(
        "ALTER TABLE downloads ADD COLUMN poster_path TEXT;",
      );
    }
  } catch (e) {
    console.error("[Database] Migration failed:", e);
  }
}

interface DownloadRow {
  id: string;
  media_id: string;
  media_type: string;
  title: string;
  url: string;
  file_path: string | null;
  file_size: number;
  downloaded_bytes: number;
  progress: number;
  status: string;
  priority: number;
  speed_limit: number;
  retry_count: number;
  max_retries: number;
  error_message: string | null;
  error_type: string | null;
  server: string;
  quality: string | null;
  season: number | null;
  episode: number | null;
  extension: string;
  resume_data: string | null;
  created_at: number;
  updated_at: number;
  file_name: string | null;
  poster_path: string | null;
}

function rowToTask(row: DownloadRow): DownloadTask {
  return {
    id: row.id,
    tmdbId: row.media_id,
    mediaType: row.media_type as "movie" | "tv",
    title: row.title,
    url: row.url,
    fileName: row.file_name || row.title || "download",
    fileUri: row.file_path,
    totalBytes: row.file_size,
    receivedBytes: row.downloaded_bytes,
    status: row.status as DownloadStatus,
    error: row.error_message ?? undefined,
    server: row.server as any,
    quality: row.quality ?? undefined,
    season: row.season ?? undefined,
    episode: row.episode ?? undefined,
    extension: row.extension,
    resumeData: row.resume_data,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    speedLimit: row.speed_limit,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    posterPath: row.poster_path ?? undefined,
  };
}

function taskToRow(task: DownloadTask): DownloadRow {
  return {
    id: task.id,
    media_id: task.tmdbId ?? "",
    media_type: task.mediaType ?? "movie",
    title: task.title ?? "Untitled",
    url: task.url,
    file_path: task.fileUri,
    file_size: task.totalBytes,
    downloaded_bytes: task.receivedBytes,
    progress: task.totalBytes > 0 ? task.receivedBytes / task.totalBytes : 0,
    status: task.status,
    priority: task.priority ?? 1,
    speed_limit: task.speedLimit ?? 0,
    retry_count: task.retryCount ?? 0,
    max_retries: task.maxRetries ?? 3,
    error_message: task.error ?? null,
    error_type: null,
    server: task.server ?? "nxsha",
    quality: task.quality ?? null,
    season: task.season ?? null,
    episode: task.episode ?? null,
    extension: task.extension ?? "mp4",
    resume_data: task.resumeData ?? null,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    file_name: task.fileName,
    poster_path: task.posterPath ?? null,
  };
}

export const DownloadDatabase = {
  async insert(task: DownloadTask): Promise<void> {
    const db = await getDatabase();
    const row = taskToRow(task);
    await db.runAsync(
      `INSERT OR REPLACE INTO downloads (
        id, media_id, media_type, title, url, file_path, file_size,
        downloaded_bytes, progress, status, priority, speed_limit,
        retry_count, max_retries, error_message, error_type, server,
        quality, season, episode, extension, resume_data, created_at, updated_at,
        file_name, poster_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.media_id,
        row.media_type,
        row.title,
        row.url,
        row.file_path,
        row.file_size,
        row.downloaded_bytes,
        row.progress,
        row.status,
        row.priority,
        row.speed_limit,
        row.retry_count,
        row.max_retries,
        row.error_message,
        row.error_type,
        row.server,
        row.quality,
        row.season,
        row.episode,
        row.extension,
        row.resume_data,
        row.created_at,
        row.updated_at,
        row.file_name,
        row.poster_path,
      ],
    );
  },

  async update(task: Partial<DownloadTask> & { id: string }): Promise<void> {
    const db = await getDatabase();
    const fields: string[] = [];
    const values: any[] = [];

    if (task.status !== undefined) {
      fields.push("status = ?");
      values.push(task.status);
    }
    if (task.fileUri !== undefined) {
      fields.push("file_path = ?");
      values.push(task.fileUri);
    }
    if (task.totalBytes !== undefined) {
      fields.push("file_size = ?");
      values.push(task.totalBytes);
    }
    if (task.receivedBytes !== undefined) {
      fields.push("downloaded_bytes = ?");
      values.push(task.receivedBytes);
    }
    if (task.error !== undefined) {
      fields.push("error_message = ?");
      values.push(task.error);
    }
    if (task.resumeData !== undefined) {
      fields.push("resume_data = ?");
      values.push(task.resumeData);
    }
    if (task.retryCount !== undefined) {
      fields.push("retry_count = ?");
      values.push(task.retryCount);
    }
    if (task.maxRetries !== undefined) {
      fields.push("max_retries = ?");
      values.push(task.maxRetries);
    }
    if (task.priority !== undefined) {
      fields.push("priority = ?");
      values.push(task.priority);
    }
    if (task.speedLimit !== undefined) {
      fields.push("speed_limit = ?");
      values.push(task.speedLimit);
    }
    if (task.fileName !== undefined) {
      fields.push("file_name = ?");
      values.push(task.fileName);
    }
    if (task.posterPath !== undefined) {
      fields.push("poster_path = ?");
      values.push(task.posterPath);
    }
    if (task.title !== undefined) {
      fields.push("title = ?");
      values.push(task.title);
    }
    if (task.extension !== undefined) {
      fields.push("extension = ?");
      values.push(task.extension);
    }
    if (task.quality !== undefined) {
      fields.push("quality = ?");
      values.push(task.quality);
    }
    if (task.server !== undefined) {
      fields.push("server = ?");
      values.push(task.server);
    }

    if (
      task.totalBytes !== undefined &&
      task.receivedBytes !== undefined &&
      task.totalBytes > 0
    ) {
      fields.push("progress = ?");
      values.push(task.receivedBytes / task.totalBytes);
    }

    fields.push("updated_at = ?");
    values.push(Date.now());
    values.push(task.id);

    await db.runAsync(
      `UPDATE downloads SET ${fields.join(", ")} WHERE id = ?`,
      values,
    );
  },

  async getById(id: string): Promise<DownloadTask | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<DownloadRow>(
      "SELECT * FROM downloads WHERE id = ?",
      [id],
    );
    return row ? rowToTask(row) : null;
  },

  async getAll(): Promise<DownloadTask[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<DownloadRow>(
      "SELECT * FROM downloads ORDER BY created_at DESC",
    );
    return rows.map(rowToTask);
  },

  async getByStatus(status: DownloadStatus): Promise<DownloadTask[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<DownloadRow>(
      "SELECT * FROM downloads WHERE status = ? ORDER BY priority ASC, created_at ASC",
      [status],
    );
    return rows.map(rowToTask);
  },

  async getByMediaId(mediaId: string): Promise<DownloadTask[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<DownloadRow>(
      "SELECT * FROM downloads WHERE media_id = ? ORDER BY created_at DESC",
      [mediaId],
    );
    return rows.map(rowToTask);
  },

  async getBySeason(mediaId: string, season: number): Promise<DownloadTask[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<DownloadRow>(
      "SELECT * FROM downloads WHERE media_id = ? AND season = ? ORDER BY episode ASC",
      [mediaId, season],
    );
    return rows.map(rowToTask);
  },

  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync("DELETE FROM downloads WHERE id = ?", [id]);
  },

  async deleteCompleted(): Promise<void> {
    const db = await getDatabase();
    await db.runAsync("DELETE FROM downloads WHERE status = 'completed'");
  },

  async deleteCancelled(): Promise<void> {
    const db = await getDatabase();
    await db.runAsync("DELETE FROM downloads WHERE status = 'cancelled'");
  },

  async getCountByStatus(status: DownloadStatus): Promise<number> {
    const db = await getDatabase();
    const result = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM downloads WHERE status = ?",
      [status],
    );
    return result?.count ?? 0;
  },

  async getStorageUsed(): Promise<number> {
    const db = await getDatabase();
    const result = await db.getFirstAsync<{ total: number }>(
      "SELECT COALESCE(SUM(file_size), 0) as total FROM downloads WHERE status = 'completed'",
    );
    return result?.total ?? 0;
  },

  /** Mark stale active tasks as paused (for app restart recovery) */
  async recoverStaleTasks(): Promise<number> {
    const db = await getDatabase();
    const result = await db.runAsync(
      "UPDATE downloads SET status = 'paused', error_message = 'App was closed. Tap resume to continue.' WHERE status IN ('downloading', 'pending')",
    );
    return result.changes;
  },

  async close(): Promise<void> {
    if (db) {
      await db.closeAsync();
      db = null;
    }
  },
};
```

### File 4: `manager.ts` — DownloadManager

```typescript
// apps/mobile/lib/download/manager.ts

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

// ── Lazy-loaded BackgroundService ──
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
}

function createSpeedTracker(): SpeedTracker {
  return { samples: [], currentSpeed: 0, eta: 0 };
}

function updateSpeed(
  tracker: SpeedTracker,
  receivedBytes: number,
  totalBytes: number,
): { speed: number; eta: number } {
  const now = Date.now();
  tracker.samples.push({ time: now, receivedBytes });
  const cutoff = now - SPEED_SAMPLE_WINDOW;
  tracker.samples = tracker.samples.filter((s) => s.time >= cutoff);
  if (tracker.samples.length < 2) return { speed: 0, eta: 0 };
  const first = tracker.samples[0];
  const last = tracker.samples[tracker.samples.length - 1];
  const timeDelta = (last.time - first.time) / 1000;
  const byteDelta = last.receivedBytes - first.receivedBytes;
  if (timeDelta <= 0 || byteDelta <= 0) return { speed: 0, eta: 0 };
  tracker.currentSpeed = byteDelta / timeDelta;
  if (tracker.currentSpeed > 0 && totalBytes > 0) {
    const remaining = totalBytes - receivedBytes;
    tracker.eta = remaining / tracker.currentSpeed;
  } else {
    tracker.eta = 0;
  }
  return { speed: tracker.currentSpeed, eta: tracker.eta };
}

export interface DownloadManagerConfig {
  maxConcurrent?: number;
  maxRetries?: number;
  enableNotifications?: boolean;
}

export class DownloadManager {
  private adapter: IDownloaderAdapter;
  private activeInstances = new Map<string, DownloadInstance>();
  private activeTasks = new Map<string, DownloadTask>();
  private activeSpeedTrackers = new Map<string, SpeedTracker>();
  private queue: string[] = [];
  private config: Required<DownloadManagerConfig>;
  private progressListeners = new Set<
    (p: DownloadProgress & { speed?: number; eta?: number }) => void
  >();
  private statusListeners = new Set<(s: StatusChange) => void>();
  private queueListeners = new Set<() => void>();
  private notificationsEnabled: boolean;
  private processingQueue = false;
  private fsIconFailure = false;

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

  // ─── PAUSE ───
  async pause(taskId: string): Promise<void> {
    const instance = this.activeInstances.get(taskId);
    if (instance) {
      try {
        await instance.pause();
      } catch {}
      this.activeInstances.delete(taskId);
      this.activeTasks.delete(taskId);
      this.activeSpeedTrackers.delete(taskId);
    }
    const task = await DownloadDatabase.getById(taskId);
    const resumeOffset = task?.receivedBytes || 0;
    await DownloadDatabase.update({
      id: taskId,
      status: "paused",
      resumeData: resumeOffset > 0 ? String(resumeOffset) : null,
    });
    this.emitStatus(taskId, "paused");
    this.queue = this.queue.filter((id) => id !== taskId);
    this.notifyQueue();
    this.processQueue();
  }

  // ─── RESUME ───
  async resume(taskId: string): Promise<void> {
    const task = await DownloadDatabase.getById(taskId);
    if (!task) return;
    await DownloadDatabase.update({
      id: taskId,
      status: "pending",
      error: undefined,
    });
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
    await DownloadDatabase.update({ id: taskId, status: "cancelled" });
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
    await DownloadDatabase.update({
      id: taskId,
      status: "pending",
      receivedBytes: 0,
      totalBytes: 0,
      error: undefined,
      retryCount: 0,
    });
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
    const task = await DownloadDatabase.getById(taskId);
    if (!task) return null;
    const tracker = this.activeSpeedTrackers.get(taskId);
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
    if (this.processingQueue) {
      console.log(
        "[Manager] processQueue already running — skipping re-entrant call",
      );
      return;
    }
    this.processingQueue = true;
    console.log(
      `[Manager] processQueue: queue=${this.queue.length}, active=${this.activeInstances.size}, processing=${this.processingQueue}`,
    );

    try {
      const hasPendingWork = this.queue.length > 0;
      const hasActiveWork = this.activeInstances.size > 0;

      if (
        (hasPendingWork || hasActiveWork) &&
        BackgroundService &&
        !BackgroundService.isRunning() &&
        !this.fsIconFailure
      ) {
        console.log("[Manager] Starting Foreground Service for downloads");
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
            console.warn(
              "[Manager] Foreground Service icon not found — retrying with default",
            );
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
              console.log(
                "[Manager] Foreground Service started (no custom icon)",
              );
            } catch (err2: any) {
              console.error(
                "[Manager] Foreground Service permanently unavailable:",
                err2?.message || err2,
              );
              this.fsIconFailure = true;
            }
          } else {
            console.warn(
              "[Manager] Foreground Service unavailable:",
              err?.message || err,
            );
          }
        }
      }

      while (
        this.queue.length > 0 &&
        this.activeInstances.size < this.maxConcurrent
      ) {
        const taskId = this.queue.shift();
        if (!taskId) break;

        if (this.activeInstances.has(taskId) || this.activeTasks.has(taskId)) {
          console.log(
            `[Manager] processQueue guard: task ${taskId} already active — skipping`,
          );
          continue;
        }

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

  // ─── START DOWNLOAD ───
  private async startDownload(task: DownloadTask): Promise<void> {
    await DownloadDatabase.update({ id: task.id, status: "downloading" });
    this.emitStatus(task.id, "downloading");
    await this.ensureDownloadDir();

    const filePath = this.buildFilePath(task);

    // Build headers with optional Range for resume
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };
    if (task.resumeData) {
      const parsed = parseInt(task.resumeData, 10);
      if (!isNaN(parsed) && parsed > 0) {
        headers["Range"] = `bytes=${parsed}-`;
      }
    }

    const isResume = !!headers["Range"];
    const actualPath = isResume ? `${filePath}.resume` : filePath;
    const resumeOffset = parseInt(task.resumeData || "0", 10) || 0;

    let lastSavedReceived = resumeOffset;
    let lastSaveTime = 0;
    let maxReceivedSeen = resumeOffset;

    const speedTracker = createSpeedTracker();
    this.activeSpeedTrackers.set(task.id, speedTracker);

    try {
      console.log(`[Manager] Starting download: ${task.url}`);
      console.log(
        `[Manager] File: ${task.fileName}, Resume: ${isResume}, Path: ${actualPath}, Speed limit: ${task.speedLimit ?? 0}`,
      );

      const instance = await this.adapter.download({
        url: task.url,
        filePath: actualPath,
        headers,
        speedLimit: task.speedLimit ?? 0,
        onProgress: (received: number, total: number) => {
          const adjustedReceived = isResume
            ? resumeOffset + received
            : received;
          const adjustedTotal =
            total > 0 ? (isResume ? resumeOffset + total : total) : 0;

          if (adjustedReceived < maxReceivedSeen) return;
          maxReceivedSeen = adjustedReceived;

          const { speed, eta } = updateSpeed(
            speedTracker,
            maxReceivedSeen,
            adjustedTotal,
          );
          this.emitProgress(
            task.id,
            maxReceivedSeen,
            adjustedTotal,
            speed,
            eta,
          );

          const now = Date.now();
          if (now - lastSaveTime > 2000 || maxReceivedSeen === adjustedTotal) {
            lastSaveTime = now;
            lastSavedReceived = maxReceivedSeen;

            const resumeBytes =
              maxReceivedSeen > 0 ? String(maxReceivedSeen) : null;

            DownloadDatabase.update({
              id: task.id,
              receivedBytes: maxReceivedSeen,
              totalBytes: adjustedTotal,
              resumeData: resumeBytes ?? null,
            }).catch((e) => {
              console.warn(
                `[Manager] DB update failed for ${task.id}:`,
                e?.message || e,
              );
            });
          }
        },
        onDone: async (finalPath: string) => {
          this.activeInstances.delete(task.id);
          this.activeTasks.delete(task.id);
          this.activeSpeedTrackers.delete(task.id);

          let resolvedPath = finalPath;

          if (isResume && filePath !== finalPath) {
            const rnfb = getRNFB();
            const origExists = rnfb && (await rnfb.fs.exists(filePath));
            if (origExists) {
              try {
                await this.appendFileStream(finalPath, filePath);
                try {
                  if (rnfb) await rnfb.fs.unlink(finalPath);
                } catch {}
                resolvedPath = filePath;
              } catch (e) {
                console.warn(
                  `[Manager] Resume append failed for ${task.id}:`,
                  e,
                );
              }
            } else {
              resolvedPath = finalPath;
            }
          }

          try {
            const rnfb = getRNFB();
            if (!rnfb)
              throw new Error("react-native-blob-util is not available");
            const stat = await rnfb.fs.stat(resolvedPath);
            if (stat.size < 10240) {
              throw new Error(
                "Server returned invalid response (file too small)",
              );
            }
            await DownloadDatabase.update({
              id: task.id,
              status: "completed",
              fileUri: resolvedPath,
              receivedBytes: stat.size,
              totalBytes: stat.size,
            });
            this.emitStatus(task.id, "completed");
            if (this.notificationsEnabled) {
              DownloadNotifications.showCompleted(
                task.title || "Download",
                resolvedPath,
              ).catch(() => {});
            }
          } catch (e: any) {
            const cat = categorizeError(e);
            await DownloadDatabase.update({
              id: task.id,
              status: "failed",
              error: cat.message,
            });
            this.emitStatus(task.id, "failed", cat.message);
            if (this.notificationsEnabled) {
              DownloadNotifications.showFailed(
                task.title || "Download",
                cat.message,
              ).catch(() => {});
            }
          }

          this.processQueue();
        },
        onError: async (error: Error) => {
          this.activeInstances.delete(task.id);
          this.activeTasks.delete(task.id);
          this.activeSpeedTrackers.delete(task.id);
          console.error(
            `[Manager] onError for ${task.id}:`,
            error?.message || error,
            error?.stack,
          );
          await this.handleError(task, error);
          this.processQueue();
        },
      });

      this.activeInstances.set(task.id, instance);
      this.activeTasks.set(task.id, task);
      console.log(
        `[Manager] activeInstances set for ${task.id}, count=${this.activeInstances.size}, queue=${this.queue.length}`,
      );
    } catch (error: any) {
      this.activeInstances.delete(task.id);
      this.activeTasks.delete(task.id);
      this.activeSpeedTrackers.delete(task.id);
      console.error(
        `[Manager] Catch block for ${task.id}:`,
        error?.message || error,
        error?.stack,
      );
      await this.handleError(task, error);
    }
  }

  // ─── ERROR HANDLING ───
  private async handleError(task: DownloadTask, error: Error): Promise<void> {
    const cat = categorizeError(error);
    const retryCount = task.retryCount ?? 0;
    console.error(
      `[Manager] HandleError for ${task.id}:`,
      error?.message || error,
      "| category:",
      cat.code,
      "| retryable:",
      cat.retryable,
      "| retryCount:",
      retryCount,
    );

    if (cat.retryable && retryCount < this.config.maxRetries) {
      const delay = RETRY_DELAYS[retryCount] || 60000;
      const nextRetry = retryCount + 1;
      await DownloadDatabase.update({
        id: task.id,
        status: "pending",
        retryCount: nextRetry,
        error: `Retry ${nextRetry}/${this.config.maxRetries}: ${cat.message}`,
      });
      console.log(
        `[Manager] Retrying ${task.id} in ${delay}ms (attempt ${nextRetry})`,
      );
      setTimeout(() => {
        this.resume(task.id).catch(() => {});
      }, delay);
    } else {
      await DownloadDatabase.update({
        id: task.id,
        status: "failed",
        error: cat.message,
      });
      this.emitStatus(task.id, "failed", cat.message);
      if (this.notificationsEnabled) {
        DownloadNotifications.showFailed(
          task.title || "Download",
          cat.message,
        ).catch(() => {});
      }
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
        if (!exists) await rnfb.fs.mkdir(downloadsDir);
      }
    } catch {}
  }

  private async appendFileStream(
    sourcePath: string,
    targetPath: string,
  ): Promise<void> {
    const readStream = await getRNFB().fs.readStream(
      sourcePath,
      "base64",
      256 * 1024,
    );
    const writeStream = await getRNFB().fs.writeStream(
      targetPath,
      "base64",
      true,
    );
    return new Promise<void>((resolve, reject) => {
      let writeError: Error | null = null;
      let done = false;
      readStream.onData((chunk: string | number[]) => {
        if (done) return;
        try {
          if (typeof chunk === "string") writeStream.write(chunk);
          else writeStream.write(String.fromCharCode(...chunk));
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

  // ─── EVENT SYSTEM ───
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

  private emitStatus(taskId: string, status: DownloadStatus, error?: string) {
    const event: StatusChange = { taskId, status, error };
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
```

### File 5: `blobDownloader.ts` — RNFB Download Adapter

```typescript
// apps/mobile/lib/download/blobDownloader.ts

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

function adjustChunkSize(speedLimit: number): number {
  if (speedLimit <= 1024 * 1024) return 512 * 1024;
  if (speedLimit <= 5 * 1024 * 1024) return 1024 * 1024;
  return 2 * 1024 * 1024;
}

const MIN_VALID_FILE_SIZE = 10_240;
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const CHUNK_TIMEOUT_MS = 10 * 60 * 1000;

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

const MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mkv: "video/x-matroska",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mov: "video/quicktime",
  ts: "video/mp2t",
  m3u8: "application/x-mpegURL",
};

function getMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "mp4";
  return MIME_TYPES[ext] || "video/mp4";
}

async function ensureParentDir(filePath: string): Promise<void> {
  if (!RNFBlobUtil) return;
  const normalized = filePath.replace(/\\/g, "/");
  const lastSep = normalized.lastIndexOf("/");
  if (lastSep <= 0) return;
  const dir = normalized.substring(0, lastSep);
  try {
    const exists = await RNFBlobUtil.fs.exists(dir);
    if (!exists) await RNFBlobUtil.fs.mkdir(dir);
  } catch (e) {
    console.warn("[BlobDownloader] Failed to create directory:", dir, e);
  }
}

function cancelFetch(fetchTask: any): Promise<void> {
  if (!fetchTask) return Promise.resolve();
  if (typeof fetchTask.cancel === "function") return fetchTask.cancel();
  if (fetchTask.task && typeof fetchTask.task.cancel === "function")
    return fetchTask.task.cancel();
  return Promise.resolve();
}

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
    if (!options.url || typeof options.url !== "string")
      throw new Error("Invalid download URL");
    await ensureParentDir(options.filePath);
    const speedLimit = options.speedLimit ?? 0;
    const downloadId = `dl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    if (speedLimit > 0)
      return this.downloadChunked(downloadId, options, speedLimit);
    return this.downloadFullSpeed(downloadId, options);
  }

  private async downloadFullSpeed(
    downloadId: string,
    options: DownloadOptions,
  ): Promise<DownloadInstance> {
    const config = { path: options.filePath, fileCache: false };
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      ...(options.headers || {}),
    };

    console.log(
      `[BlobDownloader] Full-speed download: ${options.url.slice(0, 200)}`,
    );
    const fetchTask = RNFBlobUtil.config(config).fetch(
      "GET",
      options.url,
      headers,
    );

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

    let lastProgressLog = Date.now();
    const PROGRESS_LOG_INTERVAL = 10000;

    fetchTask.progress((received: number, total: number) => {
      try {
        if (state.cancelled || state.paused) return;
        state.receivedBytes = received;
        state.totalBytes = total;
        options.onProgress?.(received, total);

        const now = Date.now();
        if (now - lastProgressLog > PROGRESS_LOG_INTERVAL) {
          lastProgressLog = now;
          const totalMB = total > 0 ? (total / 1024 / 1024).toFixed(1) : "?";
          const receivedMB = (received / 1024 / 1024).toFixed(1);
          const pct = total > 0 ? ((received / total) * 100).toFixed(1) : "?";
          console.log(
            `[BlobDownloader] Progress: ${receivedMB}MB / ${totalMB}MB (${pct}%)`,
          );
        }
      } catch {}
    });

    let timedOut = false;
    const timeoutId = setTimeout(() => {
      if (!state.cancelled && !state.paused) {
        timedOut = true;
        try {
          cancelFetch(fetchTask);
        } catch {}
        console.log(
          `[BlobDownloader] Download timed out after ${DOWNLOAD_TIMEOUT_MS}ms`,
        );
      }
    }, DOWNLOAD_TIMEOUT_MS);

    fetchTask
      .then(async (res: any) => {
        clearTimeout(timeoutId);
        activeDownloads.delete(downloadId);
        if (state.cancelled || state.paused) return;

        const status = res?.respInfo?.status;
        const totalBytes = state.totalBytes;
        const receivedBytes = state.receivedBytes;

        console.log(
          `[BlobDownloader] Fetch completed: id=${downloadId}, status=${status}, receivedBytes=${receivedBytes}, totalBytes=${totalBytes}, timedOut=${timedOut}`,
        );
        if (totalBytes > 0 && receivedBytes < totalBytes) {
          console.warn(
            `[BlobDownloader] PREMATURE COMPLETION: ${receivedBytes}/${totalBytes} bytes — server may have closed connection`,
          );
        }
        console.log(
          `[BlobDownloader] HTTP Status: ${status}, res.path(): ${res.path()}, expected: ${options.filePath}`,
        );

        if (status && status >= 400) {
          console.error(`[BlobDownloader] Server returned HTTP ${status}`);
          options.onError?.(new Error(`Server returned HTTP ${status}`));
          return;
        }

        const actualPath = res.path();
        let finalPath = options.filePath;
        if (actualPath && actualPath !== options.filePath) {
          console.log(
            `[BlobDownloader] Path mismatch: res.path()=${actualPath} !== expected=${options.filePath}. Copying...`,
          );
          try {
            await RNFBlobUtil.fs.cp(actualPath, options.filePath);
            try {
              await RNFBlobUtil.fs.unlink(actualPath);
            } catch {}
          } catch (copyErr: any) {
            console.error(
              `[BlobDownloader] Failed to copy from ${actualPath} to ${options.filePath}:`,
              copyErr,
            );
            options.onError?.(
              new Error(`Failed to move downloaded file: ${copyErr.message}`),
            );
            return;
          }
        }
        options.onDone?.(options.filePath);
      })
      .catch((err: any) => {
        clearTimeout(timeoutId);
        activeDownloads.delete(downloadId);
        if (state.cancelled) {
          console.log(`[BlobDownloader] Download cancelled: ${downloadId}`);
        } else if (state.paused) {
          console.log(
            `[BlobDownloader] Download paused: ${downloadId}, received=${state.receivedBytes}/${state.totalBytes}`,
          );
        } else if (timedOut) {
          console.log(`[BlobDownloader] Download timed out: ${downloadId}`);
        } else {
          const errMsg = err?.message || String(err || "unknown");
          const errCode = err?.code || err?.status || "N/A";
          const errStack = err?.stack ? err.stack.substring(0, 300) : "N/A";
          console.error(
            `[BlobDownloader] Download FAILED: ${downloadId}, error=${errMsg}, code=${errCode}, stack=${errStack}`,
          );
          options.onError?.(new Error(errMsg));
        }
      });

    console.log(
      `[BlobDownloader] Created download: ${downloadId}, speedLimit: ${options.speedLimit ?? 0}`,
    );
    return this.createInstance(downloadId, state, options);
  }

  private async downloadChunked(
    downloadId: string,
    options: DownloadOptions,
    speedLimit: number,
  ): Promise<DownloadInstance> {
    const filePath = options.filePath;

    let totalSize = 0;
    let rangeSupported = false;

    try {
      const probeHeaders: Record<string, string> = {
        Range: "bytes=0-0",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...(options.headers || {}),
      };
      const probeResult = await RNFBlobUtil.config({ fileCache: false }).fetch(
        "GET",
        options.url,
        probeHeaders,
      );
      console.log(
        `[BlobDownloader] Probe result: status=${probeResult.respInfo?.status}, url=${options.url.slice(0, 200)}`,
      );

      const status = probeResult.respInfo?.status ?? 0;
      const contentRange =
        probeResult.respInfo?.headers?.["Content-Range"] ||
        probeResult.respInfo?.headers?.["content-range"] ||
        "";

      if (status === 206 && contentRange) {
        rangeSupported = true;
        const parts = contentRange.split("/");
        if (parts.length === 2) totalSize = parseInt(parts[1], 10);
      }
    } catch {}

    if (!rangeSupported || totalSize <= 0) {
      console.log(
        `[BlobDownloader] Range not supported or size unknown, falling back to full speed`,
      );
      return this.downloadFullSpeed(downloadId, options);
    }

    let resumeOffset = 0;
    const rangeHeader = options.headers?.["Range"] || "";
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-/);
      if (match) resumeOffset = parseInt(match[1], 10);
    }

    const state: ActiveDownload = {
      cancelled: false,
      paused: false,
      receivedBytes: resumeOffset,
      totalBytes: totalSize,
      options,
      fetchTask: null,
      chunkPaths: [],
      filePath,
      currentOffset: resumeOffset,
      chunkedMode: true,
    };
    activeDownloads.set(downloadId, state);

    this.runChunkedLoop(
      downloadId,
      state,
      totalSize,
      resumeOffset,
      speedLimit,
      options,
    )
      .then(() => {})
      .catch((err) => {
        activeDownloads.delete(downloadId);
        if (!state.cancelled && !state.paused) options.onError?.(err);
      });

    return this.createInstance(downloadId, state, options);
  }

  private async runChunkedLoop(
    downloadId: string,
    state: ActiveDownload,
    totalSize: number,
    startOffset: number,
    speedLimit: number,
    options: DownloadOptions,
  ): Promise<void> {
    let offset = startOffset;
    let chunkIndex = 0;
    const chunkSize = adjustChunkSize(speedLimit);

    while (offset < totalSize) {
      if (state.cancelled) {
        await this.cleanupChunks(state.chunkPaths);
        return;
      }
      if (state.paused) return;

      const endByte = Math.min(offset + chunkSize - 1, totalSize - 1);
      const chunkFilePath = `${state.filePath}.chunk_${chunkIndex}`;
      state.chunkPaths.push(chunkFilePath);

      const chunkHeaders: Record<string, string> = {
        Range: `bytes=${offset}-${endByte}`,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...(options.headers || {}),
      };
      await ensureParentDir(chunkFilePath);
      const chunkStartTime = Date.now();

      const chunkFetchTask = RNFBlobUtil.config({
        path: chunkFilePath,
        fileCache: false,
      }).fetch("GET", options.url, chunkHeaders);
      state.fetchTask = chunkFetchTask;

      const chunkTimeoutId = setTimeout(() => {
        if (!state.cancelled && !state.paused) {
          try {
            cancelFetch(chunkFetchTask);
          } catch {}
        }
      }, CHUNK_TIMEOUT_MS);

      let chunkActualSize: number;
      try {
        await chunkFetchTask;
        clearTimeout(chunkTimeoutId);
        if (state.cancelled) {
          await this.cleanupChunks(state.chunkPaths);
          return;
        }
        if (state.paused) return;

        try {
          const stat = await RNFBlobUtil.fs.stat(chunkFilePath);
          chunkActualSize = stat.size;
        } catch {
          chunkActualSize = endByte - offset + 1;
        }
      } catch (err: any) {
        clearTimeout(chunkTimeoutId);
        if (state.cancelled) {
          await this.cleanupChunks(state.chunkPaths);
          return;
        }
        if (state.paused) return;
        await this.cleanupChunks(state.chunkPaths);
        activeDownloads.delete(downloadId);
        options.onError?.(
          new Error(`Chunk ${chunkIndex} failed: ${err.message}`),
        );
        return;
      }

      offset += chunkActualSize;
      state.currentOffset = offset;
      state.receivedBytes = offset;
      chunkIndex++;
      try {
        options.onProgress?.(state.receivedBytes, totalSize);
      } catch {}
      state.fetchTask = null;

      const elapsedMs = Date.now() - chunkStartTime;
      const targetMs = (chunkActualSize / speedLimit) * 1000;
      const waitMs = Math.round(targetMs - elapsedMs);
      if (waitMs > 0) await this.delay(waitMs);
    }

    try {
      await this.concatenateChunks(state.chunkPaths, state.filePath);
      await this.cleanupChunks(state.chunkPaths);
      const stat = await RNFBlobUtil.fs.stat(state.filePath);
      if (stat.size < MIN_VALID_FILE_SIZE) {
        try {
          await RNFBlobUtil.fs.unlink(state.filePath);
        } catch {}
        activeDownloads.delete(downloadId);
        options.onError?.(
          new Error("Server returned invalid response (file too small)"),
        );
        return;
      }
      state.receivedBytes = stat.size;
      try {
        options.onProgress?.(stat.size, stat.size);
      } catch {}
      activeDownloads.delete(downloadId);
      options.onDone?.(state.filePath);
    } catch (err: any) {
      await this.cleanupChunks(state.chunkPaths);
      activeDownloads.delete(downloadId);
      options.onError?.(new Error(`Concatenation failed: ${err.message}`));
    }
  }

  private async concatenateChunks(
    chunkPaths: string[],
    targetPath: string,
  ): Promise<void> {
    if (chunkPaths.length === 0 || !RNFBlobUtil) return;
    if (chunkPaths.length === 1) {
      try {
        await RNFBlobUtil.fs.mv(chunkPaths[0], targetPath);
      } catch {
        await this.appendFileStream(chunkPaths[0], targetPath);
        try {
          await RNFBlobUtil.fs.unlink(chunkPaths[0]);
        } catch {}
      }
      return;
    }
    try {
      await RNFBlobUtil.fs.mv(chunkPaths[0], targetPath);
    } catch {
      await this.appendFileStream(chunkPaths[0], targetPath);
      try {
        await RNFBlobUtil.fs.unlink(chunkPaths[0]);
      } catch {}
    }
    for (let i = 1; i < chunkPaths.length; i++) {
      await this.appendFileStream(chunkPaths[i], targetPath);
      try {
        await RNFBlobUtil.fs.unlink(chunkPaths[i]);
      } catch {}
    }
  }

  private async cleanupChunks(chunkPaths: string[]): Promise<void> {
    if (!RNFBlobUtil) return;
    for (const p of chunkPaths) {
      try {
        if (await RNFBlobUtil.fs.exists(p)) await RNFBlobUtil.fs.unlink(p);
      } catch {}
    }
  }

  private async appendFileStream(
    sourcePath: string,
    targetPath: string,
  ): Promise<void> {
    const readStream = await RNFBlobUtil.fs.readStream(
      sourcePath,
      "base64",
      256 * 1024,
    );
    const writeStream = await RNFBlobUtil.fs.writeStream(
      targetPath,
      "base64",
      true,
    );
    return new Promise<void>((resolve, reject) => {
      let writeError: Error | null = null;
      let done = false;
      readStream.onData((chunk: string | number[]) => {
        if (done) return;
        try {
          if (typeof chunk === "string") writeStream.write(chunk);
          else writeStream.write(String.fromCharCode(...chunk));
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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private createInstance(
    downloadId: string,
    state: ActiveDownload,
    options: DownloadOptions,
  ): DownloadInstance {
    return {
      id: downloadId,
      pause: async () => {
        state.paused = true;
        if (state.fetchTask) {
          try {
            await cancelFetch(state.fetchTask);
          } catch {}
          state.fetchTask = null;
        }
      },
      resume: async () => {
        state.paused = false;
        state.cancelled = false;
      },
      cancel: async () => {
        state.cancelled = true;
        if (state.fetchTask) {
          try {
            await cancelFetch(state.fetchTask);
          } catch {}
          state.fetchTask = null;
        }
        await this.cleanupChunks(state.chunkPaths);
        try {
          if (await RNFBlobUtil.fs.exists(state.filePath)) {
            await RNFBlobUtil.fs.unlink(state.filePath);
          }
        } catch {}
        for (const p of state.chunkPaths) {
          try {
            if (await RNFBlobUtil.fs.exists(p)) await RNFBlobUtil.fs.unlink(p);
          } catch {}
        }
        activeDownloads.delete(downloadId);
      },
    };
  }

  supportsBackground(): boolean {
    return true;
  }

  async getAvailableStorage(): Promise<number> {
    try {
      const info = await RNFBlobUtil.fs.df();
      return info.free ?? 0;
    } catch {
      return 0;
    }
  }

  async destroy(): Promise<void> {
    for (const [id, state] of activeDownloads) {
      state.cancelled = true;
      if (state.fetchTask) {
        try {
          await cancelFetch(state.fetchTask);
        } catch {}
      }
      await this.cleanupChunks(state.chunkPaths);
    }
    activeDownloads.clear();
  }
}
```

### File 6: `context.tsx` — React Provider + Event Wiring

```typescript
// apps/mobile/lib/download/context.tsx

import React, { createContext, useContext, useEffect, useRef } from 'react';
import { createDownloadStore, type IDownloadStore, createAsyncStorageAdapter } from './store';
import { DownloadManager } from './manager';
import { DownloadNotifications } from './notifications';
import type { DownloadTask, DownloadMeta, ControlAction, ControlTarget } from './types';

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `dl_${crypto.randomUUID().substring(0, 8)}`;
  }
  return `dl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export interface DownloadInfra {
  store: IDownloadStore;
  manager: DownloadManager;
  enqueue: (meta: DownloadMeta) => string;
  control: (action: ControlAction, target?: ControlTarget) => Promise<void>;
}

const DownloadInfraContext = createContext<DownloadInfra | null>(null);

export function DownloadInfraProvider({
  children,
  storeOverride,
}: {
  children: React.ReactNode;
  storeOverride?: IDownloadStore;
}) {
  const infraRef = useRef<DownloadInfra | null>(null);

  if (!infraRef.current) {
    const store = storeOverride ?? createDownloadStore(createAsyncStorageAdapter());
    let manager: DownloadManager;
    try {
      const { BlobDownloaderAdapter } = require('./blobDownloader');
      const adapter = new BlobDownloaderAdapter();
      manager = new DownloadManager(adapter, { maxConcurrent: 3, enableNotifications: true });
    } catch (e) {
      console.error('[Provider] DownloadManager init failed — downloads unavailable:', e);
      throw e;
    }
    const control = createControl(manager, store);
    const enqueue = createEnqueue(manager, store);
    infraRef.current = { store, manager, enqueue, control };
  }

  const { manager, store } = infraRef.current;

  useEffect(() => {
    store.load();
    manager.initialize().catch(() => {});
  }, [store, manager]);

  useEffect(() => {
    const unsubProgress = manager.onProgress((p) => {
      const existing = store.getById(p.taskId);
      if (existing) {
        store.upsert({
          ...existing,
          receivedBytes: p.receivedBytes,
          totalBytes: p.totalBytes,
          status: 'downloading',
        });
      }
    });

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
      const title = existing?.title || 'Download';
      switch (s.status) {
        case 'completed':
          DownloadNotifications.showCompleted(title, existing?.fileUri || '').catch(() => {});
          break;
        case 'failed':
          DownloadNotifications.showFailed(title, s.error || 'Unknown error').catch(() => {});
          break;
      }
    });

    return () => {
      unsubProgress();
      unsubStatus();
    };
  }, [manager, store]);

  useEffect(() => {
    return () => { manager.destroy(); };
  }, [manager]);

  return (
    <DownloadInfraContext.Provider value={infraRef.current}>
      {children}
    </DownloadInfraContext.Provider>
  );
}

export function useDownloadInfra(): DownloadInfra {
  const ctx = useContext(DownloadInfraContext);
  if (!ctx) throw new Error('DownloadInfraProvider not found in tree');
  return ctx;
}

function createEnqueue(manager: DownloadManager, store: IDownloadStore) {
  const pendingEnqueues = new Map<string, string>();

  return function enqueue(meta: DownloadMeta): string {
    const key = `${meta.url}_${meta.fileName}`;

    const pendingId = pendingEnqueues.get(key);
    if (pendingId) {
      console.log('[Enqueue] Deduplicated via in-memory lock');
      return pendingId;
    }

    const existing = store.getAll().find(
      (t) => t.url === meta.url && t.fileName === meta.fileName && !['completed', 'cancelled'].includes(t.status),
    );
    if (existing) return existing.id;

    const id = generateId();
    pendingEnqueues.set(key, id);

    const fileNameParts = meta.fileName.split('.');
    const ext = meta.extension || (fileNameParts.length > 1 ? fileNameParts.pop()! : 'mp4');
    const task: DownloadTask = {
      ...meta, id, fileUri: null, totalBytes: 0, receivedBytes: 0,
      status: 'pending', createdAt: Date.now(), updatedAt: Date.now(),
      extension: ext, speedLimit: meta.speedLimit ?? 0,
    };

    console.log(`[Enqueue] Download URL: ${meta.url}`);
    console.log(`[Enqueue] File: ${meta.fileName}, Server: ${meta.server}, Speed limit: ${meta.speedLimit ?? 0} B/s`);

    store.upsert(task);

    manager.add(task).catch((err) => {
      console.error('[Enqueue] manager.add failed:', err);
      const current = store.getById(id);
      if (current && current.status === 'pending') {
        store.upsert({ ...current, status: 'failed', error: err?.message || 'Failed to enqueue' });
      }
    }).finally(() => {
      setTimeout(() => pendingEnqueues.delete(key), 2000);
    });

    return id;
  };
}

function createControl(manager: DownloadManager, store: IDownloadStore) {
  return async function control(action: ControlAction, target?: ControlTarget) {
    let ids: string[] = [];
    if (!target) { ids = store.getAll().map((t) => t.id); }
    else if (typeof target === 'string') { ids = [target]; }
    else if (Array.isArray(target)) { ids = target; }
    else if (target.status) {
      const statuses = Array.isArray(target.status) ? target.status : [target.status];
      ids = store.getAll().filter((t) => statuses.includes(t.status)).map((t) => t.id);
    }

    for (const id of ids) {
      const task = store.getById(id);
      if (!task) continue;
      switch (action) {
        case 'pause': {
          if (task.status !== 'downloading') break;
          await manager.pause(id);
          break;
        }
        case 'resume': {
          if (task.status === 'paused') {
            await manager.resume(id);
          } else if (task.status === 'failed' || task.status === 'cancelled') {
            await manager.retry(id);
          }
          break;
        }
        case 'cancel': { await manager.cancel(id); break; }
        case 'retry': { await manager.retry(id); break; }
        case 'remove': { await manager.remove(id); await store.remove(id); break; }
      }
    }
  };
}
```

### File 7: `store.ts` — Observable In-Memory Store

```typescript
// apps/mobile/lib/download/store.ts

import type {
  DownloadTask,
  DownloadStatus,
  Unsubscribe,
  StorageAdapter,
} from "./types";

export interface IDownloadStore {
  getAll(): DownloadTask[];
  getById(id: string): DownloadTask | undefined;
  getByMedia(tmdbId: string, server?: string): DownloadTask[];
  getBySeason(tmdbId: string, season: number): DownloadTask[];
  upsert(task: DownloadTask): Promise<void>;
  replaceAll(tasks: DownloadTask[]): Promise<void>;
  remove(id: string): Promise<void>;
  clearCompleted(): Promise<void>;
  subscribe(cb: (tasks: DownloadTask[]) => void): Unsubscribe;
  subscribeTask(
    taskId: string,
    cb: (task: DownloadTask | undefined) => void,
  ): Unsubscribe;
  subscribeLoaded(cb: (loaded: boolean) => void): Unsubscribe;
  load(): Promise<DownloadTask[]>;
  isLoaded(): boolean;
}

let _sqliteDb: any = null;
async function getSQLite(): Promise<
  typeof import("./database").DownloadDatabase | null
> {
  if (_sqliteDb) return _sqliteDb;
  try {
    const { DownloadDatabase } = require("./database");
    _sqliteDb = DownloadDatabase;
    return _sqliteDb;
  } catch {
    return null;
  }
}

export function createDownloadStore(adapter?: StorageAdapter): IDownloadStore {
  let tasks: DownloadTask[] = [];
  let loaded = false;
  const allListeners = new Set<(tasks: DownloadTask[]) => void>();
  const taskListeners = new Map<
    string,
    Set<(task: DownloadTask | undefined) => void>
  >();
  const loadedListeners = new Set<(loaded: boolean) => void>();
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let persistPromise: Promise<void> | null = null;

  function notifyAll() {
    const snapshot = tasks;
    for (const cb of allListeners) {
      try {
        cb(snapshot);
      } catch {}
    }
  }

  function notifyTask(id: string) {
    const set = taskListeners.get(id);
    if (!set) return;
    const task = tasks.find((t) => t.id === id);
    for (const cb of set) {
      try {
        cb(task);
      } catch {}
    }
  }

  function notifyLoaded() {
    for (const cb of loadedListeners) {
      try {
        cb(loaded);
      } catch {}
    }
  }

  function markUpdated() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistPromise = persistAll();
    }, 1000);
  }

  async function persistAll() {
    const db = await getSQLite();
    if (!db) {
      if (adapter) {
        const STORAGE_KEY = "@filmsnaps/downloads/v2";
        const toPersist = tasks.map((t) => ({
          ...t,
          resumeData:
            t.status === "completed" || t.status === "cancelled"
              ? null
              : t.resumeData,
        }));
        await adapter.setItem(STORAGE_KEY, JSON.stringify(toPersist));
      }
      return;
    }
    const results = await Promise.allSettled(
      tasks.map((task) => db.update({ ...task } as any)),
    );
    for (const r of results) {
      if (r.status === "rejected")
        console.warn("[Store] SQLite persist failed:", r.reason);
    }
  }

  function update(updated: DownloadTask[], changedIds: string[]) {
    tasks = updated;
    notifyAll();
    for (const id of changedIds) {
      notifyTask(id);
    }
    markUpdated();
  }

  return {
    getAll() {
      return tasks;
    },
    getById(id: string) {
      return tasks.find((t) => t.id === id);
    },
    getByMedia(tmdbId: string, server?: string) {
      return tasks.filter((t) => {
        if (t.tmdbId !== tmdbId) return false;
        if (server && t.server !== server) return false;
        return true;
      });
    },
    getBySeason(tmdbId: string, season: number) {
      return tasks.filter((t) => t.tmdbId === tmdbId && t.season === season);
    },

    async upsert(task: DownloadTask) {
      const db = await getSQLite();
      if (db) {
        try {
          await db.insert(task);
        } catch (e) {
          console.warn("[Store] SQLite insert failed:", e);
        }
      } else if (adapter) {
        const STORAGE_KEY = "@filmsnaps/downloads/v2";
        try {
          const raw = await adapter.getItem(STORAGE_KEY);
          const all: DownloadTask[] = raw ? JSON.parse(raw) : [];
          const idx = all.findIndex((t) => t.id === task.id);
          const updated = { ...task, updatedAt: Date.now() };
          if (idx >= 0) all[idx] = updated;
          else all.unshift(updated);
          await adapter.setItem(STORAGE_KEY, JSON.stringify(all));
        } catch {}
      }

      const idx = tasks.findIndex((t) => t.id === task.id);
      const updated = { ...task, updatedAt: Date.now() };
      if (idx >= 0) {
        const copy = [...tasks];
        copy[idx] = updated;
        update(copy, [task.id]);
      } else {
        update([updated, ...tasks], [task.id]);
      }
    },

    async replaceAll(newTasks: DownloadTask[]) {
      const db = await getSQLite();
      if (db) {
        try {
          for (const t of tasks) {
            try {
              await db.delete(t.id);
            } catch {}
          }
          for (const t of newTasks) {
            try {
              await db.insert(t);
            } catch {}
          }
        } catch (e) {
          console.warn("[Store] SQLite replaceAll failed:", e);
        }
      } else if (adapter) {
        const STORAGE_KEY = "@filmsnaps/downloads/v2";
        await adapter.setItem(STORAGE_KEY, JSON.stringify(newTasks));
      }
      const allIds = [
        ...new Set([...tasks.map((t) => t.id), ...newTasks.map((t) => t.id)]),
      ];
      tasks = newTasks;
      loaded = true;
      notifyAll();
      for (const id of allIds) notifyTask(id);
      notifyLoaded();
    },

    async remove(id: string) {
      const db = await getSQLite();
      if (db) {
        try {
          await db.delete(id);
        } catch {}
      }
      if (adapter) {
        const STORAGE_KEY = "@filmsnaps/downloads/v2";
        try {
          const raw = await adapter.getItem(STORAGE_KEY);
          if (raw) {
            await adapter.setItem(
              STORAGE_KEY,
              JSON.stringify(JSON.parse(raw).filter((t: any) => t.id !== id)),
            );
          }
        } catch {}
      }
      const removed = tasks.find((t) => t.id === id);
      if (!removed) return;
      update(
        tasks.filter((t) => t.id !== id),
        [id],
      );
    },

    async clearCompleted() {
      const db = await getSQLite();
      if (db) {
        try {
          await db.deleteCompleted();
        } catch {}
      }
      const removedIds = tasks
        .filter((t) => t.status === "completed" || t.status === "cancelled")
        .map((t) => t.id);
      if (removedIds.length === 0) return;
      update(
        tasks.filter(
          (t) => t.status !== "completed" && t.status !== "cancelled",
        ),
        removedIds,
      );
    },

    subscribe(cb: (tasks: DownloadTask[]) => void): Unsubscribe {
      allListeners.add(cb);
      try {
        cb(tasks);
      } catch {}
      return () => {
        allListeners.delete(cb);
      };
    },

    subscribeTask(
      taskId: string,
      cb: (task: DownloadTask | undefined) => void,
    ): Unsubscribe {
      let set = taskListeners.get(taskId);
      if (!set) {
        set = new Set();
        taskListeners.set(taskId, set);
      }
      set.add(cb);
      try {
        cb(tasks.find((t) => t.id === taskId));
      } catch {}
      return () => {
        set!.delete(cb);
        if (set!.size === 0) taskListeners.delete(taskId);
      };
    },

    subscribeLoaded(cb: (loaded: boolean) => void): Unsubscribe {
      loadedListeners.add(cb);
      try {
        cb(loaded);
      } catch {}
      return () => {
        loadedListeners.delete(cb);
      };
    },

    async load(): Promise<DownloadTask[]> {
      const db = await getSQLite();
      if (db) {
        try {
          const all = await db.getAll();
          tasks = (all || []).map((t: DownloadTask) =>
            t.status === "downloading" || t.status === "pending"
              ? {
                  ...t,
                  status: "paused" as DownloadStatus,
                  error: "App was closed. Tap resume to continue.",
                }
              : t,
          );
        } catch (e) {
          console.warn("[Store] SQLite load failed:", e);
        }
      }
      if (tasks.length === 0 && adapter) {
        try {
          const STORAGE_KEY = "@filmsnaps/downloads/v2";
          const raw = await adapter.getItem(STORAGE_KEY);
          if (raw) {
            const parsed: DownloadTask[] = JSON.parse(raw);
            tasks = parsed.map((t) =>
              t.status === "downloading" || t.status === "pending"
                ? {
                    ...t,
                    status: "paused" as DownloadStatus,
                    error: "App was closed. Tap resume to continue.",
                  }
                : t,
            );
            const sqlDb = await getSQLite();
            if (sqlDb && tasks.length > 0) {
              for (const task of tasks) {
                try {
                  await sqlDb.insert(task);
                } catch {}
              }
              try {
                await adapter.removeItem(STORAGE_KEY);
              } catch {}
            }
          }
        } catch (e) {
          console.warn("[Store] Adapter load failed:", e);
        }
      }
      loaded = true;
      notifyAll();
      notifyLoaded();
      return tasks;
    },

    isLoaded() {
      return loaded;
    },
  };
}

import AsyncStorage from "@react-native-async-storage/async-storage";

export function createAsyncStorageAdapter(): StorageAdapter {
  return {
    async getItem(key: string): Promise<string | null> {
      return AsyncStorage.getItem(key);
    },
    async setItem(key: string, value: string): Promise<void> {
      await AsyncStorage.setItem(key, value);
    },
    async removeItem(key: string): Promise<void> {
      await AsyncStorage.removeItem(key);
    },
  };
}

export function createMemoryAdapter(): StorageAdapter {
  const store = new Map<string, string>();
  return {
    async getItem(key: string) {
      return store.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      store.set(key, value);
    },
    async removeItem(key: string) {
      store.delete(key);
    },
  };
}
```

### File 8: `useDownload.ts` — React Hook

```typescript
// apps/mobile/lib/download/useDownload.ts

import { useCallback } from "react";
import { useSyncExternalStore } from "react";
import { useDownloadInfra } from "./context";
import type { DownloadTask } from "./types";

export interface UseDownloadReturn {
  task: DownloadTask | undefined;
  progress: number;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: () => Promise<void>;
  retry: () => Promise<void>;
  remove: () => Promise<void>;
}

export function useDownload(taskId: string | undefined): UseDownloadReturn {
  const { store, manager } = useDownloadInfra();

  const task = useSyncExternalStore(
    (cb) => (taskId ? store.subscribeTask(taskId, () => cb()) : () => {}),
    () => (taskId ? store.getById(taskId) : undefined),
  );

  const progress =
    task && task.totalBytes > 0 ? task.receivedBytes / task.totalBytes : 0;

  const pause = useCallback(async () => {
    if (!taskId) return;
    await manager.pause(taskId);
  }, [taskId, manager]);

  const resume = useCallback(async () => {
    if (!taskId) return;
    const current = store.getById(taskId);
    if (!current) return;
    if (current.status === "paused") {
      await manager.resume(taskId);
    } else if (current.status === "failed" || current.status === "cancelled") {
      await manager.retry(taskId);
    }
  }, [taskId, manager, store]);

  const cancel = useCallback(async () => {
    if (!taskId) return;
    await manager.cancel(taskId);
  }, [taskId, manager]);

  const retry = useCallback(async () => {
    if (!taskId) return;
    await manager.retry(taskId);
  }, [taskId, manager]);

  const remove = useCallback(async () => {
    if (!taskId) return;
    await manager.remove(taskId);
    await store.remove(taskId);
  }, [taskId, manager, store]);

  return { task, progress, pause, resume, cancel, retry, remove };
}
```

### File 9: `useDownloadQueue.ts` — Queue Monitor Hook

```typescript
// apps/mobile/lib/download/useDownloadQueue.ts

import { useEffect, useState } from "react";
import { useDownloadInfra } from "./context";

export interface QueueConfig {
  maxConcurrent?: number;
}
export interface QueueState {
  activeCount: number;
  queuedCount: number;
}

export function useDownloadQueue(config?: QueueConfig): QueueState {
  const { manager } = useDownloadInfra();
  const [state, setState] = useState<QueueState>({
    activeCount: 0,
    queuedCount: 0,
  });

  useEffect(() => {
    const unsub = manager.onQueueChange(() => {
      setState({
        activeCount: manager.activeCount,
        queuedCount: manager.queuedCount,
      });
    });

    setState({
      activeCount: manager.activeCount,
      queuedCount: manager.queuedCount,
    });

    return unsub;
  }, [manager]);

  return state;
}
```

---

## Data Flow Analysis

### Data Flow for Progress Updates

```
RNFB fetch .progress(received, total)
  → BlobDownloaderAdapter.downloadFullSpeed() options.onProgress(received, total)
    → DownloadManager.startDownload() onProgress callback
      → emitProgress(task.id, adjustedReceived, adjustedTotal, speed, eta)
        → DownloadInfraProvider effect: manager.onProgress((p) => { store.upsert({...existing, ...}) })
          → createDownloadStore.upsert(task)
            → update() → notifyAll() + notifyTask(id)
              → useSyncExternalStore in useDownload()
                → React re-render with new progress
```

### Data Flow for Pause/Resume

```
User taps "pause"
  → useDownload.pause() → manager.pause(taskId)
    → instance.pause() (cancels RNFB native fetch)
    → activeInstances.delete(taskId)
    → reads receivedBytes from DB
    → persists resumeData = String(receivedBytes) and status = 'paused'
    → emitStatus(taskId, 'paused')
      → DownloadInfraProvider effect: store.upsert(update)
        → React re-renders with 'paused' status

User taps "resume"
  → useDownload.resume() → manager.resume(taskId)
    → sets status = 'pending'
    → adds to queue
    → processQueue()
      → startDownload(task)
        → reads resumeData from DB
        → sets Range: bytes={resumeData}-
        → adapter.download() with Range header
```

---

## Questions for the Expert

### Bug 1: Progress Bar Not Updating (Critical)

**We need exact code for the fix.**

The `BlobDownloader` confirms progress callbacks fire correctly (18MB, 25MB logged), but the React UI shows only 9.5MB. The progress update flow goes:

```
RNFB .progress() → onProgress() → emitProgress() → store.upsert() → notifyAll() → React re-render
```

**Possible causes:**

1. `store.upsert()` uses `db.insert()` (INSERT OR REPLACE) instead of `db.update()` — this writes a FULL row even when only progress changed, which may cause write contention
2. The 1-second debounce timer in `markUpdated() + persistAll()` creates a stale closure — by the time `persistAll` runs, it iterates over ALL tasks and updates them, potentially overwriting newer progress with older data
3. `useSyncExternalStore` snapshot — the store's `subscribe()` callback fires, but the snapshot returns an outdated reference because `store.upsert` creates a new object for the updated task but the array reference stays the same

**Q1:** Should `store.upsert()` for progress updates use `DownloadDatabase.update()` (partial, only changed fields) instead of `DownloadDatabase.insert()` (full row replace)? Provide exact code.

**Q2:** The `persistAll()` function in store.ts iterates ALL tasks and calls `db.update()` on each, debounced at 1s. Could a stale closure cause `persistAll` to overwrite a task's state with an older snapshot? Should we skip `persistAll` entirely for progress-only changes? Provide exact code.

**Q3:** In the `update()` function inside `store.ts`, line `tasks = updated` replaces the entire array. Does React's `useSyncExternalStore` detect changes by reference equality on the returned value? If `store.getAll()` returns the same array reference every time (after the first snapshot), even though a task inside it was mutated, would React skip the re-render? Provide exact code to fix this.

### Bug 2: Pause/Resume Restarts from 0 (Critical)

**We need exact code for the fix.**

Logs confirm `[BlobDownloader] Download paused` fires with 30MB received, and the resumed download shows `Resume: false`.

**Possible causes:**

1. `manager.pause()` reads `receivedBytes` from DB, but the DB may have stale data because progress DB writes are throttled to 2s — between the last save and pause, up to 2s of progress is lost
2. `manager.resume()` does NOT read `resumeData` from DB before re-enqueuing — it only sets status to 'pending'. When `processQueue` → `startDownload` runs, it reads the task from DB, which should have `resumeData`... but see #3
3. The `processQueue` re-entrancy guard may be running a stale `DownloadTask` object that doesn't reflect the latest DB state
4. When `pause()` calls `this.processQueue()` at the end, and `resume()` also calls `this.processQueue()`, the re-entrancy guard causes issues

**Q4:** In `manager.pause()` — the code reads `task?.receivedBytes` from DB, then persists it as `resumeData`. But the `DownloadDatabase.update()` call at line 249-253 writes `status='paused'` and `resumeData`. Does the DB write succeed atomically? Could there be a race between two SQLite writes? Provide exact code to guarantee atomicity.

**Q5:** In `manager.startDownload()` — should we re-read the task from DB RIGHT BEFORE starting the adapter download to ensure we have the freshest `resumeData`? Currently line 560-565 reads `task.resumeData` (passed in from `processQueue` which got it earlier). Provide exact code.

**Q6:** The `startDownload` method checks `if (task.resumeData)` and sets the Range header. But if `task.resumeData` is a string like `"30142901"`, this should work — does RNFB handle this correctly? Should we add a separate head-request probe before the actual download to confirm the server supports Range requests? Provide exact code.

### Critical Question

**Q7:** Please provide COMPLETE code for a `resume()` implementation that:

1. Reads the freshest task from DB (including `resumeData`)
2. Validates the partial file exists on disk and its size matches `resumeData`
3. Sends a proper `Range` request
4. Handles servers that don't support Range (fall back to full download)
5. Handles servers that respond with 200 (full file) instead of 206 (partial content)

Also, should we switch to `react-native-blob-util`'s `addAndroidDownloads { useDownloadManager: true }` for actual resume support, since Android's DownloadManager handles Range requests natively?

---

## Summary

Two critical bugs need exact code fixes:

1. **Progress bar freeze**: The download engine fires progress correctly (`BlobDownloader` logs show 18MB, 25MB), but the React UI never updates past ~9.5MB. The bug is in the data flow between `emitProgress() → store.upsert() → useSyncExternalStore → React`.

2. **Pause/resume restart from 0**: `resumeData` is lost during the pause-resume cycle. The manager pauses at 30MB, but resume starts with `Resume: false`, sending no Range header and downloading from byte 0.

Please provide exact implementation code for all fixes. Do not write pseudo-code — provide the exact TypeScript/React Native code we should use.
