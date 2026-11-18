/**
 * POST /api/feedback — public submission endpoint for the native in-app
 * feedback screen and the in-app rating prompt (replaces the retired
 * apps/feedback portal).
 *
 * Pipeline (cheapest gate first, all state in D1 so it is global):
 *   thread gate -> honeypot -> validation -> one-time challenge -> dedupe
 *   -> insert
 *
 * The thread gate enforces a per-install mute, 3 accepted messages per hour, a
 * 10 minute cooldown and a global floor (lib/feedbackGuard.ts). The challenge
 * is a single-use nonce from POST /api/feedback/challenge and every accepted
 * submission spends one, ratings included. Dedupe only matches the same
 * sender's own text (or the same bare rating), so two users reporting the same
 * crash are fine.
 *
 * Security posture:
 *   - Server-side validation only (type whitelist, length caps, honeypot).
 *   - Profanity/abuse wording sets `flagged` — never blocks, never tells the
 *     caller. Every valid-looking submission gets the same generic {ok}.
 *   - No IP, no fingerprint, no PII. `thread` is a random on-device UUID used
 *     to read replies and to scope limits.
 *   - The in-memory 3/hour/IP buckets in worker.mjs and middleware.ts remain as
 *     a cheap first pass; they are per isolate and only approximate.
 *
 * Reads are NOT here: the admin inbox lives in /api/feedback/list (Basic-auth
 * scoped) and the sender's own messages in /api/feedback/mine.
 */
import { NextRequest, NextResponse } from "next/server";
import { handleOptions } from "@/lib/cors";
import { desktopSkip } from "../desktop-skip";
import { containsAbuse } from "@/lib/abuse-words";
import {
  addStrike,
  consumeChallenge,
  contentHash,
  gateThread,
  isDuplicateText,
} from "@/lib/feedbackGuard";

const TYPES = new Set(["bug", "idea", "question", "rating"]);
const MESSAGE_MIN = 2;
const MESSAGE_MAX = 2000;
const THREAD_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HONEYPOT_MAX = 100;

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

function bad(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, error: message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/** 429 with the reason the client maps to a friendly message. */
function limited(reason: string, retryAfter: number) {
  return NextResponse.json(
    { ok: false, error: reason },
    {
      status: 429,
      headers: {
        "cache-control": "no-store",
        "retry-after": String(Math.max(1, Math.ceil(retryAfter))),
      },
    },
  );
}

export async function POST(req: NextRequest) {
  const skip = desktopSkip();
  if (skip) return skip;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid request body");
  }

  // Capability token: the per-install thread. Required now that it also scopes
  // the rate limits and duplicate detection.
  const thread = String(body.thread ?? "").trim();
  if (!THREAD_RE.test(thread)) return bad("Invalid request body");

  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  let db: any = null;
  try {
    db = (getCloudflareContext().env as any).TELEMETRY_DB ?? null;
  } catch {
    return bad("Service temporarily unavailable", 503);
  }
  if (!db) return bad("Service temporarily unavailable", 503);

  // 1) Mute / rolling-hour cap / cooldown / global floor, per install.
  const gate = await gateThread(db, thread);
  if (!gate.ok) {
    return limited(gate.reason ?? "rate", gate.retryAfter ?? 900);
  }

  // 2) Honeypot: any value in the hidden field = bot. Silently accept-and-drop.
  const honeypot = String(body.website ?? "");
  if (honeypot.length > 0) {
    if (honeypot.length <= HONEYPOT_MAX) {
      await addStrike(db, thread, 2);
      return NextResponse.json({ ok: true });
    }
    return bad("Invalid request body");
  }

  // 3) Shape of the submission. Rating is optional for a written report,
  // mandatory for a rating.
  const ratingRaw = body.rating;
  let rating: number | null = null;
  if (ratingRaw !== undefined && ratingRaw !== null && ratingRaw !== "") {
    const n = Number(ratingRaw);
    if (!Number.isInteger(n) || n < 1 || n > 5)
      return bad("Rating must be between 1 and 5");
    rating = n;
  }

  let type = String(body.type ?? "").trim();
  if (!type && rating !== null) type = "rating";
  if (!TYPES.has(type)) return bad("Please pick a feedback type");
  if (type === "rating" && rating === null) return bad("Pick a rating");

  const message = String(body.message ?? "").trim();
  const minRequired = type === "rating" ? 0 : MESSAGE_MIN;
  if (message.length < minRequired)
    return bad(`Message must be at least ${MESSAGE_MIN} characters`);
  if (message.length > MESSAGE_MAX)
    return bad(`Message must be at most ${MESSAGE_MAX} characters`);

  // 4) One-time challenge, consumed on use. Ratings are covered too: the app
  // fetches a nonce immediately before sending, so every row costs one
  // handshake and a replayed nonce is refused.
  if (!(await consumeChallenge(db, body.nonce))) {
    await addStrike(db, thread);
    return bad("invalid_challenge");
  }

  // 5) Same text (or the same bare rating) from the same sender inside the
  // dedupe window. This also makes a client retry idempotent: if a device
  // re-sends a draft this server already stored, it is refused, not doubled.
  const dedupeKey = message || (rating !== null ? `rating:${rating}` : "");
  const hash = dedupeKey ? await contentHash(thread, dedupeKey) : null;
  if (hash && (await isDuplicateText(db, thread, hash))) {
    await addStrike(db, thread);
    return limited("duplicate", 900);
  }

  const flagged = containsAbuse(message) ? 1 : 0;
  const clientRaw = (req.headers.get("x-client") ?? "").trim().slice(0, 32);
  const appVersion = (req.headers.get("x-app-version") ?? "")
    .trim()
    .slice(0, 32);
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);

  try {
    await db
      .prepare(
        `INSERT INTO feedback (day, type, message, rating, client, app_version, thread, content_hash, status, flagged, ts)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'new', ?9, ?10)`,
      )
      .bind(
        day,
        type,
        message,
        rating,
        clientRaw || null,
        appVersion || null,
        thread,
        hash,
        flagged,
        now,
      )
      .run();
  } catch (e) {
    console.error("[feedback] insert failed", e);
    return bad("Service temporarily unavailable", 503);
  }

  return NextResponse.json(
    { ok: true },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}
