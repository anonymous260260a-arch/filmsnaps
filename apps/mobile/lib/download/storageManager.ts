/**
 * Storage Manager — Space management for downloads.
 *
 * Uses fsCompat for SDK 55 compatibility (Bugs A, D) and fileNameUtils
 * for safe path construction (Bug B).
 */

import { DownloadDatabase } from "./database";
import { deleteFile, ensureDirectory, getNativeDownloadDir } from "./fsCompat";
import { buildFileName, sanitizeForNative } from "./fileNameUtils";

/** The platform-aware download directory (matches native module paths). */
const DOWNLOAD_DIR = getNativeDownloadDir();
const MIN_FREE_SPACE_BYTES = 500 * 1024 * 1024; // 500 MB minimum free

export class StorageManager {
  /**
   * Provider for real device storage, supplied by the download manager
   * (which bridges to the native FilmsnapsDownloader.getAvailableStorage() ->
   * Android StatFs / iOS volume capacity). Returns both `free` (available)
   * and `total` (device capacity). When present it is the authority; the
   * legacy expo-file-system heuristic is only a fallback.
   */
  private spaceProvider?: () => Promise<{ free: number; total: number }>;
  private lastSpace: { free: number; total: number } | null = null;

  constructor(spaceProvider?: () => Promise<{ free: number; total: number }>) {
    this.spaceProvider = spaceProvider;
  }

  /**
   * Get device free + total storage (bytes). Prefers the native provider,
   * falls back to a conservative estimate when unavailable.
   */
  async getStorageInfo(): Promise<{ free: number; total: number }> {
    if (this.spaceProvider) {
      try {
        const r = await this.spaceProvider();
        const free = typeof r?.free === "number" ? r.free : 0;
        const total = typeof r?.total === "number" ? r.total : 0;
        if (free > 0) {
          this.lastSpace = { free, total: total > 0 ? total : free };
          return this.lastSpace;
        }
        // free <= 0 from the native provider almost always means a measurement
        // failure (StatFs hiccup, module not ready), NOT a genuinely empty
        // device. Fall through to the estimate below rather than blocking all
        // downloads on a transient 0.
      } catch {
        // measurement failed — fall through to estimate
      }
    }
    // Fallback: the download directory is guaranteed to exist (getNativeDownloadDir
    // calls ensureDirectory at module load), so a usable device has space. Return a
    // conservative positive estimate instead of {0,0}, which would otherwise block
    // every download on a transient measurement failure. A real disk-full condition
    // is still surfaced later by the native write itself.
    const est = 2 * 1024 * 1024 * 1024; // 2 GB conservative estimate
    this.lastSpace = { free: est, total: est };
    return this.lastSpace;
  }

  /** Real device free space in bytes (used by the space-fit check). */
  async getFreeSpace(): Promise<number> {
    return (await this.getStorageInfo()).free;
  }

  /** Real device total capacity in bytes (used by the storage meter UI). */
  async getTotalSpace(): Promise<number> {
    return (await this.getStorageInfo()).total;
  }

  /**
   * Check if there's enough space for a download of the given size.
   * If estimatedSize is 0 (unknown), checks for minimum free space.
   */
  async canFit(
    estimatedBytes: number,
  ): Promise<{ ok: boolean; freeBytes: number }> {
    const freeBytes = await this.getFreeSpace();
    // Reserve the configured minimum free space as a safety buffer. For an
    // unknown size (estimatedBytes === 0 — the normal case at enqueue, before
    // the HTTP Content-Length arrives) we require only the buffer, not an extra
    // buffer on top of it. The real file size is reconciled when the download
    // runs; a genuinely too-large download fails at the native write, not here.
    const needed = estimatedBytes > 0 ? estimatedBytes : 0;
    return {
      ok: freeBytes >= needed + MIN_FREE_SPACE_BYTES,
      freeBytes,
    };
  }

  /**
   * Get total storage used by Filmsnaps downloads.
   *
   * Source of truth is the local download DB (sum of `file_size` for completed
   * tasks) — O(1), no filesystem walk. The physical file may now live in the
   * MediaStore Downloads collection (a `content://` URI, not a path we own), so
   * walking a directory would be wrong and slow.
   */
  async getUsedSpace(): Promise<number> {
    try {
      return await DownloadDatabase.getStorageUsed();
    } catch {
      return 0;
    }
  }

  /**
   * Evict oldest completed downloads to free up space.
   * Returns bytes freed.
   */
  async evictOldest(bytesNeeded: number): Promise<number> {
    const completed = await DownloadDatabase.getByStatus("completed");
    // Sort oldest first
    completed.sort((a, b) => a.updatedAt - b.updatedAt);

    let freed = 0;
    for (const task of completed) {
      if (freed >= bytesNeeded) break;

      // Delete the file at the stored fileUri
      if (task.fileUri) {
        deleteFile(task.fileUri);
      }

      // Also try the standard path (Bug B fix)
      const standardPath = `${DOWNLOAD_DIR}${sanitizeForNative(buildFileName(task.fileName, task.extension))}`;
      if (standardPath !== task.fileUri) {
        deleteFile(standardPath);
      }

      freed += task.totalBytes || 0;

      // Remove from database
      await DownloadDatabase.delete(task.id);
    }

    return freed;
  }

  /**
   * Delete a specific download file.
   */
  async deleteFile(filePath: string): Promise<void> {
    deleteFile(filePath);
  }

  /**
   * Get the download directory path matching native module.
   */
  getDownloadDir(): string {
    return DOWNLOAD_DIR;
  }

  /**
   * Ensure download directory exists.
   */
  ensureDir(): void {
    ensureDirectory(DOWNLOAD_DIR);
  }
}
