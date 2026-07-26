/**
 * Download Database — SQLite persistence for download metadata.
 *
 * Replaces AsyncStorage JSON blobs with proper relational storage.
 * Provides ACID transactions, indexed queries, and efficient updates.
 */

import * as SQLite from "expo-sqlite";
import type { DownloadTask, DownloadStatus } from "./types";

// ── Database Instance ──

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

// ── Schema ──

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

  // Check and run migrations if columns are missing
  try {
    const tableInfo = await database.getAllAsync<{ name: string }>(
      "PRAGMA table_info(downloads)",
    );
    const columns = tableInfo.map((info) => info.name);

    if (!columns.includes("file_name")) {
      await database.execAsync(
        "ALTER TABLE downloads ADD COLUMN file_name TEXT;",
      );
      console.log(
        "[Database] Migrated downloads table: added file_name column",
      );
    }
    if (!columns.includes("poster_path")) {
      await database.execAsync(
        "ALTER TABLE downloads ADD COLUMN poster_path TEXT;",
      );
      console.log(
        "[Database] Migrated downloads table: added poster_path column",
      );
    }
  } catch (e) {
    console.error("[Database] Migration failed:", e);
  }
}

// ── Row Type ──

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

// ── Conversion ──

function rowToTask(row: DownloadRow): DownloadTask {
  return {
    id: row.id,
    tmdbId: row.media_id,
    mediaType: row.media_type as "movie" | "tv",
    title: row.title,
    url: row.url,
    fileName: row.file_name || row.title || "download",
    fileUri: row.file_path,
    // FIX: Coerce byte columns to number — SQLite can return TEXT if column was migrated
    totalBytes: Number(row.file_size) || 0,
    receivedBytes: Number(row.downloaded_bytes) || 0,
    status: row.status as DownloadStatus,
    error: row.error_message ?? undefined,
    server: row.server as any,
    quality: row.quality ?? undefined,
    season: row.season ?? undefined,
    episode: row.episode ?? undefined,
    extension: row.extension,
    // FIX: Force resumeData to be a clean string or null — never a number
    resumeData: row.resume_data != null ? String(row.resume_data) : null,
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

// ── Public API ──

export const DownloadDatabase = {
  /**
   * Insert a new download task
   */
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

  /**
   * Update a download task
   */
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
    // FIX: Always coerce to string or null — prevents INTEGER storage in TEXT column
    if (task.resumeData !== undefined) {
      fields.push("resume_data = ?");
      values.push(task.resumeData != null ? String(task.resumeData) : null);
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

  /**
   * Get a download task by ID
   */
  async getById(id: string): Promise<DownloadTask | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<DownloadRow>(
      "SELECT * FROM downloads WHERE id = ?",
      [id],
    );
    return row ? rowToTask(row) : null;
  },

  /**
   * Get all downloads
   */
  async getAll(): Promise<DownloadTask[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<DownloadRow>(
      "SELECT * FROM downloads ORDER BY created_at DESC",
    );
    return rows.map(rowToTask);
  },

  /**
   * Get downloads by status
   */
  async getByStatus(status: DownloadStatus): Promise<DownloadTask[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<DownloadRow>(
      "SELECT * FROM downloads WHERE status = ? ORDER BY priority ASC, created_at ASC",
      [status],
    );
    return rows.map(rowToTask);
  },

  /**
   * Get downloads by media ID
   */
  async getByMediaId(mediaId: string): Promise<DownloadTask[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<DownloadRow>(
      "SELECT * FROM downloads WHERE media_id = ? ORDER BY created_at DESC",
      [mediaId],
    );
    return rows.map(rowToTask);
  },

  /**
   * Get downloads by season
   */
  async getBySeason(mediaId: string, season: number): Promise<DownloadTask[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<DownloadRow>(
      "SELECT * FROM downloads WHERE media_id = ? AND season = ? ORDER BY episode ASC",
      [mediaId, season],
    );
    return rows.map(rowToTask);
  },

  /**
   * Delete a download task
   */
  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync("DELETE FROM downloads WHERE id = ?", [id]);
  },

  /**
   * Delete all completed downloads
   */
  async deleteCompleted(): Promise<void> {
    const db = await getDatabase();
    await db.runAsync("DELETE FROM downloads WHERE status = 'completed'");
  },

  /**
   * Delete all cancelled downloads
   */
  async deleteCancelled(): Promise<void> {
    const db = await getDatabase();
    await db.runAsync("DELETE FROM downloads WHERE status = 'cancelled'");
  },

  /**
   * Get download count by status
   */
  async getCountByStatus(status: DownloadStatus): Promise<number> {
    const db = await getDatabase();
    const result = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM downloads WHERE status = ?",
      [status],
    );
    return result?.count ?? 0;
  },

  /**
   * Get total storage used by downloads
   */
  async getStorageUsed(): Promise<number> {
    const db = await getDatabase();
    const result = await db.getFirstAsync<{ total: number }>(
      "SELECT COALESCE(SUM(file_size), 0) as total FROM downloads WHERE status = 'completed'",
    );
    return result?.total ?? 0;
  },

  /**
   * Mark stale active tasks as paused (for app restart recovery)
   */
  async recoverStaleTasks(): Promise<number> {
    const db = await getDatabase();
    const result = await db.runAsync(
      "UPDATE downloads SET status = 'paused', error_message = 'App was closed. Tap resume to continue.' WHERE status IN ('downloading', 'pending')",
    );
    return result.changes;
  },

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (db) {
      await db.closeAsync();
      db = null;
    }
  },
};
