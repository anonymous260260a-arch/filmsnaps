/**
 * Network Speed Test — measures network throughput in background.
 *
 * Runs non-blocking speed test to Cloudflare's CDN endpoint.
 * Result cached in AsyncStorage with 24h TTL.
 * Speed-to-quality mapping used by streamSelector to set quality ceiling.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";

const SPEED_TEST_URL = "https://speed.cloudflare.com/__down?bytes=5000000"; // 5MB test
const CACHE_KEY = "@filmsnaps/network-speed";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface SpeedTestResult {
  speedMbps: number;
  timestamp: number;
  networkType: string;
  samples: number[];
}

interface CachedSpeed {
  wifi?: SpeedTestResult;
  cellular?: SpeedTestResult;
}

/**
 * Maps measured speed (Mbps) to a max quality ceiling.
 * Rationale: 4K needs 20+ Mbps, 1080p needs 8-10 Mbps, 720p needs 3-4 Mbps.
 */
export function getMaxQualityForSpeed(speedMbps: number): string {
  if (speedMbps < 2) return "480p";
  if (speedMbps < 5) return "720p";
  if (speedMbps < 15) return "1080p";
  if (speedMbps < 25) return "1080p"; // high bitrate 1080p
  return "4k";
}

/**
 * Get cached speed test result (synchronous read, instant).
 * Returns null if no cache or cache expired.
 */
export async function getCachedSpeed(): Promise<SpeedTestResult | null> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const data: CachedSpeed = JSON.parse(cached);
    const netInfo = await NetInfo.fetch();
    const networkType = netInfo.type;

    const result = networkType === "cellular" ? data.cellular : data.wifi;
    if (!result) return null;

    const age = Date.now() - result.timestamp;
    if (age > CACHE_TTL_MS) {
      // Cache expired — delete stale entry
      await AsyncStorage.removeItem(CACHE_KEY);
      return null;
    }

    return result;
  } catch (error) {
    if (__DEV__) console.warn("[SpeedTest] Failed to read cache:", error);
    return null;
  }
}

/**
 * Run speed test (async, non-blocking).
 * Fetches 5MB file 3×, takes median result.
 * Updates cache with result.
 */
export async function runSpeedTest(): Promise<SpeedTestResult> {
  const netInfo = await NetInfo.fetch();
  const networkType = netInfo.type;
  const samples: number[] = [];
  const numSamples = 3;

  for (let i = 0; i < numSamples; i++) {
    try {
      const startTime = Date.now();
      // Polyfill for AbortSignal.timeout (not available on old Android Hermes)
      let timeoutSignal: AbortSignal | undefined;
      try {
        timeoutSignal = AbortSignal.timeout(10000);
      } catch {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 10000);
        timeoutSignal = controller.signal;
      }

      const response = await fetch(SPEED_TEST_URL, {
        cache: "no-store",
        signal: timeoutSignal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const blob = await response.blob();
      const endTime = Date.now();

      const durationSeconds = (endTime - startTime) / 1000;
      const sizeBits = blob.size * 8;
      const speedMbps = sizeBits / durationSeconds / 1_000_000;

      samples.push(speedMbps);

      // Brief delay between samples
      if (i < numSamples - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      if (__DEV__) console.warn(`[SpeedTest] Sample ${i + 1} failed:`, error);
    }
  }

  if (samples.length === 0) {
    throw new Error("All speed test samples failed");
  }

  // Use median to avoid outliers
  samples.sort((a, b) => a - b);
  const medianSpeed = samples[Math.floor(samples.length / 2)];

  const result: SpeedTestResult = {
    speedMbps: medianSpeed,
    timestamp: Date.now(),
    networkType,
    samples,
  };

  // Update cache
  await updateCache(result);
  return result;
}

async function updateCache(result: SpeedTestResult): Promise<void> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    const data: CachedSpeed = cached ? JSON.parse(cached) : {};

    if (result.networkType === "cellular") {
      data.cellular = result;
    } else {
      data.wifi = result;
    }

    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (error) {
    if (__DEV__) console.warn("[SpeedTest] Failed to update cache:", error);
  }
}

/**
 * Clear cached speed test results (for debugging or user-reset).
 */
export async function clearSpeedCache(): Promise<void> {
  await AsyncStorage.removeItem(CACHE_KEY);
}
