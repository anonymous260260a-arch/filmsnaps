/**
 * Long Task Monitor — Detects JS thread starvation in production.
 *
 * Uses the PerformanceObserver API (stable in RN 0.83 / Hermes) to
 * monitor for "long tasks" (>50ms) on the JS thread. When a long task
 * is detected, the callback is invoked with the duration and task name.
 *
 * This is how you get production telemetry on the exact screens and
 * interactions that freeze your UI.
 *
 * Usage:
 *   import { initLongTaskMonitor } from '@/lib/performance/long-task-monitor';
 *
 *   useEffect(() => {
 *     if (__DEV__) return;
 *     return initLongTaskMonitor((duration, name) => {
 *       analytics.track('js_long_task', { duration, name, route: currentRoute });
 *     });
 *   }, []);
 */

import { Platform } from "react-native";

export type LongTaskCallback = (duration: number, name: string) => void;

/**
 * Start monitoring for long tasks on the JS thread.
 * Returns an unsubscribe function to stop monitoring.
 *
 * @param onLongTask - Called with (durationMs, taskName) for every task >50ms
 */
export function initLongTaskMonitor(onLongTask: LongTaskCallback): () => void {
  // PerformanceObserver may not be available in all environments
  if (typeof PerformanceObserver === "undefined") {
    if (__DEV__) {
      console.log("[LongTaskMonitor] PerformanceObserver not available");
    }
    return () => {};
  }

  let observer: PerformanceObserver | null = null;

  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) {
          onLongTask(entry.duration, entry.name);
        }
      }
    });

    observer.observe({ type: "longtask", buffered: true });
  } catch (error) {
    // 'longtask' type may not be supported on all platforms
    if (__DEV__) {
      console.warn("[LongTaskMonitor] Failed to observe longtask:", error);
    }
  }

  return () => {
    observer?.disconnect();
    observer = null;
  };
}
