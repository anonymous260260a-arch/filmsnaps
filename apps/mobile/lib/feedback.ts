/**
 * Native in-app feedback client. Submits to the web app's /api/feedback
 * endpoint (worker D1) and reads the team's replies back through
 * /api/feedback/mine.
 *
 * Identity: a random per-install UUID ("thread") minted on-device and kept in
 * AsyncStorage — not derived from hardware, OS, account or IP. It is the only
 * thing that lets this install see its own replies, and clearing app data
 * severs it. Abuse control (rate limiting, profanity flagging) is entirely
 * server-side; the client never gates on wording.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBaseUrl } from "./api";
import { getClientHeaders } from "./clientHeaders";

export type FeedbackType = "bug" | "idea" | "question";
export type FeedbackKind = FeedbackType | "rating";

export const FEEDBACK_MESSAGE_MIN = 2;
export const FEEDBACK_MESSAGE_MAX = 2000;
const THREAD_KEY = "feedback:thread:v1";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface FeedbackDraft {
  type: FeedbackKind;
  message: string;
  rating?: number | null;
}

export interface FeedbackItem {
  id: number;
  type: string;
  message: string;
  rating: number | null;
  status: string;
  reply: string | null;
  repliedTs: number | null;
  replyVote: "like" | "dislike" | null;
  ts: number;
}

export type FeedbackReply = FeedbackItem;

/** Local pre-flight mirroring the server rules; returns an error or null. */
export function validateFeedback(draft: FeedbackDraft): string | null {
  const message = draft.message.trim();
  // A rating may stand alone; a written report may not be a stub.
  if (draft.type !== "rating" && message.length < FEEDBACK_MESSAGE_MIN)
    return `Message must be at least ${FEEDBACK_MESSAGE_MIN} characters`;
  if (message.length > FEEDBACK_MESSAGE_MAX)
    return `Message must be at most ${FEEDBACK_MESSAGE_MAX} characters`;
  if (draft.rating != null) {
    const r = draft.rating;
    if (!Number.isInteger(r) || r < 1 || r > 5)
      return "Pick a rating from 1 to 5";
  }
  if (draft.type === "rating" && draft.rating == null) return "Pick a rating";
  return null;
}

