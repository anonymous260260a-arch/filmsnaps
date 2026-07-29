/**
 * One-time migration from old download system to the current system.
 *
 * Uses fsCompat for SDK 55 compatibility (Bugs A, D).
 */

import { getInfoAsync, deleteFile, getNativeDownloadDir } from "./fsCompat";
import { DownloadDatabase } from "./database";
import type { DownloadTask } from "./types";
import { logger } from "./logger";

const OLD_DOWNLOAD_DIR = getNativeDownloadDir();

/**
 * Run once on first launch with the new system.
 * Migrates old download records:
 * - Completed downloads: verify file still exists, update path if needed
 * - In-progress downloads: mark as paused (user must re-download or resume)
 * - Old engine paths: check both old and new path formats
 */
export async function migrateDownloads(): Promise<{
  migrated: number;
  cleaned: number;
}> {
  let migrated = 0;
  let cleaned = 0;

  try {
    const allTasks = await DownloadDatabase.getAll();

    for (const task of allTasks) {
      // Skip already-cancelled
      if (task.status === "cancelled") continue;

      // For completed downloads: verify file exists
      if (task.status === "completed" && task.fileUri) {
        const info = await getInfoAsync(task.fileUri);
        if (!info.exists) {
          // File was deleted — mark as failed
          await DownloadDatabase.update({
            id: task.id,
            status: "failed",
            error: "File no longer exists on device",
            updatedAt: Date.now(),
          });
          cleaned++;
        } else {
          migrated++;
        }
        continue;
      }

      // For in-progress downloads: mark as paused
      if (["downloading", "pending", "retrying"].includes(task.status)) {
        await DownloadDatabase.update({
          id: task.id,
          status: "paused",
          resumeData: null, // Old resume data is incompatible
          updatedAt: Date.now(),
        });
        migrated++;
      }
    }

    // Clean up old .partial and .resume files from legacy system
    try {
      const { Directory } = require("expo-file-system");
      const dir = new Directory(OLD_DOWNLOAD_DIR);
      if (dir.exists) {
        for (const file of dir.ls()) {
          if (file.extension === ".partial" || file.extension === ".resume") {
            deleteFile(file.uri);
            cleaned++;
          }
        }
      }
    } catch {}

    // Mark migration as done
    const AsyncStorage =
      require("@react-native-async-storage/async-storage").default;
    await AsyncStorage.setItem("@filmsnaps/migration-v2-done", "true");
  } catch (err) {
    logger.error("Migration Failed:", err);
  }

  return { migrated, cleaned };
}

/**
 * Check if migration has already been run.
 */
export async function isMigrationDone(): Promise<boolean> {
  try {
    const AsyncStorage =
      require("@react-native-async-storage/async-storage").default;
    const done = await AsyncStorage.getItem("@filmsnaps/migration-v2-done");
    return done === "true";
  } catch {
    return false;
  }
}
