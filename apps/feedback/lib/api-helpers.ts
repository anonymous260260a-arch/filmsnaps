/**
 * Server-side API helpers for Cloudflare Workers + D1.
 *
 * These run in the Cloudflare Worker environment (via OpenNext).
 * They handle Turnstile verification, rate limiting, spam scoring,
 * content sanitization, IP hashing, and duplicate detection.
 */

import type { NextRequest } from "next/server";

// ── Types ──

export interface DuplicateResult {
  id: string;
  title: string;
  score: number;
}

export interface RateLimitConfig {
  key: string;
  maxRequests: number;
  windowMs: number;
}

// ── D1 Binding ──

export function getDB(): any | null {
  const db = (process.env as any).FEEDBACK_DB;
  if (!db) {
    return null;
  }
  return db;
}

// ── Request Helpers ──

export function getVisitorId(req: NextRequest): string | null {
  return req.headers.get("x-visitor-id") || null;
}

export function getFingerprint(req: NextRequest): string | null {
  return req.headers.get("x-fingerprint") || null;
}

export function getClientIp(req: NextRequest): string {
  // Cloudflare Workers: cf-connecting-ip is the real client IP
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;
  // Fallback: x-forwarded-for
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  // Last resort
  return "unknown";
}

// ── IP Hashing ──

