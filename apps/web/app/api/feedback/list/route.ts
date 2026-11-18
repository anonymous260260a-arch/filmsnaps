/**
 * Admin-only feedback management. Protected by Basic auth in middleware.ts
 * (path is in the isAdminPath scope) — this handler only serves data.
 *
 *   GET    ?status=<new|read|done|spam|all>&includeFlagged=1&limit=N
 *   PATCH  { id, status }  |  { id, reply }  |  { id, deleted: true }
 *
 * The dedicated /admin/feedback page loads ONLY this endpoint, so reply work
 * never pays for the heavy telemetry dashboard queries. Saving a reply marks
 * the row 'done' and stamps replied_ts; the sender reads it back in the app.
 */
import { NextRequest, NextResponse } from "next/server";

const STATUSES = new Set(["new", "read", "done", "spam"]);
const LIST_STATUSES = new Set<string>(["new", "read", "done", "spam", "all"]);
const MAX_LIMIT = 200;
const REPLY_MAX = 2000;
const THREAD_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getDB(): Promise<any | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    return (getCloudflareContext().env as any).TELEMETRY_DB ?? null;
  } catch {
    return null;
  }
}

function bad(message: string, status = 400) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(req: NextRequest) {
  const db = await getDB();
  if (!db) return bad("db-unbound", 503);

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "new";
  if (!LIST_STATUSES.has(status)) return bad("Unknown status");
  const includeFlagged = url.searchParams.get("includeFlagged") === "1";
  // Sender filter: one thread token holds every message from one install.
  const threadParam = (url.searchParams.get("thread") ?? "").trim();
  const thread = THREAD_RE.test(threadParam) ? threadParam : null;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit")) || 100),
  );

  const where: string[] = [];
  const bind: unknown[] = [];
  if (thread) {
    bind.push(thread);
    where.push(`thread = ?${bind.length}`);
  } else {
    if (status !== "all") {
      bind.push(status);
      where.push(`status = ?${bind.length}`);
    }
    if (!includeFlagged) where.push("flagged = 0");
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  bind.push(limit);

  const rows = await db
    .prepare(
      `SELECT id, day, type, message, rating, client, thread,
              app_version AS appVersion, status, flagged, reply,
              replied_ts AS repliedTs, reply_vote AS replyVote, ts
       FROM feedback
       ${whereSql}
       ORDER BY ts DESC LIMIT ?${bind.length}`,
    )
    .bind(...bind)
    .all();

  const countWhere = includeFlagged ? "" : "WHERE flagged = 0";
  const [counts, rated, promptRows] = await Promise.all([
    db
      .prepare(
        `SELECT status, COUNT(*) AS n FROM feedback ${countWhere} GROUP BY status`,
      )
      .all(),
    db
      .prepare(
        `SELECT AVG(rating) AS avg, COUNT(rating) AS n FROM feedback ${countWhere}`,
      )
      .all(),
    // Prompt outcomes live in their own table; a missing one (migration 008 not
    // applied yet) must not take the inbox down.
    db
      .prepare(
        `SELECT outcome, COUNT(*) AS n FROM feedback_prompt GROUP BY outcome`,
      )
      .all()
      .catch(() => ({ results: [] })),
  ]);

  const countMap: Record<string, number> = {};
  let total = 0;
  for (const r of counts.results ?? []) {
    const key = String(r.status);
    const n = Number(r.n) || 0;
    countMap[key] = n;
    total += n;
  }
  const ratingRow = rated.results?.[0] as
    | { avg?: number | null; n?: number | null }
    | undefined;

  const promptTally: Record<string, number> = {};
  for (const r of promptRows.results ?? []) {
    promptTally[String(r.outcome)] = Number(r.n) || 0;
  }

  return NextResponse.json(
    {
      rows: rows.results ?? [],
      counts: { ...countMap, all: total },
      rating: {
        avg: ratingRow?.avg == null ? null : Number(ratingRow.avg),
        count: Number(ratingRow?.n) || 0,
      },
      prompt: {
        rated: promptTally.rated ?? 0,
        declined: promptTally.declined ?? 0,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function PATCH(req: NextRequest) {
  const db = await getDB();
  if (!db) return bad("db-unbound", 503);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid request body");
  }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return bad("Invalid id");

  if (body.deleted === true) {
    await db.prepare(`DELETE FROM feedback WHERE id = ?1`).bind(id).run();
    return NextResponse.json(
      { ok: true },
      { headers: { "cache-control": "no-store" } },
    );
  }

  if (body.reply !== undefined) {
    const reply = String(body.reply ?? "").trim();
    if (reply.length > REPLY_MAX)
      return bad(`Reply must be at most ${REPLY_MAX} characters`);
    if (!reply) {
      await db
        .prepare(
          `UPDATE feedback SET reply = NULL, replied_ts = NULL WHERE id = ?1`,
        )
        .bind(id)
        .run();
    } else {
      await db
        .prepare(
          `UPDATE feedback SET reply = ?2, replied_ts = ?3, status = 'done' WHERE id = ?1`,
        )
        .bind(id, reply, Date.now())
        .run();
    }
    return NextResponse.json(
      { ok: true },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const status = String(body.status ?? "");
  if (!STATUSES.has(status)) return bad("Unknown status");
  await db
    .prepare(`UPDATE feedback SET status = ?2 WHERE id = ?1`)
    .bind(id, status)
    .run();

  return NextResponse.json(
    { ok: true },
    { headers: { "cache-control": "no-store" } },
  );
}
