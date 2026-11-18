/**
 * POST /api/feedback/vote — the sender rates the team's reply.
 *
 *   { thread, id, vote: "like" | "dislike" | null }
 *
 * The thread token is the capability: a row is only updated when both its id
 * and its thread match, and only once the team has actually replied. Passing
 * null clears the vote (tapping the same button again). Nothing identifying
 * is stored beyond the per-install token.
 */
import { NextRequest, NextResponse } from "next/server";

const THREAD_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VOTES = new Set(["like", "dislike"]);

const NO_STORE = { "cache-control": "no-store" } as const;

function bad(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, error: message },
    { status, headers: NO_STORE },
  );
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid request body");
  }

  const thread = String(body.thread ?? "").trim();
  if (!THREAD_RE.test(thread)) return bad("Invalid request body");

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return bad("Invalid id");

  const rawVote = body.vote;
  const vote =
    rawVote == null
      ? null
      : String(rawVote).trim() === ""
        ? null
        : String(rawVote);
  if (vote !== null && !VOTES.has(vote)) return bad("Unknown vote");

  let db: any = null;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    db = (getCloudflareContext().env as any).TELEMETRY_DB ?? null;
  } catch {
    return bad("Service temporarily unavailable", 503);
  }
  if (!db) return bad("Service temporarily unavailable", 503);

  try {
    const res = await db
      .prepare(
        `UPDATE feedback SET reply_vote = ?3
         WHERE id = ?2 AND thread = ?1 AND reply IS NOT NULL`,
      )
      .bind(thread, id, vote)
      .run();
    if ((res?.meta?.changes ?? 0) === 0) {
      return bad("No reply to rate", 404);
    }
  } catch (e) {
    console.error("[feedback] vote update failed", e);
    return bad("Service temporarily unavailable", 503);
  }

  return NextResponse.json({ ok: true, vote }, { headers: NO_STORE });
}
