/**
 * Download Database — SQLite persistence for download metadata.
 *
 * Replaces AsyncStorage JSON blobs with proper relational storage.
 * Provides ACID transactions, indexed queries, and efficient updates.
 */

import * as SQLite from "expo-sqlite";
import type { DownloadTask, DownloadStatus } from "./types";
import { logger } from "./logger";

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
      dbPromise = null;
      throw e;
    }
  })();
  return dbPromise;
}

async function initializeDatabase(
  database: SQLite.SQLiteDatabase,
): Promise<void> {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS downloads (
      id TEXT PRIMARY KEY,
      media_id TEXT,
      media_type TEXT NOT NULL DEFAULT 'movie',
      title TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL,
      file_path TEXT,
      file_size INTEGER DEFAULT 0,
      downloaded_bytes INTEGER DEFAULT 0,
      progress REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER DEFAULT 1,
      speed_limit INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      error_message TEXT,
      error_type TEXT,
      server TEXT NOT NULL DEFAULT 'falix',
      quality TEXT,
      season INTEGER,
      episode INTEGER,
      extension TEXT DEFAULT 'mp4',
      resume_data TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      file_name TEXT,
      poster_path TEXT,
      native_task_id TEXT,
      expected_hash TEXT,
      started_on_wifi INTEGER DEFAULT 0
    );
  `);

  // ─── SCHEMA MIGRATION: Add new columns if they don't exist ───
  const columns = await database.getAllAsync<{ name: string }>(
    "PRAGMA table_info(downloads)",
  );
  const columnNames = new Set(columns.map((c) => c.name));

  const migrations: Array<{ column: string; sql: string }> = [
    {
      column: "native_task_id",
      sql: "ALTER TABLE downloads ADD COLUMN native_task_id TEXT",
    },
    {
      column: "expected_hash",
      sql: "ALTER TABLE downloads ADD COLUMN expected_hash TEXT",
    },
    {
      column: "started_on_wifi",
      sql: "ALTER TABLE downloads ADD COLUMN started_on_wifi INTEGER DEFAULT 0",
    },
  ];

  for (const migration of migrations) {
    if (!columnNames.has(migration.column)) {
      await database.execAsync(migration.sql);
    }
  }

  // Index for common queries
  await database.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
    CREATE INDEX IF NOT EXISTS idx_downloads_media ON downloads(media_id);
  `);
}

// ─── Row Mapping ───

interface DownloadRow {
  id: string;
  media_id: string | null;
  media_type: string;
  title: string;
  url: string;
  file_path: string | null;
  file_size: number;
  downloaded_bytes: number;
  status: string;
  priority: number;
  speed_limit: number;
  retry_count: number;
  max_retries: number;
  error_message: string | null;
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
  native_task_id: string | null;
  expected_hash: string | null;
  started_on_wifi: number;
}

function rowToTask(row: DownloadRow): DownloadTask {
  return {
    id: row.id,
    tmdbId: row.media_id ?? undefined,
    mediaType: (row.media_type as "movie" | "tv") ?? "movie",
    title: row.title ?? undefined,
    url: row.url,
    fileUri: row.file_path,
    totalBytes: Number(row.file_size) || 0,
    receivedBytes: Number(row.downloaded_bytes) || 0,
    status: row.status as DownloadStatus,
    priority: row.priority ?? 1,
    speedLimit: row.speed_limit ?? 0,
    retryCount: row.retry_count ?? 0,
    maxRetries: row.max_retries ?? 3,
    error: row.error_message ?? undefined,
    server: row.server as DownloadTask["server"],
    quality: row.quality ?? undefined,
    season: row.season ?? undefined,
    episode: row.episode ?? undefined,
    extension: row.extension ?? "mp4",
    resumeData: row.resume_data != null ? String(row.resume_data) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fileName: row.file_name ?? row.title ?? "download",
    posterPath: row.poster_path ?? undefined,
    nativeTaskId: row.native_task_id ?? null,
    expectedHash: row.expected_hash ?? null,
    startedOnWifi: row.started_on_wifi === 1,
  };
}

// ─── Public API ───

