/**
 * Storage Manager — Space management for downloads.
 *
 * Uses fsCompat for SDK 55 compatibility (Bugs A, D) and fileNameUtils
 * for safe path construction (Bug B).
 */

import { DownloadDatabase } from "./database";
import {
  getInfoAsync,
  deleteFile,
  ensureDirectory,
  getNativeDownloadDir,
} from "./fsCompat";
import { buildFileName, sanitizeForNative } from "./fileNameUtils";

/** The platform-aware download directory (matches native module paths). */
const DOWNLOAD_DIR = getNativeDownloadDir();
const MIN_FREE_SPACE_BYTES = 500 * 1024 * 1024; // 500 MB minimum free

export class StorageManager {
  /**
   * Check if there's enough space for a download of the given size.
   * If estimatedSize is 0 (unknown), checks for minimum free space.
   */
  async canFit(
    estimatedBytes: number,
  ): Promise<{ ok: boolean; freeBytes: number }> {
    const freeBytes = await this.getFreeSpace();
    const needed = estimatedBytes > 0 ? estimatedBytes : MIN_FREE_SPACE_BYTES;
    return {
      ok: freeBytes - needed > MIN_FREE_SPACE_BYTES,
      freeBytes,
    };
  }

  /**
   * Get total storage used by Filmsnaps downloads.
   */
  async getUsedSpace(): Promise<number> {
    try {
      const { Directory } = require("expo-file-system");
      const dir = new Directory(DOWNLOAD_DIR);
      if (!dir.exists) return 0;
      let total = 0;
      for (const file of dir.ls()) {
        try {
          const info = await getInfoAsync(file.uri);
          if (info.exists && info.size > 0) {
            total += info.size;
          }
        } catch {}
      }
      return total;
    } catch {
      return 0;
    }
  }

  /**
   * Get free space on device.
   * Note: expo-file-system doesn't expose this directly.
   * Falls back to conservative estimate.
   */
  async getFreeSpace(): Promise<number> {
    try {
      // Try the native download dir's parent as a rough check
      const info = await getInfoAsync(DOWNLOAD_DIR);
      if (info.exists) {
        // For production, add a small native module calling
        // StatFs (Android) or volumeAvailableCapacity (iOS)
        return 2 * 1024 * 1024 * 1024; // 2 GB conservative estimate
      }
    } catch {}
    return 0;
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
