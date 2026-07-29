/**
 * GET /api/faq — List all FAQ categories with items
 */

import { NextRequest } from "next/server";
import { getDB, ok, error, applySecurityHeaders } from "@/lib/api-helpers";
import { SEED_FAQ } from "@/lib/constants";

export async function GET(req: NextRequest) {
  try {
    const db = getDB();

    // Fallback: if D1 not available (dev mode), serve seed data
    if (!db) {
      return applySecurityHeaders(ok({ items: SEED_FAQ }));
    }

    const categories = await db
      .prepare("SELECT * FROM faq_categories ORDER BY id ASC")
      .all();

    const results = [];

    for (const cat of (categories.results || []) as any[]) {
      const items = await db
        .prepare(
          `SELECT question, answer
           FROM faq_items
           WHERE category_id = ?
           ORDER BY id ASC`,
        )
        .bind(cat.id)
        .all();

      results.push({
        id: cat.id,
        name: cat.name,
        items: items.results || [],
      });
    }

    return applySecurityHeaders(ok({ items: results }));
  } catch (err: any) {
    console.error("[API faq] Error:", err);
    return error(500, "Internal server error");
  }
}
