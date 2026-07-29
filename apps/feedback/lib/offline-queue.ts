/**
 * Offline submission queue.
 *
 * When the user submits a form while offline, the submission is queued
 * in localStorage and auto-submitted when connectivity returns.
 */

import { getIdentityHeaders } from "./fingerprint";

interface QueuedSubmission {
  id: string;
  endpoint: string;
  body: any;
  createdAt: string;
  retryCount: number;
  lastError?: string;
}

const QUEUE_KEY = "@filmsnaps/feedback/offline-queue";
const MAX_RETRIES = 5;

function readQueue(): QueuedSubmission[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedSubmission[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.warn("[OfflineQueue] Failed to write queue:", err);
  }
}

/**
 * Add a submission to the offline queue.
 */
export function enqueueSubmission(
  endpoint: string,
  body: any,
): QueuedSubmission {
  const queue = readQueue();
  const submission: QueuedSubmission = {
    id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    endpoint,
    body,
    createdAt: new Date().toISOString(),
    retryCount: 0,
  };
  queue.push(submission);
  writeQueue(queue);
  return submission;
}

/**
 * Remove a submission from the queue (on success).
 */
export function dequeueSubmission(id: string): void {
  const queue = readQueue().filter((s) => s.id !== id);
  writeQueue(queue);
}

/**
 * Process the offline queue — submit all pending items.
 * Returns the number of items successfully synced.
 */
export async function processQueue(): Promise<number> {
  const queue = readQueue();
  const pending = queue.filter((s) => s.retryCount < MAX_RETRIES);
  if (pending.length === 0) return 0;

  const headers = await getIdentityHeaders();
  let synced = 0;

  for (const item of pending) {
    try {
      const res = await fetch(item.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(item.body),
      });

      if (res.ok) {
        dequeueSubmission(item.id);
        synced++;
      } else {
        // Update retry count
        item.retryCount++;
        item.lastError = `HTTP ${res.status}`;
        writeQueue(readQueue()); // Refresh from storage and save
      }
    } catch (err: any) {
      item.retryCount++;
      item.lastError = err?.message || "Network error";
      writeQueue(readQueue());
      // If this failed due to being offline, stop processing
      if (err instanceof TypeError && err.message?.includes("fetch")) {
        break;
      }
    }
  }

  return synced;
}

/**
 * Get the number of pending submissions in the queue.
 */
export function getPendingCount(): number {
  return readQueue().length;
}

/**
 * Set up automatic queue processing when the browser comes online.
 * Call once on app load.
 */
export function setupAutoRetry(): () => void {
  if (typeof window === "undefined") return () => {};

  const handler = () => {
    const count = readQueue().length;
    if (count > 0) {
      processQueue().then((synced) => {
        if (synced > 0) {
          console.log(`[OfflineQueue] Synced ${synced} pending submission(s)`);
        }
      });
    }
  };

  window.addEventListener("online", handler);

  // Also try to process on load (in case we were already online)
  if (navigator.onLine) {
    handler();
  }

  return () => window.removeEventListener("online", handler);
}
