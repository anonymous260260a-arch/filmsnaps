/**
 * GET /api/search — Server-side Fuse.js-like search across all data types
 */

import { NextRequest } from "next/server";
import {
  getDB,
  sanitize,
  ok,
  error,
  applySecurityHeaders,
} from "@/lib/api-helpers";

const SEARCHABLE_TYPES = ["bug", "feature", "roadmap", "faq"] as const;

// Simple in-memory search fallback when D1 is unavailable
import { SEED_ROADMAP, SEED_FAQ } from "@/lib/constants";

function fallbackSearch(query: string, type?: string): Record<string, any[]> {
  const q = query.toLowerCase();
  const results: Record<string, any[]> = {};

  if (!type || type === "roadmap") {
    results.roadmap = SEED_ROADMAP.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q),
    ).slice(0, 20);
  }

  if (!type || type === "faq") {
    const faqItems = SEED_FAQ.flatMap((cat) =>
      cat.items.map((item) => ({
        question: item.question,
        answer: item.answer,
        category_name: cat.name,
        category_id: cat.id,
      })),
    );
    results.faq = faqItems
      .filter(
        (item) =>
          item.question.toLowerCase().includes(q) ||
          item.answer.toLowerCase().includes(q),
      )
      .slice(0, 20);
  }

  if (!type || type === "bug") results.bugs = [];
  if (!type || type === "feature") results.features = [];

  return results;
}

export async function GET(req: NextRequest) {
  try {
    const db = getDB();

    const url = new URL(req.url);

    const query = sanitize(url.searchParams.get("q") || "").trim();
    const type = url.searchParams.get("type") as
      | (typeof SEARCHABLE_TYPES)[number]
      | null;

    if (!query || query.length < 2) {
      return applySecurityHeaders(ok({ items: [] }));
    }

    if (type && !SEARCHABLE_TYPES.includes(type)) {
      return error(
        400,
        `Invalid type '${type}'. Must be one of: ${SEARCHABLE_TYPES.join(", ")}`,
      );
    }

    // Fallback: if D1 not available (dev mode), use in-memory seed data
    if (!db) {
      const results = fallbackSearch(query, type || undefined);
      const totalCount = Object.values(results).reduce(
        (sum, arr) => sum + arr.length,
        0,
      );
      return applySecurityHeaders(
        ok({
          results,
          totalCount,
          query,
          type: type || "all",
        }),
      );
    }

    const searchTerm = `%${query}%`;
    const results: Record<string, any[]> = {};

    // Search bugs
    if (!type || type === "bug") {
      const bugs = await db
        .prepare(
          `SELECT id, type, title, description, status, severity, created_at,
                  device_info, platform, app_version, current_page,
                  expected_behavior, actual_behavior, steps_to_reproduce,
                  visitor_id, spam_score, duplicate_of
           FROM feedback
           WHERE type = 'bug'
             AND (LOWER(title) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?))
           ORDER BY created_at DESC
           LIMIT 20`,
        )
        .bind(searchTerm, searchTerm)
        .all();
      results.bugs = bugs.results || [];
    }

    // Search features
    if (!type || type === "feature") {
      const features = await db
        .prepare(
          `SELECT id, type, title, description, status, created_at,
                  problem, suggested_solution, business_value,
                  visitor_id, spam_score, duplicate_of
           FROM feedback
           WHERE type = 'feature'
             AND (LOWER(title) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?))
           ORDER BY created_at DESC
           LIMIT 20`,
        )
        .bind(searchTerm, searchTerm)
        .all();
      results.features = features.results || [];
    }

    // Search roadmap
    if (!type || type === "roadmap") {
      const roadmap = await db
        .prepare(
          `SELECT * FROM roadmap
           WHERE LOWER(title) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?)
           ORDER BY
             CASE status
               WHEN 'in-progress' THEN 1
               WHEN 'planned' THEN 2
               WHEN 'completed' THEN 3
             END,
             progress DESC
           LIMIT 20`,
        )
        .bind(searchTerm, searchTerm)
        .all();
      results.roadmap = roadmap.results || [];
    }

    // Search FAQ
    if (!type || type === "faq") {
      const faqItems = await db
        .prepare(
          `SELECT fi.id, fi.question, fi.answer, fc.name as category_name, fc.id as category_id
           FROM faq_items fi
           JOIN faq_categories fc ON fc.id = fi.category_id
           WHERE LOWER(fi.question) LIKE LOWER(?) OR LOWER(fi.answer) LIKE LOWER(?)
           LIMIT 20`,
        )
        .bind(searchTerm, searchTerm)
        .all();
      results.faq = faqItems.results || [];
    }

    const totalCount = Object.values(results).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );

    return applySecurityHeaders(
      ok({
        results,
        totalCount,
        query,
        type: type || "all",
      }),
    );
  } catch (err: any) {
    console.error("[API search] Error:", err);
    return error(500, "Internal server error");
  }
}
