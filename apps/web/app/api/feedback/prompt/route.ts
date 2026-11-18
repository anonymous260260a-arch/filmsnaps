/**
 * POST /api/feedback/prompt — records the outcome of the in-app rating prompt.
 *
 * Two outcomes exist: "rated" (the prompt's own rating was submitted) and
 * "declined" (the user dismissed it). The admin inbox shows both counts, which
 * is why a dismissal needs a server-side record — refusals are never feedback
 * rows and never appear in the inbox itself.
 *
 * Nothing identifying is stored: the same random per-install thread token the
 * feedback rows use, a day bucket and a timestamp.
 */
import { NextRequest, NextResponse } from "next/server";

const OUTCOMES = new Set(["rated", "declined"]);
const THREAD_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bad(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, error: message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid request body");
  }

  const outcome = String(body.outcome ?? "");
  if (!OUTCOMES.has(outcome)) return bad("Unknown outcome");

  const thread = String(body.thread ?? "").trim();
  if (!THREAD_RE.test(thread)) return bad("Invalid request body");

  let db: any = null;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    db = (getCloudflareContext().env as any).TELEMETRY_DB ?? null;
  } catch {
    return bad("Service temporarily unavailable", 503);
  }
  if (!db) return bad("Service temporarily unavailable", 503);

  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);

  // Per-install cap: prompt outcomes are a write path an attacker can loop on.
  // Counted from the rows themselves, so it costs no extra writes.
  try {
    const recent = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM feedback_prompt WHERE thread = ?1 AND ts > ?2`,
      )
      .bind(thread, now - 60 * 60 * 1000)
      .all();
    if (Number(recent?.results?.[0]?.n ?? 0) >= 10) {
      return NextResponse.json(
        { ok: false, error: "rate" },
        {
          status: 429,
          headers: { "cache-control": "no-store", "retry-after": "900" },
        },
      );
    }
  } catch {
    // Table missing or unreadable — the insert below decides.
  }

  try {
    await db
      .prepare(
        `INSERT INTO feedback_prompt (day, outcome, thread, ts) VALUES (?1, ?2, ?3, ?4)`,
      )
      .bind(day, outcome, thread || null, now)
      .run();
  } catch (e) {
    console.error("[feedback] prompt outcome insert failed", e);
    return bad("Service temporarily unavailable", 503);
  }

  return NextResponse.json(
    { ok: true },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}
