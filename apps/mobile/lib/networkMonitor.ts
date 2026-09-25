/**
 * NetworkMonitor — background speed tests on network changes + launch.
 *
 * Launch speed test is deferred until home content is ready +15s, and only
 * runs when the cached result is missing/stale and the connection is not
 * expensive. Network-change triggers keep the same cache/cost gates.
 * Never blocks app startup or playback.
 *
 * Idempotent init: a second call (Strict Mode / effect re-run) does not log
 * "Initialized" again or stack a second NetInfo listener.
 */

import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { runSpeedTest, getSpeedCacheState } from "./networkSpeedTest";
import { runAfterContentReady } from "./runAfterContentReady";

const LAUNCH_SPEED_TEST_DELAY_MS = 15_000;

let lastNetworkType: string | null = null;
let speedTestInProgress = false;
let stopped = false;
let launchScheduled = false;
let activeUnsubscribe: (() => void) | null = null;
let initCount = 0;

/**
 * Initialize network monitor — call once at app startup.
 * Defers the initial speed test until content-ready +15s (via the shared
 * scheduler) and sets up NetInfo listener for later network changes.
 */
export function initNetworkMonitor(): () => void {
  initCount += 1;

  // Already live — return the existing cleanup (no second listener / log).
  if (activeUnsubscribe) {
    if (__DEV__) {
      console.log(
        `[NetworkMonitor] init #${initCount} re-entered (already active)`,
      );
    }
    return activeUnsubscribe;
  }

  stopped = false;

  if (!launchScheduled) {
    launchScheduled = true;
    runAfterContentReady(LAUNCH_SPEED_TEST_DELAY_MS, () => {
      triggerSpeedTest("content-ready+15s");
    });
  }

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

  activeUnsubscribe = () => {
    stopped = true;
    activeUnsubscribe = null;
    unsubscribe();
  };

  console.log(`[NetworkMonitor] Initialized (init #${initCount})`);

  return activeUnsubscribe;
}

async function triggerSpeedTest(reason: string): Promise<void> {
  if (stopped || speedTestInProgress) return;

  speedTestInProgress = true;

  try {
    const cacheState = await getSpeedCacheState();
    if (cacheState === "fresh") {
      speedTestInProgress = false;
      return;
    }

    const netInfo = await NetInfo.fetch();
    if (
      (netInfo as { isConnectionExpensive?: boolean }).isConnectionExpensive ===
      true
    ) {
      speedTestInProgress = false;
      return;
    }

    console.log(`[speedtest] running (reason: ${cacheState})`);

    const result = await runSpeedTest();
    if (__DEV__) {
      console.log(
        `[NetworkMonitor] Speed test complete: ${result.speedMbps.toFixed(2)} Mbps (${result.networkType}) via ${reason}`,
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