export function hashIp(ip: string): string {
  const secret =
    process.env.IP_HASH_SECRET || "default-secret-change-in-production";
  // Simple hash using a basic string hashing approach
  // In production, use Web Crypto API's subtle.crypto
  const input = `${ip}:${secret}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Convert to hex string, take first 16 chars
  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  return hex.slice(0, 16);
}

// ── Content Sanitization (XSS Protection) ──

/**
 * Strip HTML tags and escape special characters to prevent XSS.
 * This is a simple server-side sanitizer. For rich content, use DOMPurify.
 */
export function sanitize(str: string): string {
  if (!str) return "";
  // Normalize newlines
  let s = str.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Strip HTML tags
  s = s.replace(/<[^>]*>/g, "");
  // Escape HTML entities
  s = s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
  // Trim whitespace
  s = s.trim();
  return s;
}

export function sanitizeObject<T extends Record<string, any>>(obj: T): T {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = sanitize(value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

// ── Turnstile Verification ──

export async function verifyTurnstile(token: string): Promise<boolean> {
  if (!token) return false;

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.warn(
      "[Turnstile] TURNSTILE_SECRET_KEY not configured — skipping verification",
    );
    return true; // Allow in dev without configured key
  }

  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret,
          response: token,
        }),
      },
    );
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.error("[Turnstile] Verification error:", err);
    return false;
  }
}

// ── Rate Limiting ──

export async function checkRateLimit(
  config: RateLimitConfig,
  db: any,
): Promise<{ allowed: boolean; remaining: number; resetAt: string }> {
  const now = Date.now();
  const windowStart = new Date(now - config.windowMs).toISOString();
  const windowStartISO = new Date(now).toISOString();

  try {
    // Use INSERT ... ON CONFLICT for atomic counter increment
    const result = await db
      .prepare(
        `INSERT INTO rate_limits (key, counter, window_start)
         VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET
           counter = CASE
             WHEN window_start >= ? THEN counter + 1
             ELSE 1
           END,
           window_start = CASE
             WHEN window_start < ? THEN ?
             ELSE window_start
           END
         RETURNING counter, window_start`,
      )
      .bind(
        config.key,
        windowStartISO,
        windowStart,
        windowStart,
        windowStartISO,
      )
      .first();

    const counter = result?.counter ?? 1;
    const allowed = counter <= config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - counter);
    const resetAt = result?.window_start
      ? new Date(
          new Date(result.window_start).getTime() + config.windowMs,
        ).toISOString()
      : windowStartISO;

    return { allowed, remaining, resetAt };
  } catch (err) {
    console.error("[RateLimit] Error:", err);
    // On error, allow the request (fail open)
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt: windowStartISO,
    };
  }
}

// ── Spam Scoring ──

export interface SpamScoreInput {
  title: string;
  description: string;
  honeypot?: string;
  [key: string]: any;
}

/**
 * Calculate a spam score (0.0 = clean, 1.0 = definitely spam).
 * Factors: honeypot, min length, repeated chars, caps ratio, link count.
 */
export function calculateSpamScore(data: SpamScoreInput): number {
  let score = 0.0;

  // 1. Honeypot — instant reject
  if (data.honeypot && data.honeypot.trim().length > 0) {
    return 1.0;
  }

  const title = data.title || "";
  const description = data.description || "";
  const combined = `${title} ${description}`;

  // 2. Minimum content length check
  if (title.length < 3) score += 0.1;
  if (description.length < 10) score += 0.1;

  // 3. Repeated character ratio (>70% same character)
  if (combined.length > 5) {
    const charCounts: Record<string, number> = {};
    for (const ch of combined.toLowerCase()) {
      charCounts[ch] = (charCounts[ch] || 0) + 1;
    }
    const maxCount = Math.max(...Object.values(charCounts));
    const maxRatio = maxCount / combined.length;
    if (maxRatio > 0.7) score += 0.3;
  }

  // 4. ALL CAPS ratio (>50% uppercase → penalize)
  if (combined.length > 10) {
    const letters = combined.replace(/[^a-zA-Z]/g, "");
    if (letters.length > 5) {
      const upperCount = letters
        .split("")
        .filter((c) => c === c.toUpperCase()).length;
      const upperRatio = upperCount / letters.length;
      if (upperRatio > 0.5) score += 0.2;
    }
  }

  // 5. Link count (>3 links → spam)
  const linkMatches = combined.match(/https?:\/\/[^\s]+/g);
  const linkCount = linkMatches ? linkMatches.length : 0;
  if (linkCount > 3) score += 0.3;
  else if (linkCount > 0) score += 0.05 * linkCount;

  // 6. Entropy / keyboard smash detection
  // Repeated patterns like "asdf", "qwerty", "1234"
  const smashPatterns = [
    /(.)\1{4,}/, // 5+ same chars: "aaaaa"
    /(?:asdf|qwer|zxcv|1234)/i,
    /(?:test|asdf|xxx|aaa)/i,
  ];
  for (const pattern of smashPatterns) {
    if (pattern.test(combined)) {
      score += 0.2;
      break;
    }
  }

  // 7. Excessive whitespace / newlines
  const newlineCount = (combined.match(/\n/g) || []).length;
  if (newlineCount > 20) score += 0.1;

  // Clamp
  return Math.min(1.0, Math.max(0.0, score));
}

// ── Duplicate Detection ──

export interface DuplicateCheckInput {
  title: string;
  description: string;
  type: string;
}

/**
 * Check for duplicates against existing feedback items in D1.
 * Uses LIKE-based fuzzy matching on title (simple approach for SQLite).
 * For production, consider using Fuse.js on the server.
 */
export async function findDuplicates(
  input: DuplicateCheckInput,
  db: any,
): Promise<DuplicateResult[]> {
  const { title } = input;
  if (!title || title.length < 4) return [];

  try {
    // Find items with similar titles using SQLite LIKE
    // This is a simple approach — extracts words and checks for overlap
    const words = title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);

    if (words.length === 0) return [];

    // Build a query that matches on word overlap
    const conditions = words.map(() => `LOWER(title) LIKE ?`);
    const sql = `
      SELECT id, title FROM feedback
      WHERE type = ? AND status != 'declined'
        AND (${conditions.join(" OR ")})
      ORDER BY created_at DESC
      LIMIT 5
    `;

    const bindings = [input.type, ...words.map((w) => `%${w}%`)];
    const results = await db
      .prepare(sql)
      .bind(...bindings)
      .all();

    if (!results.results || results.results.length === 0) return [];

    // Simple Levenshtein-like similarity score
    return results.results
      .map((row: any) => {
        const score = simpleSimilarity(
          title.toLowerCase(),
          row.title.toLowerCase(),
        );
        return { id: row.id, title: row.title, score };
      })
      .filter((r: any) => r.score < 0.4) // Same threshold as Fuse.js default
      .sort((a: any, b: any) => a.score - b.score);
  } catch (err) {
    console.error("[Duplicates] Error:", err);
    return [];
  }
}

/**
 * Simple string similarity using bigram overlap.
 * Returns a score between 0 (identical) and 1 (completely different).
 */
function simpleSimilarity(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0 || b.length === 0) return 1;

  // Use bigram Jaccard distance
  const bigramsA = new Set<string>();
  const bigramsB = new Set<string>();

  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.slice(i, i + 2));

  if (bigramsA.size === 0 || bigramsB.size === 0) return 1;

  let intersection = 0;
  for (const bigram of Array.from(bigramsA)) {
    if (bigramsB.has(bigram)) intersection++;
  }

  const union = bigramsA.size + bigramsB.size - intersection;
  if (union === 0) return 1;

  // Jaccard distance
  return 1 - intersection / union;
}

// ── Response Helpers ──

export function ok<T>(data: T, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...init,
  });
}

export function error(
  status: number,
  message: string,
  details?: any,
): Response {
  return new Response(
    JSON.stringify({
      error: message,
      ...(details ? { details } : {}),
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
}

// ── Security Headers ──

export function applySecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self' https://challenges.cloudflare.com",
      "frame-src 'self' https://challenges.cloudflare.com",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
