/**
 * POST /api/vote — Upvote or remove upvote on feedback/roadmap items
 */

import { NextRequest } from "next/server";
import {
  getDB,
  getVisitorId,
  getClientIp,
  hashIp,
  verifyTurnstile,
  checkRateLimit,
  ok,
  error,
  applySecurityHeaders,
} from "@/lib/api-helpers";

export async function POST(req: NextRequest) {
  try {
    const db = getDB();
    if (!db) {
      return error(
        503,
        "Database not available in dev mode. Use `pnpm cf:preview` for full functionality.",
      );
    }

    const visitorId = getVisitorId(req);
    const clientIp = getClientIp(req);
    const ipHash = hashIp(clientIp);

    if (!visitorId) {
      return error(400, "x-visitor-id header is required for voting");
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return error(400, "Invalid JSON body");
    }

    const { feedbackId, action } = body;

    if (!feedbackId || !action) {
      return error(400, "feedbackId and action are required");
    }

    if (!["upvote", "removeUpvote"].includes(action)) {
      return error(400, "Action must be 'upvote' or 'removeUpvote'");
    }

    // Rate limiting: max 10 votes per hour per visitor
    const voteLimit = await checkRateLimit(
      { key: `vote:${visitorId}`, maxRequests: 10, windowMs: 3600000 },
      db,
    );
    if (!voteLimit.allowed) {
      return error(429, "Too many votes. Please try again later.");
    }

    if (action === "upvote") {
      // Check if already voted
      const existing = await db
        .prepare(
          "SELECT id FROM votes WHERE feedback_id = ? AND visitor_id = ?",
        )
        .bind(feedbackId, visitorId)
        .first();

      if (existing) {
        return ok({ success: true, action: "already_voted" });
      }

      // Insert vote
      const voteId = `vote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await db
        .prepare(
          `INSERT INTO votes (id, feedback_id, visitor_id, type)
           VALUES (?, ?, ?, 'upvote')`,
        )
        .bind(voteId, feedbackId, visitorId)
        .run();

      // Try to update the item's upvote count too
      // First check if it's a roadmap item
      const isRoadmap = feedbackId.startsWith("rm-");
      if (isRoadmap) {
        // Roadmap items don't have an upvote column in their table
        // We count them from the votes table
      }
    } else {
      // removeUpvote
      const existing = await db
        .prepare(
          "SELECT id FROM votes WHERE feedback_id = ? AND visitor_id = ?",
        )
        .bind(feedbackId, visitorId)
        .first();

      if (!existing) {
        return ok({ success: true, action: "not_voted" });
      }

      await db
        .prepare("DELETE FROM votes WHERE feedback_id = ? AND visitor_id = ?")
        .bind(feedbackId, visitorId)
        .run();
    }

    // Count current votes
    const countResult = await db
      .prepare("SELECT COUNT(*) as count FROM votes WHERE feedback_id = ?")
      .bind(feedbackId)
      .first();
    const voteCount = (countResult as any)?.count || 0;

    return applySecurityHeaders(
      ok({
        success: true,
        action,
        voteCount,
        hasUpvoted: action === "upvote",
      }),
    );
  } catch (err: any) {
    console.error("[API vote] Error:", err);
    return error(500, "Internal server error");
  }
}

export async function GET(req: NextRequest) {
  try {
    const db = getDB();
    if (!db) {
      return applySecurityHeaders(
        ok({ feedbackId: null, voteCount: 0, hasUpvoted: false }),
      );
    }
    const url = new URL(req.url);
    const feedbackId = url.searchParams.get("feedbackId");
    const visitorId = url.searchParams.get("visitorId");

    if (!feedbackId) {
      return error(400, "feedbackId query parameter is required");
    }

    // Count votes
    const countResult = await db
      .prepare("SELECT COUNT(*) as count FROM votes WHERE feedback_id = ?")
      .bind(feedbackId)
      .first();
    const voteCount = countResult?.count || 0;

    // Check if specific visitor has voted
    let hasUpvoted = false;
    if (visitorId) {
      const existing = await db
        .prepare(
          "SELECT id FROM votes WHERE feedback_id = ? AND visitor_id = ?",
        )
        .bind(feedbackId, visitorId)
        .first();
      hasUpvoted = !!existing;
    }

    return applySecurityHeaders(
      ok({
        feedbackId,
        voteCount,
        hasUpvoted,
      }),
    );
  } catch (err: any) {
    console.error("[API vote GET] Error:", err);
    return error(500, "Internal server error");
  }
}
