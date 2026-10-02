/**
 * Telemetry queue — batched, capped, gated, privacy-first, loss-resistant.
 *
 * Gates: nothing queues/sends unless legalAccepted AND analyticsEnabled.
 * When the gate closes (user toggle off), the queue is dropped, the anon ID
 * is deleted, and the flush timer stops.
 *
 * Durability: the queue is mirrored to AsyncStorage on every enqueue and
 * cleared only after the server acknowledges a batch. Kill/background
 * flushes drain the WHOLE queue (not just one 20-event batch) so a
 * 3-hour session's telemetry survives process death; restoring the queue
 * after restart guards the background-flush race.
 *
 * Batching: ≤20 events or 30s, drain-all on background, one retry then
 * keep-and-resend later (never silently discard), hard cap 400.
 *
 * Transport: POST `${getApiBaseUrl()}/api/telemetry` with a static header
 * token (deterrent only — not auth). No IP is read or sent by this module.
 */

import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBaseUrl } from "../api";
import {
  scrub,
  type TelemetryEnvelope,
  type TelemetryEventName,
} from "./types";
import { getAnonId, initAnonId } from "./anonId";

const MAX_QUEUE = 400;
const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 30_000;
const QUEUE_KEY = "telemetry:queue:v1";

let queue: TelemetryEnvelope[] = [];
let legalAccepted = false;
let analyticsEnabled = true;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let appStateSub: { remove: () => void } | null = null;

// P3 — per foreground-session counters for session_end (reset on background).
let sessionStartedAt = Date.now();
let lastScreenSeen = "";
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
      void flushAll();
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

function persistQueue(): void {
  if (queue.length === 0) {
    AsyncStorage.removeItem(QUEUE_KEY).catch(() => {});
  } else {
    AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue)).catch(() => {});
  }
}

async function restoreQueue(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const restored = parsed
      .map((e) => scrub(e as TelemetryEnvelope))
      .filter((e): e is TelemetryEnvelope => e !== null);
    // Guard against double-restore (background flush fired, send failed,
    // app was killed, restart raced a live process): never shrink the
    // in-memory queue, and cap to MAX_QUEUE.
    if (restored.length > queue.length) {
      queue = restored
        .slice(Math.max(0, restored.length - MAX_QUEUE))
        .concat(queue.slice(0, Math.max(0, MAX_QUEUE - restored.length)));
    }
  } catch {
    // Corrupt snapshot — drop it, live queue continues.
    AsyncStorage.removeItem(QUEUE_KEY).catch(() => {});
  }
}

/** Called when the analytics gate opens: restore pending events + anon ID. */
export function hydrateTelemetry(): void {
  void restoreQueue().then(() => {
    if (gateOpen() && queue.length > 0) scheduleFlush();
  });
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
  persistQueue();
}

/**
 * Sync the legal + analytics gates. Call on settings load and whenever
 * legalAccepted or analyticsEnabled changes. Opening the gate (re)creates
 * the anon ID; closing either gate drops the queue, deletes the anon ID,
 * and stops sends immediately.
 */
export function setTelemetryGate(opts: {
  legalAccepted: boolean;
  analyticsEnabled: boolean;
}): void {
  const wasOpen = gateOpen();
  legalAccepted = opts.legalAccepted;
  analyticsEnabled = opts.analyticsEnabled;
  const open = gateOpen();

  // Anon ID lifecycle — gate-scoped by privacy contract.
  void initAnonId(open);

  if (open && !wasOpen) {
    ensureListeners();
    hydrateTelemetry();
    // Flush any cold-start app_launch that was buffered while the gate was
    // still closed (legal not yet accepted / settings not yet hydrated).
    if (pendingAppLaunch) {
      const held = pendingAppLaunch;
      pendingAppLaunch = null;
      const env = scrub(held);
      if (env) {
        // Stamp the anon ID if it loaded in time (it is created in the same
        // gate-open tick; if the storage read is still pending the event
        // sends without it, which the server accepts).
        const anonId = getAnonId();
        queue.push({ ...env, ...(anonId ? { anonId } : {}) });
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

  // Envelope-level anonymous install ID (not a dim; server strips unknown
  // fields and stores it in its own column). Null before the async load
  // completes for this session — the event still sends.
  const anonId = getAnonId();
  const full: TelemetryEnvelope = { ...env, ...(anonId ? { anonId } : {}) };

  // P3 — count for session_end (provider_switch idents itself by name).
  sessionEventCount += 1;
  // P4 — lastScreen = last *place* the user was on. screen_view is the
  // primary signal; download_event keeps the downloader screen visible
  // (unmapped routes like /download/[...id] emit no screen_view).
  if (name === "screen_view") lastScreenSeen = String(dims.screen ?? "");
  else if (name === "download_event") lastScreenSeen = "download";
  if (name === "provider_switch") sessionProviderSwitches += 1;

  queue.push(full);
  if (queue.length > MAX_QUEUE) {
    queue.splice(0, queue.length - MAX_QUEUE);
  }
  persistQueue();
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
  lastScreen: string;
} {
  return {
    durationMs: Date.now() - sessionStartedAt,
    eventCount: sessionEventCount,
    providerSwitches: sessionProviderSwitches,
    lastScreen: lastScreenSeen,
  };
}

/** P3 — a foreground session ended (app backgrounded): reset counters. */
export function startNewSession(): void {
  sessionStartedAt = Date.now();
  sessionEventCount = 0;
  sessionProviderSwitches = 0;
}

/** Send up to batchSize events; true = server acknowledged the batch. */
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
    // 204 = accepted (also the kill-switch / empty-after-sanitize response —
    // both mean the server will never accept these; drop them).
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Force-send events (background / batch threshold / manual).
 * Drains up to `max` events; each ACKED chunk is removed from the queue and
 * the persisted snapshot. Failed chunks STAY queued (one immediate retry,
 * then the 30s timer keeps trying) — nothing is silently discarded.
 */
async function sendFromQueue(max: number): Promise<void> {
  if (flushing || !gateOpen()) return;
  flushing = true;
  try {
    let guard = 0;
    while (queue.length > 0 && guard++ < max) {
      const batch = queue.slice(0, BATCH_SIZE);
      const ok = await postBatch(batch);
      if (ok) {
        queue.splice(0, batch.length);
        persistQueue();
        continue;
      }
      // One immediate retry; if that fails too, keep the events and let the
      // 30s timer / next background flush try again (never drop data).
      const retried = await postBatch(batch);
      if (retried) {
        queue.splice(0, batch.length);
        persistQueue();
      }
      break;
    }
  } finally {
    flushing = false;
    if (queue.length > 0) scheduleFlush();
  }
}

/** Timer/batch flush: bounded so the JS thread is never blocked long. */
export async function flushNow(): Promise<void> {
  await sendFromQueue(25);
}

/**
 * Background flush: drain the ENTIRE queue so nothing survives process
 * death unsent. Android gives ~1-2s after backgrounding — usually enough;
 * anything the OS cuts off is restored from AsyncStorage on next launch.
 */
export async function flushAll(): Promise<void> {
  await sendFromQueue(Infinity);
}

/** Test/debug: clear everything without sending. */
export function resetTelemetryForTests(): void {
  dropQueue("reset");
  legalAccepted = false;
  analyticsEnabled = true;
  clearListeners();
}
