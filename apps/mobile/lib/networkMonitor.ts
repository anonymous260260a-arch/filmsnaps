/**
 * NetworkMonitor — triggers background speed tests on network changes.
 *
 * Listens to NetInfo for network type changes (WiFi ↔ cellular, different access points).
 * Runs speed test in background, updates cache non-blockingly.
 * Never blocks app startup or playback.
 */

import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { runSpeedTest } from "./networkSpeedTest";

let lastNetworkType: string | null = null;
let speedTestInProgress = false;
let stopped = false;

/**
 * Initialize network monitor — call once at app startup.
 * Triggers initial speed test and sets up NetInfo listener.
 */
export function initNetworkMonitor(): () => void {
  // Run initial speed test on app start (non-blocking)
  triggerSpeedTest("app-start");

  // Listen for network changes
  const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    const currentType = state.type;

    // Detect network type change
    if (lastNetworkType !== null && lastNetworkType !== currentType) {
      if (__DEV__) {
        console.log(
          `[NetworkMonitor] Network changed: ${lastNetworkType} → ${currentType}`,
        );
      }
      triggerSpeedTest("network-change");
    }

    lastNetworkType = currentType;
  });

  console.log("[NetworkMonitor] Initialized");

  // Return cleanup function
  return () => {
    stopped = true;
    unsubscribe();
  };
}

async function triggerSpeedTest(reason: string): Promise<void> {
  if (stopped || speedTestInProgress) return;

  speedTestInProgress = true;

  try {
    const result = await runSpeedTest();
    if (__DEV__) {
      console.log(
        `[NetworkMonitor] Speed test complete: ${result.speedMbps.toFixed(2)} Mbps (${result.networkType})`,
      );
    }

    // Warn on very slow connection
    if (result.speedMbps < 2) {
      console.warn("[NetworkMonitor] Very slow connection detected (<2Mbps)");
    }
  } catch (error) {
    if (__DEV__) console.warn("[NetworkMonitor] Speed test failed:", error);
  } finally {
    speedTestInProgress = false;
  }
}
