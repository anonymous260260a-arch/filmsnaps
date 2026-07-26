/**
 * Background Download Task — LEGACY
 *
 * This file is preserved as a stub. Background downloads are now handled by the
 * Foreground Service started/stopped automatically inside DownloadManager.processQueue().
 * The manager uses `react-native-background-actions` to keep the JS thread alive
 * with a persistent notification while downloads are active.
 *
 * Previously used expo-background-fetch + expo-task-manager, which had these issues:
 * - Headless JS context killed the thread after ~30 seconds (insufficient for multi-GB files)
 * - expo-sqlite and react-native-blob-util native modules unavailable in headless JS
 * - No progress reporting or notifications from headless context
 *
 * The Foreground Service approach in manager.ts solves all these issues:
 * - Service runs as long as active/queued downloads exist
 * - Full access to all native modules
 * - Progress reporting, notifications, pause/resume all work
 * - Persistent notification shows download status to the user
 */

export async function registerBackgroundDownloadTask(): Promise<boolean> {
  // No-op — functionality replaced by DownloadManager's Foreground Service
  return true;
}

export async function unregisterBackgroundDownloadTask(): Promise<void> {
  // No-op — cleanup handled by manager.destroy()
}

export async function getBackgroundFetchStatus(): Promise<string> {
  return "replaced_by_foreground_service";
}
