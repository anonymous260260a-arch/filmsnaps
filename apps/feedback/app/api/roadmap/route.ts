/**
 * GET /api/roadmap — List all roadmap items
 */

import { NextRequest } from "next/server";
import { getDB, ok, error, applySecurityHeaders } from "@/lib/api-helpers";
import { SEED_ROADMAP } from "@/lib/constants";

export async function GET(req: NextRequest) {
  try {
    const db = getDB();
    const url = new URL(req.url);
    const status = url.searchParams.get("status");

    // Fallback: if D1 not available (dev mode), serve seed data
    if (!db) {
      let items = SEED_ROADMAP;
      if (status && ["planned", "in-progress", "completed"].includes(status)) {
        items = items.filter((item) => item.status === status);
      }
      return applySecurityHeaders(ok({ items }));
    }

    let query = `
      SELECT r.*, COALESCE(v.vote_count, 0) as upvotes
      FROM roadmap r
      LEFT JOIN (
        SELECT feedback_id, COUNT(*) as vote_count
        FROM votes
        WHERE feedback_id LIKE 'rm-%'
        GROUP BY feedback_id
      ) v ON v.feedback_id = r.id
    `;
    const bindings: any[] = [];

    if (status && ["planned", "in-progress", "completed"].includes(status)) {
      query += " WHERE r.status = ?";
      bindings.push(status);
    }

    query += ` ORDER BY
      CASE r.status
        WHEN 'in-progress' THEN 1
        WHEN 'planned' THEN 2
        WHEN 'completed' THEN 3
      END,
      r.progress DESC`;

    const items = await db
      .prepare(query)
      .bind(...bindings)
      .all();

    return applySecurityHeaders(ok({ items: items.results || [] }));
  } catch (err: any) {
    console.error("[API roadmap] Error:", err);
    return error(500, "Internal server error");
  }
}
