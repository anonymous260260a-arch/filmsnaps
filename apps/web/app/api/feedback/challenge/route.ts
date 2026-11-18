/**
 * POST /api/feedback/challenge — step 1 of a submission.
 *
 * Returns a single-use nonce (10 minute TTL) that POST /api/feedback requires.
 * Blind scripted POSTs no longer land: the caller must do the handshake, and
 * each nonce can be spent once.
 *
 * Nothing identifying is stored with the nonce — a random value and an expiry.
 * The client fetches a fresh one immediately before sending, including when the
 * outbox flushes a queued draft.
 */
import { NextRequest, NextResponse } from "next/server";
import { handleOptions } from "@/lib/cors";
import { issueChallenge } from "@/lib/feedbackGuard";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

export async function POST(_req: NextRequest) {
  let db: any = null;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    db = (getCloudflareContext().env as any).TELEMETRY_DB ?? null;
  } catch {
    return NextResponse.json(
      { ok: false, error: "unavailable" },
      { status: 503, headers: NO_STORE },
    );
  }
  if (!db) {
    return NextResponse.json(
      { ok: false, error: "unavailable" },
      { status: 503, headers: NO_STORE },
    );
  }

  try {
    const challenge = await issueChallenge(db);
    return NextResponse.json(challenge, { headers: NO_STORE });
  } catch (e) {
    console.error("[feedback] challenge issue failed", e);
    return NextResponse.json(
      { ok: false, error: "unavailable" },
      { status: 503, headers: NO_STORE },
    );
  }
}
