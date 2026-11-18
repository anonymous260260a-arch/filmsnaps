/**
 * Abuse guard for the feedback endpoints.
 *
 * All state lives in D1, because a Worker isolate's memory is not shared: the
 * in-memory buckets in middleware.ts / worker.mjs are only a cheap first pass.
 *
 * Privacy: nothing here stores an IP address, user agent or device id. The keys
 * are the random per-install thread token the app already holds, a content hash
 * of the sender's own message (stored with that message, deleted with it), and
 * constant counters.
 *
 * Layers, cheapest first:
 *   thread gate  — mute, 3 accepted messages/hour, 10 min cooldown, global floor
 *   challenge    — single-use nonce, 10 min TTL, deleted when used
 *   dedupe       — same text from the same thread inside 6 hours
 *   strikes      — abuse signals escalate to a 24 hour mute
 */

export const GUARD = {
  perThreadPerHour: 3,
  cooldownMs: 10 * 60_000,
  globalPerHour: 300,
  dedupeWindowMs: 6 * 60 * 60_000,
  challengeTtlMs: 10 * 60_000,
  strikeWindowMs: 24 * 60 * 60_000,
  maxStrikes: 5,
  muteMs: 24 * 60 * 60_000,
} as const;

const HOUR_MS = 3_600_000;
const NONCE_RE = /^[0-9a-f]{48}$/;

export type GateReason = "muted" | "rate" | "cooldown" | "global";

export interface GateResult {
  ok: boolean;
  reason?: GateReason;
  /** Seconds the caller should wait, sent as Retry-After. */
  retryAfter?: number;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Challenge ───────────────────────────────────────────────────────────────

export async function issueChallenge(db: any, now: number = Date.now()) {
  const nonce = randomHex(24);
  const expiresAt = now + GUARD.challengeTtlMs;
  // Opportunistic sweep keeps the table tiny without a cron.
  await db
    .prepare(`DELETE FROM feedback_challenge WHERE expires_at < ?1`)
    .bind(now)
    .run()
    .catch(() => {});
  await db
    .prepare(
      `INSERT INTO feedback_challenge (nonce, expires_at) VALUES (?1, ?2)`,
    )
    .bind(nonce, expiresAt)
    .run();
  return { nonce, expiresAt, ttlSeconds: GUARD.challengeTtlMs / 1000 };
}

/** Single use: the DELETE is the consume, so a replayed nonce finds nothing. */
export async function consumeChallenge(
  db: any,
  nonce: unknown,
  now: number = Date.now(),
): Promise<boolean> {
  const value = String(nonce ?? "").trim();
  if (!NONCE_RE.test(value)) return false;
  const res = await db
    .prepare(
      `DELETE FROM feedback_challenge WHERE nonce = ?1 AND expires_at >= ?2`,
    )
    .bind(value, now)
    .run();
  return (res?.meta?.changes ?? 0) > 0;
}

// ── Gate ────────────────────────────────────────────────────────────────────

/**
 * Mute, rolling-hour cap, cooldown and global floor for one thread. Derived
 * from the feedback rows themselves, so it costs no extra writes.
 */
export async function gateThread(
  db: any,
  thread: string,
  now: number = Date.now(),
): Promise<GateResult> {
  let results: any[];
  try {
    results = await db.batch([
      db
        .prepare(
          `SELECT muted_until AS mutedUntil FROM feedback_strike WHERE thread = ?1`,
        )
        .bind(thread),
      db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM feedback WHERE thread = ?1 AND ts > ?2) AS lastHour,
             (SELECT COALESCE(MAX(ts), 0) FROM feedback WHERE thread = ?1) AS lastTs`,
        )
        .bind(thread, now - HOUR_MS),
      db
        .prepare(`SELECT COUNT(*) AS n FROM feedback WHERE ts > ?1`)
        .bind(now - HOUR_MS),
    ]);
  } catch {
    // Guard tables missing (migration 010 not applied): fail open, the
    // in-memory buckets and validation still apply.
    return { ok: true };
  }

  const mutedUntil = Number(results?.[0]?.results?.[0]?.mutedUntil ?? 0);
  if (mutedUntil > now) {
    return {
      ok: false,
      reason: "muted",
      retryAfter: Math.max(1, Math.ceil((mutedUntil - now) / 1000)),
    };
  }

  const lastHour = Number(results?.[1]?.results?.[0]?.lastHour ?? 0);
  if (lastHour >= GUARD.perThreadPerHour) {
    return { ok: false, reason: "rate", retryAfter: 900 };
  }

  const lastTs = Number(results?.[1]?.results?.[0]?.lastTs ?? 0);
  if (lastTs > 0 && now - lastTs < GUARD.cooldownMs) {
    return {
      ok: false,
      reason: "cooldown",
      retryAfter: Math.ceil((GUARD.cooldownMs - (now - lastTs)) / 1000),
    };
  }

  const global = Number(results?.[2]?.results?.[0]?.n ?? 0);
  if (global >= GUARD.globalPerHour) {
    return { ok: false, reason: "global", retryAfter: 900 };
  }

  return { ok: true };
}

// ── Dedupe ──────────────────────────────────────────────────────────────────

/** Stable hash of one sender's message, scoped to their thread. */
export async function contentHash(
  thread: string,
  message: string,
): Promise<string> {
  const normalized = String(message)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${thread}\n${normalized}`),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function isDuplicateText(
  db: any,
  thread: string,
  hash: string,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const res = await db
      .prepare(
        `SELECT 1 AS hit FROM feedback
         WHERE thread = ?1 AND content_hash = ?2 AND ts > ?3 LIMIT 1`,
      )
      .bind(thread, hash, now - GUARD.dedupeWindowMs)
      .all();
    return (res?.results?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

// ── Strikes ─────────────────────────────────────────────────────────────────

/**
 * Records an abuse signal for one thread and mutes it when it hits the limit.
 * Called only on rejected/suspicious requests, so a normal user never pays.
 */
export async function addStrike(
  db: any,
  thread: string,
  weight: number = 1,
  now: number = Date.now(),
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO feedback_strike (thread, strikes, window_start, muted_until)
         VALUES (?1, ?2, ?3, 0)
         ON CONFLICT(thread) DO UPDATE SET
           strikes = CASE WHEN feedback_strike.window_start <= ?4
                          THEN ?2 ELSE feedback_strike.strikes + ?2 END,
           window_start = CASE WHEN feedback_strike.window_start <= ?4
                               THEN ?3 ELSE feedback_strike.window_start END`,
      )
      .bind(thread, weight, now, now - GUARD.strikeWindowMs)
      .run();
    await db
      .prepare(
        `UPDATE feedback_strike SET muted_until = ?2
         WHERE thread = ?1 AND strikes >= ?3 AND muted_until <= ?4`,
      )
      .bind(thread, now + GUARD.muteMs, GUARD.maxStrikes, now)
      .run();
  } catch {
    // Strike bookkeeping must never break a submission path.
  }
}
