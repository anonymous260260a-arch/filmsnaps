/**
 * Telemetry queue — batched, capped, gated, privacy-first.
 *
 * Gates: nothing queues/sends unless legalAccepted AND analyticsEnabled.
 * When the gate closes (user toggle off), the queue is dropped immediately
 * and the flush timer stops.
 *
 * Batching: ≤20 events or 30s, flush on AppState background, one retry
 * then discard that batch, hard cap 200 (drop oldest).
 *
 * Transport: POST `${getApiBaseUrl()}/api/telemetry` with a static header
 * token (deterrent only — not auth). No IP is read or sent by this module.
 */

import { AppState } from "react-native";
import { getApiBaseUrl } from "../api";
import {
  scrub,
  type TelemetryEnvelope,
  type TelemetryEventName,
} from "./types";

const MAX_QUEUE = 200;
const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 30_000;

let queue: TelemetryEnvelope[] = [];
let legalAccepted = false;
let analyticsEnabled = true;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let appStateSub: { remove: () => void } | null = null;

// P3 — per foreground-session counters for session_end (reset on background).
let sessionStartedAt = Date.now();
let sessionEventCount = 0;
let sessionProviderSwitches = 0;

// app_launch fires at cold start, which is BEFORE the settings hydrate and the
// legal/analytics gate opens — so it would be dropped at enqueue time and lost
// forever (summaryLogged is one-shot). Hold it here and flush once the gate
// opens. Privacy-identical: nothing is sent until legalAccepted && analytics.
let pendingAppLaunch: TelemetryEnvelope | null = null;

function gateOpen(): boolean {
  return legalAccepted && analyticsEnabled;
}

function ensureListeners(): void {
  if (appStateSub) return;
  appStateSub = AppState.addEventListener("change", (state) => {
    if (state === "background" || state === "inactive") {
      void flushNow();
    }
  });
}

function clearListeners(): void {
  appStateSub?.remove();
  appStateSub = null;
}

function scheduleFlush(): void {
  if (!gateOpen() || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNow();
    if (queue.length > 0) scheduleFlush();
  }, FLUSH_INTERVAL_MS);
}

function dropQueue(reason: string): void {
  if (queue.length > 0) {
    console.log(`[Telemetry] drop queue (${reason}) n=${queue.length}`);
  }
  queue = [];
  pendingAppLaunch = null;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

/**
 * Sync the legal + analytics gates. Call on settings load and whenever
 * legalAccepted or analyticsEnabled changes. Closing either gate drops
 * the queue and stops sends immediately.
 */
export function setTelemetryGate(opts: {
  legalAccepted: boolean;
  analyticsEnabled: boolean;
}): void {
  const wasOpen = gateOpen();
  legalAccepted = opts.legalAccepted;
  analyticsEnabled = opts.analyticsEnabled;
  const open = gateOpen();

  if (open && !wasOpen) {
    ensureListeners();
    // Flush any cold-start app_launch that was buffered while the gate was
    // still closed (legal not yet accepted / settings not yet hydrated).
    if (pendingAppLaunch) {
      const held = pendingAppLaunch;
      pendingAppLaunch = null;
      const env = scrub(held);
      if (env) {
        queue.push(env);
        sessionEventCount += 1;
      }
    }
    scheduleFlush();
    console.log("[Telemetry] gate open");
  } else if (!open && wasOpen) {
    dropQueue("gate closed");
    clearListeners();
    console.log("[Telemetry] gate closed");
  } else if (!open) {
    dropQueue("gate closed");
  }
}

/** True when events may be queued (diagnostics). */
export function isTelemetryOpen(): boolean {
  return gateOpen();
}

/**
 * Enqueue one event. Builder helpers in track.ts pass only whitelisted
 * dims; scrub() is still the last line of defense before the wire.
 */
export function enqueue(
  name: TelemetryEventName,
  dims: Record<string, string | number | boolean>,
  envelope: Omit<TelemetryEnvelope, "name" | "dims">,
): void {
  if (!gateOpen()) {
    // app_launch is one-shot per cold start and fires before settings hydrate
    // / legal is accepted — hold it (scrubbed, nothing sent) until the gate
    // opens. All other events while the gate is closed are dropped.
    if (name === "app_launch") {
      const held = scrub({ ...envelope, name, dims });
      if (held) pendingAppLaunch = held;
    }
    return;
  }

  const env = scrub({ ...envelope, name, dims });
  if (!env) return;

  // P3 — count for session_end (provider_switch idents itself by name).
  sessionEventCount += 1;
  if (name === "provider_switch") sessionProviderSwitches += 1;

  queue.push(env);
  if (queue.length > MAX_QUEUE) {
    const overflow = queue.length - MAX_QUEUE;
    queue.splice(0, overflow);
  }
  if (queue.length >= BATCH_SIZE) {
    void flushNow();
  } else {
    scheduleFlush();
  }
}

/** P3 — snapshot this foreground session's counters for session_end. */
export function getSessionSnapshot(): {
  durationMs: number;
  eventCount: number;
  providerSwitches: number;
} {
  return {
    durationMs: Date.now() - sessionStartedAt,
    eventCount: sessionEventCount,
    providerSwitches: sessionProviderSwitches,
  };
}

/** P3 — a foreground session ended (app backgrounded): reset counters. */
export function startNewSession(): void {
  sessionStartedAt = Date.now();
  sessionEventCount = 0;
  sessionProviderSwitches = 0;
}

/** Force-send the current batch (background / manual). */
export async function flushNow(): Promise<void> {
  if (flushing || !gateOpen() || queue.length === 0) return;
  flushing = true;
  try {
    const batch = queue.splice(0, BATCH_SIZE);
    const ok = await postBatch(batch);
    if (!ok) {
      // One retry then discard this batch (never unbounded re-queue).
      const retried = await postBatch(batch);
      if (!retried) {
        console.log(`[Telemetry] batch discarded after retry n=${batch.length}`);
      }
    }
  } finally {
    flushing = false;
    if (queue.length > 0) scheduleFlush();
  }
}

async function postBatch(batch: TelemetryEnvelope[]): Promise<boolean> {
  try {
    const token = process.env.EXPO_PUBLIC_TELEMETRY_TOKEN;
    const res = await fetch(`${getApiBaseUrl()}/api/telemetry`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-telemetry-token": token } : {}),
      },
      body: JSON.stringify({ events: batch }),
    });
    // 204 = kill-switch accepted (events intentionally dropped server-side).
    return res.ok;
  } catch {
    return false;
  }
}

/** Test/debug: clear everything without sending. */
export function resetTelemetryForTests(): void {
  dropQueue("reset");
  legalAccepted = false;
  analyticsEnabled = true;
  clearListeners();
}