export const DownloadDatabase = {
  async insert(task: DownloadTask): Promise<void> {
    logger.debug(
      "DB insert:",
      task.id,
      task.status,
      "receivedBytes=",
      task.receivedBytes,
      "totalBytes=",
      task.totalBytes,
    );
    const database = await getDatabase();
    await database.runAsync(
      `INSERT OR REPLACE INTO downloads (
        id, media_id, media_type, title, url, file_path, file_size,
        downloaded_bytes, status, priority, speed_limit, retry_count,
        max_retries, error_message, server, quality, season, episode,
        extension, resume_data, created_at, updated_at, file_name,
        poster_path, native_task_id, expected_hash, started_on_wifi
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.tmdbId ?? null,
        task.mediaType ?? "movie",
        task.title ?? "",
        task.url,
        task.fileUri ?? null,
        task.totalBytes ?? 0,
        task.receivedBytes ?? 0,
        task.status,
        task.priority ?? 1,
        task.speedLimit ?? 0,
        task.retryCount ?? 0,
        task.maxRetries ?? 3,
        task.error ?? null,
        task.server,
        task.quality ?? null,
        task.season ?? null,
        task.episode ?? null,
        task.extension ?? "mp4",
        task.resumeData ?? null,
        task.createdAt,
        task.updatedAt,
        task.fileName ?? null,
        task.posterPath ?? null,
        task.nativeTaskId ?? null,
        task.expectedHash ?? null,
        task.startedOnWifi ? 1 : 0,
      ],
    );
  },

  async update(fields: Partial<DownloadTask> & { id: string }): Promise<void> {
    // Bug G fix: only log fields that are actually being updated,
    // so we never print status=undefined during progress-only updates.
    const logParts = Object.entries(fields)
      .filter(([key, value]) => key !== "id" && value !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    logger.debug("DB update:", fields.id, logParts);
    const database = await getDatabase();
    const sets: string[] = [];
    const values: any[] = [];

    const fieldMap: Record<string, [string, (v: any) => any]> = {
      status: ["status", (v) => v],
      fileUri: ["file_path", (v) => v],
      totalBytes: ["file_size", (v) => v],
      receivedBytes: ["downloaded_bytes", (v) => v],
      error: ["error_message", (v) => v],
      resumeData: ["resume_data", (v) => (v != null ? String(v) : null)],
      retryCount: ["retry_count", (v) => v],
      priority: ["priority", (v) => v],
      nativeTaskId: ["native_task_id", (v) => v],
      expectedHash: ["expected_hash", (v) => v],
      startedOnWifi: ["started_on_wifi", (v) => (v ? 1 : 0)],
      updatedAt: ["updated_at", (v) => v],
      fileName: ["file_name", (v) => v],
      posterPath: ["poster_path", (v) => v],
    };

    for (const [key, [column, transform]] of Object.entries(fieldMap)) {
      if (key in fields && (fields as any)[key] !== undefined) {
        sets.push(`${column} = ?`);
        values.push(transform((fields as any)[key]));
      }
    }

    if (sets.length === 0) return;
    values.push(fields.id);

    await database.runAsync(
      `UPDATE downloads SET ${sets.join(", ")} WHERE id = ?`,
      values,
    );
  },

  async getById(id: string): Promise<DownloadTask | null> {
    const database = await getDatabase();
    const row = await database.getFirstAsync<DownloadRow>(
      "SELECT * FROM downloads WHERE id = ?",
      [id],
    );
    if (!row) logger.debug("DB getById: id=", id, "— not found");
    return row ? rowToTask(row) : null;
  },

  async getAll(): Promise<DownloadTask[]> {
    logger.debug("DB getAll: starting");
    const database = await getDatabase();
    const rows = await database.getAllAsync<DownloadRow>(
      "SELECT * FROM downloads ORDER BY created_at DESC",
    );
    logger.debug("DB getAll: returned", rows.length, "rows");
    return rows.map(rowToTask);
  },

  async getByStatus(status: DownloadStatus): Promise<DownloadTask[]> {
    logger.debug("DB getByStatus:", status);
    const database = await getDatabase();
    const rows = await database.getAllAsync<DownloadRow>(
      "SELECT * FROM downloads WHERE status = ? ORDER BY created_at DESC",
      [status],
    );
    logger.debug("DB getByStatus:", status, "returned", rows.length, "rows");
    return rows.map(rowToTask);
  },

  async getByMediaId(mediaId: string): Promise<DownloadTask[]> {
    logger.debug("DB getByMediaId:", mediaId);
    const database = await getDatabase();
    const rows = await database.getAllAsync<DownloadRow>(
      "SELECT * FROM downloads WHERE media_id = ? ORDER BY created_at DESC",
      [mediaId],
    );
    return rows.map(rowToTask);
  },

  async getBySeason(mediaId: string, season: number): Promise<DownloadTask[]> {
    logger.debug("DB getBySeason:", mediaId, season);
    const database = await getDatabase();
    const rows = await database.getAllAsync<DownloadRow>(
      "SELECT * FROM downloads WHERE media_id = ? AND season = ? ORDER BY episode ASC",
      [mediaId, season],
    );
    return rows.map(rowToTask);
  },

  async delete(id: string): Promise<void> {
    logger.debug("DB delete:", id);
    const database = await getDatabase();
    await database.runAsync("DELETE FROM downloads WHERE id = ?", [id]);
  },

  async deleteCompleted(): Promise<void> {
    logger.debug("DB deleteCompleted");
    const database = await getDatabase();
    await database.runAsync("DELETE FROM downloads WHERE status = 'completed'");
  },

  async deleteCancelled(): Promise<void> {
    logger.debug("DB deleteCancelled");
    const database = await getDatabase();
    await database.runAsync("DELETE FROM downloads WHERE status = 'cancelled'");
  },

  async getCountByStatus(status: DownloadStatus): Promise<number> {
    const database = await getDatabase();
    const result = await database.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM downloads WHERE status = ?",
      [status],
    );
    const count = result?.count ?? 0;
    logger.debug("DB getCountByStatus:", status, count);
    return count;
  },

  async getStorageUsed(): Promise<number> {
    const database = await getDatabase();
    const result = await database.getFirstAsync<{ total: number }>(
      "SELECT COALESCE(SUM(file_size), 0) as total FROM downloads WHERE status = 'completed'",
    );
    const total = result?.total ?? 0;
    logger.debug("DB getStorageUsed:", total);
    return total;
  },

  async close(): Promise<void> {
    if (db) {
      await db.closeAsync();
      db = null;
      dbPromise = null;
    }
  },
};
