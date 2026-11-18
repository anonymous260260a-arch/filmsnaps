/**
 * GET /api/feedback/mine?thread=<uuid> — the sender's own submissions.
 *
 * The app holds a random per-install UUID (never a device or account id) and
 * presents it as a capability: knowing it is the only way to read this
 * install's messages. Requests without a well-formed token get an empty list
 * rather than an error, so nothing here reveals whether a token exists.
 *
 * Rows are returned whether or not the team has answered yet — the app lists
 * what the user sent and shows the reply inline when there is one.
 */
import { NextRequest, NextResponse } from "next/server";

const THREAD_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const NO_STORE = { "cache-control": "no-store" } as const;

function empty() {
  return NextResponse.json({ rows: [] }, { headers: NO_STORE });
}

export async function GET(req: NextRequest) {
  const thread = (new URL(req.url).searchParams.get("thread") ?? "").trim();
  if (!THREAD_RE.test(thread)) return empty();

  let db: any = null;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    db = (getCloudflareContext().env as any).TELEMETRY_DB ?? null;
  } catch {
    return empty();
  }
  if (!db) return empty();

  try {
    const res = await db
      .prepare(
        `SELECT id, type, message, rating, status, reply,
                replied_ts AS repliedTs, reply_vote AS replyVote, ts
         FROM feedback
         WHERE thread = ?1
         ORDER BY ts DESC LIMIT 50`,
      )
      .bind(thread)
      .all();
    return NextResponse.json(
      { rows: res.results ?? [] },
      { headers: NO_STORE },
    );
  } catch {
    return empty();
  }
}