function randomHex(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

function generateThread(): string {
  return (
    `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-` +
    `${"89ab"[Math.floor(Math.random() * 4)]}${randomHex(3)}-${randomHex(12)}`
  );
}

let cachedThread: string | null = null;

/**
 * The install's feedback thread token. Created on first use; if storage is
 * unavailable the session keeps a memory-only token so submissions still work
 * (replies just won't survive a relaunch).
 */
export async function getFeedbackThread(): Promise<string> {
  if (cachedThread) return cachedThread;
  const fresh = generateThread();
  try {
    let stored = await AsyncStorage.getItem(THREAD_KEY);
    if (!stored || !UUID_RE.test(stored)) {
      stored = fresh;
      await AsyncStorage.setItem(THREAD_KEY, stored);
    }
    cachedThread = stored;
  } catch {
    cachedThread = fresh;
  }
  return cachedThread;
}

export interface SubmitResult {
  ok: boolean;
  error?: string;
  /**
   * Worth retrying later: the server was unreachable, the D1 binding was
   * missing, or the daily write allowance was spent. Validation failures are
   * never retryable.
   */
  retryable?: boolean;
  /** Server hint (Retry-After) for when a retryable send can succeed again. */
  retryAfterMs?: number;
}

/**
 * Step 1 of every submission (ratings included): a single-use nonce, valid for
 * 10 minutes.
 */
async function fetchChallenge(signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/feedback/challenge`, {
      method: "POST",
      headers: getClientHeaders(),
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { nonce?: unknown };
    return typeof data.nonce === "string" ? data.nonce : null;
  } catch {
    return null;
  }
}

/** One deadline for the whole handshake — a hung request must fail as
 * retryable, so the outbox keeps the draft instead of the user waiting. */
const REQUEST_TIMEOUT_MS = 20_000;

const UNREACHABLE =
  "Couldn't reach the server. Check your connection and try again.";

export async function submitFeedback(
  draft: FeedbackDraft,
  signal?: AbortSignal,
): Promise<SubmitResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort);
  }
  const reqSignal = controller.signal;

  try {
    const thread = await getFeedbackThread();
    const payload = {
      type: draft.type,
      message: draft.message.trim(),
      rating: draft.rating ?? undefined,
      thread,
      website: "", // honeypot
    };

    const post = async (nonce: string) => {
      const res = await fetch(`${getApiBaseUrl()}/api/feedback`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...getClientHeaders(),
        },
        body: JSON.stringify({ ...payload, nonce }),
        signal: reqSignal,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      const retryAfter = Number(res.headers.get("retry-after") ?? "");
      return {
        status: res.status,
        ok: res.ok,
        data,
        retryAfterMs:
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : undefined,
      };
    };

    // Every submission, ratings included, spends a single-use challenge. If
    // the challenge cannot be fetched we do not post blindly — a missing nonce
    // would be recorded as abuse — we report a retryable failure so the outbox
    // keeps the draft and sends it later.
    let nonce = await fetchChallenge(reqSignal);
    if (!nonce) return { ok: false, error: UNREACHABLE, retryable: true };

    let result = await post(nonce);
    // A spent or expired nonce is retried once with a fresh challenge.
    if (result.status === 400 && result.data.error === "invalid_challenge") {
      nonce = await fetchChallenge(reqSignal);
      if (!nonce) return { ok: false, error: UNREACHABLE, retryable: true };
      result = await post(nonce);
    }

    const { status, ok, data } = result;
    if (ok && data.ok) return { ok: true };

    const code = String(data.error ?? "");
    if (status === 429) {
      if (code === "duplicate") {
        return {
          ok: false,
          error: "This exact message was already received.",
          retryable: false,
        };
      }
      return {
        ok: false,
        error:
          code === "muted"
            ? "Feedback is paused for this device for a day. Please try again tomorrow."
            : "Too many messages right now. Please try again later.",
        retryable: true,
        retryAfterMs: result.retryAfterMs,
      };
    }
    if (code === "invalid_challenge") {
      return {
        ok: false,
        error: "Couldn't verify the request. Please try again.",
        retryable: true,
      };
    }
    return {
      ok: false,
      error: data.error || "Something went wrong. Please try again.",
      retryable: status >= 500,
    };
  } catch (e) {
    // Our own deadline is not a user cancellation: it is worth retrying.
    if (!timedOut && e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: "cancelled" };
    }
    return { ok: false, error: UNREACHABLE, retryable: true };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Marks a team reply helpful or not. Passing null clears the vote, so tapping
 * the same button twice takes it back.
 */
export async function voteOnReply(
  id: number,
  vote: "like" | "dislike" | null,
): Promise<boolean> {
  try {
    const thread = await getFeedbackThread();
    const res = await fetch(`${getApiBaseUrl()}/api/feedback/vote`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...getClientHeaders(),
      },
      body: JSON.stringify({ thread, id, vote }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface MyFeedbackState {
  rows: FeedbackItem[];
  /** False when the list could not be read (offline, quota, missing DB). */
  ok: boolean;
}

/**
 * Everything this install has sent, newest first, replies included — plus
 * whether the read actually succeeded, so the screen can say "couldn't load"
 * instead of pretending the list is empty.
 */
export async function fetchMyFeedbackState(): Promise<MyFeedbackState> {
  try {
    const thread = await getFeedbackThread();
    const res = await fetch(
      `${getApiBaseUrl()}/api/feedback/mine?thread=${encodeURIComponent(thread)}`,
      { headers: getClientHeaders() },
    );
    if (!res.ok) return { rows: [], ok: false };
    const data = (await res.json().catch(() => ({}))) as {
      rows?: unknown;
    };
    if (!Array.isArray(data.rows)) return { rows: [], ok: false };
    return { rows: data.rows as FeedbackItem[], ok: true };
  } catch {
    return { rows: [], ok: false };
  }
}

export async function fetchMyFeedback(): Promise<FeedbackItem[]> {
  return (await fetchMyFeedbackState()).rows;
}

const SEEN_REPLIES_KEY = "feedback:replies-seen:v1";

/** Timestamp of the newest team reply the user has already been told about. */
export async function getSeenRepliesTs(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_REPLIES_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export async function markRepliesSeen(ts: number): Promise<void> {
  if (!Number.isFinite(ts) || ts <= 0) return;
  try {
    const prev = await getSeenRepliesTs();
    if (ts > prev) await AsyncStorage.setItem(SEEN_REPLIES_KEY, String(ts));
  } catch {
    // Storage unavailable — the toast simply repeats on the next launch.
  }
}

/**
 * Records how the in-app rating prompt ended (rated or refused). Refusals are
 * kept out of the feedback inbox; only the aggregate counts are used.
 */
export async function reportPromptOutcome(
  outcome: "rated" | "declined",
): Promise<void> {
  try {
    const thread = await getFeedbackThread();
    await fetch(`${getApiBaseUrl()}/api/feedback/prompt`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...getClientHeaders(),
      },
      body: JSON.stringify({ outcome, thread }),
    });
  } catch {
    // Best-effort metric; the prompt's local state is authoritative.
  }
}
