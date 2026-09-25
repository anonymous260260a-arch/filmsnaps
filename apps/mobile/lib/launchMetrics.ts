/**
 * launchMetrics — cold-start marks logged as ONE summary line per launch.
 *
 * Format:
 *   [launch] splash=Xms firstFrame=Yms contentReady=Zms cache=B reason=R
 *
 * Console-only (no SDKs). All times are ms from module-scope t0 in _layout.
 *
 * FIX B: splash is marked synchronously when the tree is first allowed to
 * render (before child effects run). logLaunchSummary prefers the latest
 * pending call until splash/firstFrame/contentReady are all present, so a
 * child contentReady effect can never log splash=-1 first.
 */

export type ColdStartReason = "no-cache" | "stale" | "warm";

import { trackAppLaunch } from "./telemetry";
import * as Updates from "expo-updates";

interface LaunchMarks {
  cacheRestoredMs?: number;
  fontsDoneMs?: number;
  settingsDoneMs?: number;
  splashHiddenMs?: number;
  homeFirstFrameMs?: number;
  homeContentReadyMs?: number;
  cacheBytes?: number;
  coldStartReason?: ColdStartReason;
  otaApplied?: boolean;
}

const t0 =
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

export function launchNow(): number {
  return (
    (typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now()) - t0
  );
}

const marks: LaunchMarks = {};
let summaryLogged = false;

export function markLaunch<K extends keyof LaunchMarks>(
  key: K,
  value: LaunchMarks[K],
): void {
  if (marks[key] !== undefined) return;
  marks[key] = value;
  console.log(`[launch] mark ${key}=${value}`);
}

export function getLaunchMarks(): Readonly<LaunchMarks> {
  return marks;
}

function hasCoreMarks(): boolean {
  return (
    marks.splashHiddenMs !== undefined &&
    marks.homeFirstFrameMs !== undefined &&
    marks.homeContentReadyMs !== undefined
  );
}

/** Emit the one-line summary (idempotent once core marks are present). */
export function logLaunchSummary(): void {
  if (summaryLogged) return;
  // Child effects can fire before parent splash mark — defer until core set.
  if (!hasCoreMarks()) {
    // Cache bytes/reason are nice-to-have; wait a tick for splash if missing.
    if (marks.splashHiddenMs === undefined) return;
  }
  if (
    marks.homeFirstFrameMs === undefined ||
    marks.homeContentReadyMs === undefined
  ) {
    return;
  }

  summaryLogged = true;

  const splash = marks.splashHiddenMs ?? -1;
  const firstFrame = marks.homeFirstFrameMs ?? -1;
  const contentReady = marks.homeContentReadyMs ?? -1;
  const cache = marks.cacheBytes ?? 0;
  const reason = marks.coldStartReason ?? "no-cache";

  console.log(
    `[launch] splash=${splash}ms firstFrame=${firstFrame}ms contentReady=${contentReady}ms cache=${cache} reason=${reason}`,
  );

  // Phase 4 T2 + E7 — app_launch (bucketed; gated by telemetry queue).
  // otaApplied: true when the running JS bundle is an OTA update, not the
  // embedded build (read once, from expo-updates' static isEmbeddedLaunch).
  let otaApplied: boolean | undefined;
  try {
    otaApplied = Updates.isEmbeddedLaunch === false;
  } catch {
    otaApplied = undefined;
  }
  trackAppLaunch({
    splashMs: splash,
    contentReadyMs: contentReady,
    reason,
    ...(otaApplied === undefined ? {} : { otaApplied }),
  });
}
