/**
 * POST /api/feedback — Create a bug report or feature request
 * GET /api/feedback — List feedback items with filters and search
 */

import { NextRequest } from "next/server";
import {
  getDB,
  getVisitorId,
  getFingerprint,
  getClientIp,
  hashIp,
  sanitize,
  sanitizeObject,
  verifyTurnstile,
  checkRateLimit,
  calculateSpamScore,
  findDuplicates,
  ok,
  error,
  applySecurityHeaders,
} from "@/lib/api-helpers";
import type { SpamScoreInput } from "@/lib/api-helpers";
import { SEED_ROADMAP, SEED_FAQ, SEED_CHANGELOG } from "@/lib/constants";

// ── POST: Create feedback ──

export async function POST(req: NextRequest) {
  try {
    const db = getDB();

    // D1 must be available for writes
    if (!db) {
      return error(
        503,
        "Database not available in dev mode. Use `pnpm cf:preview` for full functionality.",
      );
    }

    const visitorId = getVisitorId(req);
    const fingerprint = getFingerprint(req);
    const clientIp = getClientIp(req);
    const ipHash = hashIp(clientIp);

    // Parse body
    const body = await req.json().catch(() => null);
    if (!body) {
      return error(400, "Invalid JSON body");
    }

    const { type, turnstileToken, honeypot, ...fields } = body;

    // Validate type
    if (type !== "bug" && type !== "feature") {
      return error(400, "Type must be 'bug' or 'feature'");
    }

    // ── Honeypot check ──
    if (honeypot && honeypot.trim().length > 0) {
      // Silently accept but mark as spam for admin review
      await db
        .prepare(
          `INSERT INTO feedback (
            id, type, title, description, status, severity,
            expected_behavior, actual_behavior, steps_to_reproduce,
            device_info, app_version, platform, current_page,
            problem, suggested_solution, alternative_solutions, business_value,
            visitor_id, fingerprint, ip_hash, spam_score, honeypot_caught,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'open',
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, 1.0, 1,
            datetime('now'), datetime('now')
          )`,
        )
        .bind(
          `${type === "bug" ? "bug" : "feat"}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type,
          sanitize(fields.title || "spam"),
          sanitize(fields.description || "spam"),
          fields.severity || null,
          sanitize(fields.expectedBehavior || ""),
          sanitize(fields.actualBehavior || ""),
          sanitize(fields.stepsToReproduce || ""),
          sanitize(fields.deviceInfo || ""),
          fields.appVersion || null,
          fields.platform || null,
          fields.currentPage || null,
          sanitize(fields.problem || ""),
          sanitize(fields.suggestedSolution || ""),
          fields.alternativeSolutions || null,
          fields.businessValue || "",
          visitorId || null,
          fingerprint || null,
          ipHash,
        )
        .run();

      // Return success but mark as caught by honeypot
      return ok({ success: true, honeypotCaught: true });
    }

    // ── Validate required fields ──
    if (!fields.title || fields.title.trim().length < 2) {
      return error(400, "Title is required (min 2 characters)");
    }
    if (!fields.description || fields.description.trim().length < 5) {
      return error(400, "Description is required (min 5 characters)");
    }

    // ── Turnstile verification ──
    if (turnstileToken) {
      const valid = await verifyTurnstile(turnstileToken);
      if (!valid) {
        return error(429, "Turnstile verification failed. Please try again.");
      }
    }

    // ── Rate limiting ──
    const maxIp = parseInt(process.env.RATE_LIMIT_IP_MAX || "20", 10);
    const maxVisitor = parseInt(process.env.RATE_LIMIT_VISITOR_MAX || "10", 10);
    const maxFp = parseInt(process.env.RATE_LIMIT_FINGERPRINT_MAX || "5", 10);
    const windowMs = parseInt(
      process.env.RATE_LIMIT_WINDOW_MS || "3600000",
      10,
    );

    const ipLimit = await checkRateLimit(
      { key: `ip:${ipHash}`, maxRequests: maxIp, windowMs },
      db,
    );
    if (!ipLimit.allowed) {
      return error(
        429,
        `Rate limit exceeded. Try again after ${new Date(ipLimit.resetAt).toLocaleTimeString()}.`,
      );
    }

    if (visitorId) {
      const visitorLimit = await checkRateLimit(
        { key: `visitor:${visitorId}`, maxRequests: maxVisitor, windowMs },
        db,
      );
      if (!visitorLimit.allowed) {
        return error(
          429,
          "Too many submissions from this device. Please try again later.",
        );
      }
    }

    if (fingerprint) {
      const fpLimit = await checkRateLimit(
        { key: `fp:${fingerprint}`, maxRequests: maxFp, windowMs },
        db,
      );
      if (!fpLimit.allowed) {
        return error(429, "Too many submissions. Please try again later.");
      }
    }

    // ── Sanitize ──
    const sanitized = sanitizeObject(fields);

    // ── Spam score ──
    const spamInput: SpamScoreInput = {
      title: sanitized.title || "",
      description: sanitized.description || "",
    };
    const spamScore = calculateSpamScore(spamInput);

    if (spamScore > 0.7) {
      // Auto-reject high spam scores
      return error(
        400,
        "Your submission was flagged as spam. Please review your content.",
      );
    }

    // ── Duplicate detection ──
    const duplicates = await findDuplicates(
      { title: sanitized.title, description: sanitized.description, type },
      db,
    );

    const id = `${type === "bug" ? "bug" : "feat"}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const duplicateOf = duplicates.length > 0 ? duplicates[0].id : null;

    // ── Insert into D1 ──
    const stmt = db.prepare(
      `INSERT INTO feedback (
        id, type, title, description, status, severity,
        expected_behavior, actual_behavior, steps_to_reproduce,
        device_info, app_version, platform, current_page,
        problem, suggested_solution, alternative_solutions, business_value,
        visitor_id, fingerprint, ip_hash, spam_score, duplicate_of,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'open',
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        datetime('now'), datetime('now')
      )`,
    );

    if (type === "bug") {
      await stmt
        .bind(
          id,
          type,
          sanitized.title,
          sanitized.description,
          sanitized.severity || "medium",
          sanitized.expectedBehavior || "",
          sanitized.actualBehavior || "",
          sanitized.stepsToReproduce || "",
          sanitized.deviceInfo || null,
          sanitized.appVersion || null,
          sanitized.platform || null,
          sanitized.currentPage || null,
          null,
          null,
          null,
          null,
          visitorId || null,
          fingerprint || null,
          ipHash,
          spamScore,
          duplicateOf,
        )
        .run();
    } else {
      await stmt
        .bind(
          id,
          type,
          sanitized.title,
          sanitized.description,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          sanitized.problem || "",
          sanitized.suggestedSolution || "",
          sanitized.alternativeSolutions || null,
          sanitized.businessValue || "",
          visitorId || null,
          fingerprint || null,
          ipHash,
          spamScore,
          duplicateOf,
        )
        .run();
    }

    // Fetch the created item
    const created = await db
      .prepare("SELECT * FROM feedback WHERE id = ?")
      .bind(id)
      .first();

    return applySecurityHeaders(
      ok({
        success: true,
        feedback: created,
        duplicates: duplicates.length > 0 ? duplicates : undefined,
        spamScore,
      }),
    );
  } catch (err: any) {
    console.error("[API feedback POST] Error:", err);
    return error(500, "Internal server error");
  }
}

// ── GET: List feedback ──

export async function GET(req: NextRequest) {
  try {
    const db = getDB();

    // Fallback: if D1 not available (dev mode), return empty list
    if (!db) {
      return applySecurityHeaders(
        ok({
          items: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        }),
      );
    }
    const url = new URL(req.url);

    const type = url.searchParams.get("type"); // 'bug' | 'feature'
    const status = url.searchParams.get("status"); // 'open' | 'planned' | etc.
    const search = url.searchParams.get("search");
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "20", 10),
      100,
    );
    const offset = (page - 1) * limit;

    // Build query
    const conditions: string[] = [];
    const bindings: any[] = [];

    if (type && ["bug", "feature"].includes(type)) {
      conditions.push("type = ?");
      bindings.push(type);
    }
    if (
      status &&
      ["open", "planned", "in-progress", "completed", "declined"].includes(
        status,
      )
    ) {
      conditions.push("status = ?");
      bindings.push(status);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count total
    const countResult = await db
      .prepare(`SELECT COUNT(*) as total FROM feedback ${whereClause}`)
      .bind(...bindings)
      .first();
    const total = countResult?.total || 0;

    // Fetch items
    const items = await db
      .prepare(
        `SELECT * FROM feedback ${whereClause}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(...bindings, limit, offset)
      .all();

    // Optional: client-side search filter with simple matching
    let results = items.results || [];
    if (search && search.trim()) {
      const q = search.toLowerCase();
      results = results.filter(
        (r: any) =>
          (r.title && r.title.toLowerCase().includes(q)) ||
          (r.description && r.description.toLowerCase().includes(q)),
      );
    }

    return applySecurityHeaders(
      ok({
        items: results,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      }),
    );
  } catch (err: any) {
    console.error("[API feedback GET] Error:", err);
    return error(500, "Internal server error");
  }
}
