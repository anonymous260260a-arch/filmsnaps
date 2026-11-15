/**
 * Edge middleware — two jobs:
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
 * 2. Basic Auth for /admin and /api/telemetry/dashboard — the same model the
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

  // ── 1. Deep-link redirect (no auth involved) ──
  const deepLink = pathname.match(/^\/(movie|tv)\/([^/]+)$/);
  if (deepLink) {
    return NextResponse.redirect(
      new URL(`/${deepLink[1]}?id=${encodeURIComponent(deepLink[2])}`, req.url),
    );
  }

  // ── 2. Admin auth — scoped to admin paths only (the matcher also catches
  // /movie and /tv prefixes for the redirect above) ──
  const isAdminPath =
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/telemetry/dashboard";
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
  matcher: [
    "/admin",
    "/admin/:path*",
    "/api/telemetry/dashboard",
    "/movie/:path*",
    "/tv/:path*",
  ],
};
