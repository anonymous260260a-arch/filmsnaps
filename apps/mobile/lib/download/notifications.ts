/**
 * Download Notifications — Handle download progress/completion notifications.
 *
 * Uses expo-notifications for local notifications.
 * NOTE: Do NOT import this module statically — use getDownloadNotifications()
 * from index.ts to avoid native module crash at bundle evaluation time.
 */

// @ts-ignore - expo-notifications types may not be available
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// ── Configuration ──

// @ts-ignore - API differences across versions
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

// ── Notification IDs ──

const NOTIFICATION_PREFIX = "download_";
const PROGRESS_INTERVAL = 10000; // Update progress notification every 10 seconds

// ── State ──

const lastProgressUpdate = new Map<string, number>();

// ── Public API ──

export const DownloadNotifications = {
  /**
   * Request notification permissions
   */
  async requestPermissions(): Promise<boolean> {
    // @ts-ignore - PermissionResponse API differs across SDK versions
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      // @ts-ignore - PermissionResponse API differs across SDK versions
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    return finalStatus === "granted";
  },

  /**
   * Show download started notification
   */
  async showStarted(title: string): Promise<void> {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Download Started",
        body: `Downloading ${title}`,
        data: { type: "download-started" },
      },
      trigger: null,
    });
  },

  /**
   * Update progress notification (throttled)
   */
  async updateProgress(
    taskId: string,
    title: string,
    progress: number,
    receivedBytes: number,
    totalBytes: number,
  ): Promise<void> {
    const now = Date.now();
    const lastUpdate = lastProgressUpdate.get(taskId) || 0;

    if (now - lastUpdate < PROGRESS_INTERVAL) return;
    lastProgressUpdate.set(taskId, now);

    const percentage = Math.round(progress * 100);
    const receivedMB = (receivedBytes / (1024 * 1024)).toFixed(1);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `Downloading: ${title}`,
        body: `${percentage}% (${receivedMB} MB / ${totalMB} MB)`,
        data: { type: "download-progress", taskId },
      },
      trigger: null,
    });
  },

  /**
   * Show download completed notification
   */
  async showCompleted(title: string, filePath: string): Promise<void> {
    lastProgressUpdate.delete(filePath);

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Download Complete",
        body: `${title} is ready to watch`,
        data: { type: "download-completed", filePath },
      },
      trigger: null,
    });
  },

  /**
   * Show download failed notification
   */
  async showFailed(title: string, error: string): Promise<void> {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Download Failed",
        body: `${title}: ${error}`,
        data: { type: "download-failed" },
      },
      trigger: null,
    });
  },

  /**
   * Cancel all download notifications
   */
  async cancelAll(): Promise<void> {
    await Notifications.cancelAllScheduledNotificationsAsync();
    lastProgressUpdate.clear();
  },

  /**
   * Clear progress tracking for a task
   */
  clearProgress(taskId: string): void {
    lastProgressUpdate.delete(taskId);
  },
};
