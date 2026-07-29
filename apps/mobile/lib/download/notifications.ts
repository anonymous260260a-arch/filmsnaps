// apps/mobile/lib/download/notifications.ts

import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

const DENIED_KEY = "@filmsnaps/notif-denied";
const ASKED_KEY = "@filmsnaps/notif-asked";

// Safe module-level handler registration
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
} catch {}

export const DownloadNotifications = {
  async requestPermissions(): Promise<boolean> {
    try {
      const denied = await AsyncStorage.getItem(DENIED_KEY);
      if (denied === "true") return false;

      const { status, canAskAgain } = await Notifications.getPermissionsAsync();
      if (status === "granted") return true;

      if (Platform.OS === "android" && canAskAgain === false) {
        await AsyncStorage.setItem(DENIED_KEY, "true");
        return false;
      }

      if (Platform.OS === "ios") {
        const asked = await AsyncStorage.getItem(ASKED_KEY);
        if (asked === "true" && status === "denied") {
          await AsyncStorage.setItem(DENIED_KEY, "true");
          return false;
        }
      }

      const { status: newStatus } =
        await Notifications.requestPermissionsAsync();
      await AsyncStorage.setItem(ASKED_KEY, "true");

      if (newStatus === "granted") return true;
      await AsyncStorage.setItem(DENIED_KEY, "true");
      return false;
    } catch {
      return false;
    }
  },

  async showCompleted(taskId: string, title: string): Promise<void> {
    try {
      // Dismiss any progress notification for this task
      const presented = await Notifications.getPresentedNotificationsAsync();
      for (const notif of presented) {
        if (notif.request.content.data?.taskId === taskId) {
          await Notifications.dismissNotificationAsync(
            notif.request.identifier,
          );
        }
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Download Complete",
          body: title,
          data: { taskId, type: "complete" },
        },
        trigger: null,
      });
    } catch {}
  },

  async showFailed(
    taskId: string,
    title: string,
    error: string,
  ): Promise<void> {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Download Failed",
          body: `${title}: ${error}`,
          data: { taskId, type: "failed" },
        },
        trigger: null,
      });
    } catch {}
  },

  async resetPermissionState(): Promise<void> {
    await AsyncStorage.multiRemove([DENIED_KEY, ASKED_KEY]);
  },
};
