/**
 * CORS utility — restricts cross-origin access to known domains.
 *
 * Production: Netlify site + Cloudflare Workers domain
 * Development: localhost
 */

const PRODUCTION_ORIGINS = [
  "https://filmsnap-pro.netlify.app",
  "https://filmsnaps1.anonymous260260a.workers.dev",
];

const DEVELOPMENT_ORIGINS = ["http://localhost:3000", "http://localhost:3001"];

// Electron desktop app uses app:// custom protocol.
// standard: true → Origin derived from URL host: "app://index.html"
const DESKTOP_ORIGINS = ["app://index.html", "app://"];

function getAllowedOrigins(): string[] {
  const base =
    process.env.NODE_ENV === "development"
      ? [...PRODUCTION_ORIGINS, ...DEVELOPMENT_ORIGINS]
      : PRODUCTION_ORIGINS;
  return [...base, ...DESKTOP_ORIGINS];
}

/**
 * Get CORS headers for a response.
 * @param requestOrigin - The Origin header from the request (optional)
 */
export function getCorsHeaders(
  requestOrigin?: string | null,
): Record<string, string> {
  const allowedOrigins = getAllowedOrigins();

  // Electron's app:// protocol doesn't send an Origin header at all.
  // When Origin is null, default to app://index.html (the desktop app)
  // instead of the first production origin.
  const origin = requestOrigin || "app://index.html";

  // Only reflect the origin if it's in our allowlist
  const allowedOrigin = allowedOrigins.includes(origin)
    ? origin
    : allowedOrigins[0];

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/**
 * Handle CORS preflight OPTIONS request.
 */
export function handleOptions(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get("origin")),
  });
}
