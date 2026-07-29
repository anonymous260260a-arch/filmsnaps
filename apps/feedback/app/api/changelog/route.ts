/**
 * GET /api/changelog — List all changelog entries with their changes
 */

import { NextRequest } from "next/server";
import { getDB, ok, error, applySecurityHeaders } from "@/lib/api-helpers";
import { SEED_CHANGELOG } from "@/lib/constants";

export async function GET(req: NextRequest) {
  try {
    const db = getDB();

    // Fallback: if D1 not available (dev mode), serve seed data
    if (!db) {
      return applySecurityHeaders(ok({ items: SEED_CHANGELOG }));
    }

    const entries = await db
      .prepare(
        `SELECT * FROM changelog
         ORDER BY release_date DESC`,
      )
      .all();

    const results = [];

    for (const entry of (entries.results || []) as any[]) {
      const changes = await db
        .prepare(
          `SELECT change_type as type, description
           FROM changelog_changes
           WHERE version = ?
           ORDER BY id ASC`,
        )
        .bind(entry.version)
        .all();

      results.push({
        version: entry.version,
        releaseDate: entry.release_date,
        changes: (changes.results || []).map((c: any) => ({
          type: c.type,
          description: c.description,
        })),
      });
    }

    return applySecurityHeaders(ok({ items: results }));
  } catch (err: any) {
    console.error("[API changelog] Error:", err);
    return error(500, "Internal server error");
  }
}
