/**
 * Edge middleware — three jobs:
 *
 * 1. Deep-link redirects: path-form /movie/{id} and /tv/{id} (mobile share
 *    sheet / Android App Links / filmsnaps:// scheme) → the canonical ?id=
 *    routes the client pages actually render. These live HERE instead of in
 *    app/movie/[id]/page.tsx because dynamic pages cannot be statically
 *    exported for the desktop shell (output: "export" requires prerendered
 *    variants). Middleware ships with server deployments and is simply absent
 *    from the static export, where unknown paths fall back to the shell's
 *    home page via the app:// handler.
 *
 * 2. Per-IP rate limiting (runs on BOTH deployments: the Cloudflare Worker's
 *    Next surface and the Netlify public site, where worker.mjs does not
 *    exist). In-memory windowed counters per isolate — approximate, tuned
 *    generously so real users can never trip them; scrapers hit the wall.
 *    Identity comes from platform-injected IP headers (Netlify's
 *    x-nf-client-connection-ip / Cloudflare's CF-Connecting-IP) — never from
 *    client-supplied headers like x-client/x-anon-id, which are spoofable.
 *
 * 3. Basic Auth for /admin and /api/telemetry/dashboard — the same model the
 *    old /admin route used: Authorization: Basic base64(<user>:<ADMIN_TOKEN>).
 *
 *    - Browser shows the native username/password prompt (no token plumbing in
 *      the page; the browser replays the credentials for same-origin fetches).
 *    - Fail closed: unset ADMIN_TOKEN = /admin disabled (generic 401).
 *    - Constant-time compare: both sides SHA-256 hashed before comparison.
 *    - Every failure is the identical generic 401 + WWW-Authenticate challenge.
 *    - No-store on all admin responses.
 */
import { NextResponse, type NextRequest } from "next/server";

const NO_STORE = { "Cache-Control": "no-store" } as const;

// ── Rate limiting (per-IP, in-memory, per isolate) ─────────────────────────
const RL_WINDOW_MS = 60_000;
const RL_PAGE = 240; // humans + prefetch bursts; scrapers do 1000s/min
const RL_API = 150; // per IP, all /api/*
const RL_EXPENSIVE = 30; // upstream-quota-burning resolvers/proxies
const RL_TELEMETRY = 10; // D1-write budget protection
const RL_FEEDBACK = 3; // per hour — nobody legitimately submits 3+ feedbacks/hour
const RL_FEEDBACK_WINDOW_MS = 3_600_000;
const RL_MAX_TRACKED_IPS = 10_000;

const rlBuckets = new Map<string, { count: number; windowStart: number }>();

function rlIp(req: NextRequest): string {
  return (
    req.headers.get("x-nf-client-connection-ip") ||
    req.headers.get("CF-Connecting-IP") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function rlBump(
  key: string,
  limit: number,
  now: number,
  windowMs: number = RL_WINDOW_MS,
): boolean {
  let b = rlBuckets.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    b = { count: 0, windowStart: now };
    rlBuckets.set(key, b);
  }
  b.count += 1;
  return b.count > limit;
}

function rlPrune(now: number) {
  if (rlBuckets.size <= RL_MAX_TRACKED_IPS) return;
  const expired: string[] = [];
  rlBuckets.forEach((b, k) => {
    if (now - b.windowStart >= RL_WINDOW_MS) expired.push(k);
  });
  for (const k of expired) rlBuckets.delete(k);
}

function rl429(): NextResponse {
  return new NextResponse(JSON.stringify({ error: "rate limited" }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": "30" },
  });
}

function isExpensiveApiPath(p: string): boolean {
  return (
    p.startsWith("/api/player/") ||
    p === "/api/stream" ||
    p.startsWith("/api/stream/") ||
    p === "/api/subtitles" ||
    p.startsWith("/api/subtitles/") ||
    p === "/api/anime/resolve"
  );
}

function rateLimited(req: NextRequest, pathname: string): NextResponse | null {
  const now = Date.now();
  const ip = rlIp(req);

  if (pathname === "/api/telemetry") {
    if (rlBump("t:" + ip, RL_TELEMETRY, now)) {
      rlPrune(now);
      return rl429();
    }
    return null;
  }

  if (pathname.startsWith("/api/")) {
    if (pathname === "/api/feedback") {
      if (rlBump("f:" + ip, RL_FEEDBACK, now, RL_FEEDBACK_WINDOW_MS)) {
        rlPrune(now);
        return rl429();
      }
      return null;
    }
    const limit = isExpensiveApiPath(pathname) ? RL_EXPENSIVE : RL_API;
    if (rlBump("a:" + ip, limit, now)) {
      rlPrune(now);
      return rl429();
    }
    return null;
  }

  if (rlBump("p:" + ip, RL_PAGE, now)) {
    rlPrune(now);
    return rl429();
  }
  return null;
}

function unauthorized(): NextResponse {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      ...NO_STORE,
      "WWW-Authenticate": 'Basic realm="filmsnaps-admin"',
    },
  });
}

async function sha256Hex(value: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── 1. Rate limiting (before redirect/auth so abuse burns nothing) ──
  const limited = rateLimited(req, pathname);
  if (limited) return limited;

  // ── 2. Deep-link redirect (no auth involved) ──
  const deepLink = pathname.match(/^\/(movie|tv)\/([^/]+)$/);
  if (deepLink) {
    return NextResponse.redirect(
      new URL(`/${deepLink[1]}?id=${encodeURIComponent(deepLink[2])}`, req.url),
    );
  }

  // ── 3. Admin auth — /admin pages and the feedback management API ──
  const isAdminPath =
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/telemetry/dashboard" ||
    pathname.startsWith("/api/feedback/list");
  if (!isAdminPath) return NextResponse.next();

  const token = process.env.ADMIN_TOKEN;
  if (!token) return unauthorized();

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return unauthorized();

  let provided: string;
  try {
    const decoded = atob(auth.slice(6));
    const idx = decoded.indexOf(":");
    if (idx < 0) return unauthorized();
    provided = decoded.slice(idx + 1);
  } catch {
    return unauthorized();
  }

  const [providedHash, tokenHash] = await Promise.all([
    sha256Hex(provided),
    sha256Hex(token),
  ]);
  if (!constantTimeEqual(providedHash, tokenHash)) return unauthorized();

  const res = NextResponse.next();
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = {
  // Everything except Next internals and static assets — rate limiting must
  // see all page and API traffic; assets are served without middleware.
  matcher: [
    "/((?!_next/static|_next/image|favicon|placeholder|manifest|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml|json|wasm|js|css|map|ttf|woff2?)$).*)",
  ],
};
