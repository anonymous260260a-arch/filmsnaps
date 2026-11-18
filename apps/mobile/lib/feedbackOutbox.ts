/**
 * Feedback outbox — a submission is never lost, whatever the network does.
 *
 * Every send is write-ahead: the draft is persisted on the device first, then
 * the request is attempted, and the stored copy is only deleted once the server
 * has accepted it. A crash, a force-quit, a lost connection, a hung request or
 * a spent daily D1 allowance therefore cannot drop a message or a rating — the
 * draft waits on the device and is re-sent on the next launch or foreground.
 *
 * Only retryable failures stay queued (network, timeout, 5xx, rate limits).
 * A validation failure could never succeed, so it is dropped and reported.
 * Re-sends are safe: the server refuses an identical message (or the same bare
 * rating) from the same install inside its dedupe window, so a retry after an
 * accepted-but-unconfirmed send cannot create a second row.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { submitFeedback, type FeedbackDraft } from "./feedback";

const STORAGE_KEY = "feedback:outbox:v1";
const MAX_ITEMS = 25;
const JITTER_MS = 15 * 60 * 1000;

export interface OutboxItem {
  id: string;
  draft: FeedbackDraft;
  queuedTs: number;
  nextAttemptTs: number;
}

export interface SendResult {
  ok: boolean;
  /** The draft is safely on the device and will be sent automatically. */
  queued: boolean;
  error?: string;
  pending: number;
}

/** Next 00:00 UTC (D1's daily reset) plus up to 15 minutes of jitter. */
export function nextDailyReset(now: number = Date.now()): number {
  const d = new Date(now);
  const midnight = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1,
  );
  return midnight + Math.floor(Math.random() * JITTER_MS);
}

async function read(): Promise<OutboxItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (i): i is OutboxItem =>
        !!i &&
        typeof i.id === "string" &&
        typeof i.queuedTs === "number" &&
        typeof i.nextAttemptTs === "number" &&
        !!i.draft &&
        typeof i.draft.message === "string" &&
        typeof i.draft.type === "string",
    );
  } catch {
    return [];
  }
}

async function write(items: OutboxItem[]): Promise<void> {
  try {
    if (items.length === 0) await AsyncStorage.removeItem(STORAGE_KEY);
    else await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage unavailable — the draft stays in memory for this session only.
  }
}

// Read-modify-write runs of the queue are serialized so a launch flush and a
// user send cannot clobber each other's writes.
let storeChain: Promise<unknown> = Promise.resolve();

function withStore<T>(fn: () => Promise<T>): Promise<T> {
  const next = storeChain.then(fn, fn);
  storeChain = next.catch(() => {});
  return next;
}

function clean(draft: FeedbackDraft): FeedbackDraft {
  return {
    ...draft,
    message: draft.message.trim(),
    rating: draft.rating ?? null,
  };
}

/** Same submission: same type, text and rating. */
function sameDraft(a: FeedbackDraft, b: FeedbackDraft): boolean {
  return (
    a.type === b.type &&
    a.message.trim() === b.message.trim() &&
    (a.rating ?? null) === (b.rating ?? null)
  );
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

/**
 * Persists a draft (reusing an identical copy already waiting) and returns it.
 * Written before the network is touched — this is the "never lose it" step.
 */
async function persist(
  draft: FeedbackDraft,
  nextAttemptTs: number,
): Promise<OutboxItem> {
  return withStore(async () => {
    const items = await read();
    const item = clean(draft);
    const existing = items.find((i) => sameDraft(i.draft, item));
    if (existing) return existing;
    const fresh: OutboxItem = {
      id: makeId(),
      draft: item,
      queuedTs: Date.now(),
      nextAttemptTs,
    };
    items.push(fresh);
    await write(items.slice(-MAX_ITEMS));
    return fresh;
  });
}

async function removeItem(id: string): Promise<void> {
  await withStore(async () => {
    const items = await read();
    if (!items.some((i) => i.id === id)) return;
    await write(items.filter((i) => i.id !== id));
  });
}

/**
 * When a retryable send may run again: the server's own Retry-After when it
 * gave one (a 10 minute cooldown should not wait until midnight), otherwise
 * the next D1 daily reset.
 */
function retryAt(now: number, retryAfterMs?: number): number {
  const CAP_MS = 24 * 60 * 60 * 1000;
  if (retryAfterMs && retryAfterMs > 0) {
    return now + Math.min(retryAfterMs, CAP_MS);
  }
  return nextDailyReset(now);
}

async function deferItem(
  id: string,
  now: number,
  retryAfterMs?: number,
): Promise<void> {
  const nextAttemptTs = retryAt(now, retryAfterMs);
  await withStore(async () => {
    const items = await read();
    await write(items.map((i) => (i.id === id ? { ...i, nextAttemptTs } : i)));
  });
}

/** How many drafts are waiting to be sent. */
export async function pendingFeedbackCount(): Promise<number> {
  return (await read()).length;
}

/**
 * The only send path: bank the draft, try to deliver it now, and keep it if
 * delivery cannot happen yet. Returns `queued` when the draft is stored and
 * will be re-sent automatically.
 */
export async function sendFeedbackDraft(
  draft: FeedbackDraft,
): Promise<SendResult> {
  const item = await persist(draft, Date.now());
  const res = await submitFeedback(item.draft);

  if (res.ok) {
    await removeItem(item.id);
    return { ok: true, queued: false, pending: await pendingFeedbackCount() };
  }

  if (res.retryable) {
    await deferItem(item.id, Date.now(), res.retryAfterMs);
    return {
      ok: false,
      queued: true,
      error: res.error,
      pending: await pendingFeedbackCount(),
    };
  }

  // The server refuses this draft permanently (validation, muted, duplicate) —
  // retrying can never succeed, so the copy is dropped and the reason shown.
  await removeItem(item.id);
  return {
    ok: false,
    queued: false,
    error: res.error,
    pending: await pendingFeedbackCount(),
  };
}

/**
 * Sends everything that is due, one at a time. Safe to call on every launch and
 * resume: calls are coalesced, items inside their wait window are skipped, and
 * unretryable failures are dropped.
 */
let inFlight: Promise<{ sent: number; pending: number }> | null = null;

export function flushFeedbackOutbox(
  now: number = Date.now(),
): Promise<{ sent: number; pending: number }> {
  if (!inFlight) {
    inFlight = drain(now).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function drain(now: number): Promise<{ sent: number; pending: number }> {
  const items = await read();
  if (items.length === 0) return { sent: 0, pending: 0 };

  const finished = new Set<string>();
  const deferred = new Map<string, number>();
  let sent = 0;

  for (const item of items) {
    if (item.nextAttemptTs > now) continue;
    const res = await submitFeedback(item.draft);
    if (res.ok) {
      sent += 1;
      finished.add(item.id);
    } else if (res.retryable) {
      deferred.set(item.id, retryAt(Date.now(), res.retryAfterMs));
    } else {
      // A non-retryable failure can never succeed — drop it rather than retry
      // a message the server refuses to accept.
      finished.add(item.id);
    }
  }

  // Re-read: a send started while the queue was draining may have added or
  // removed entries, and those must survive this write.
  const keep = await withStore(async () => {
    const current = await read();
    const out: OutboxItem[] = [];
    for (const item of current) {
      if (finished.has(item.id)) continue;
      const nextAttemptTs = deferred.get(item.id);
      out.push(nextAttemptTs ? { ...item, nextAttemptTs } : item);
    }
    await write(out);
    return out.length;
  });

  return { sent, pending: keep };
}
