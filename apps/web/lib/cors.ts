/**
 * CORS utility — restricts cross-origin access to known domains.
 *
 * Production: filmsnaps.com + Cloudflare Workers domain
 * Development: localhost
 */

const PRODUCTION_ORIGINS = [
  'https://filmsnaps.com',
  'https://filmsnap-pro.netlify.app',
  'https://filmsnaps1.anonymous260260a.workers.dev',
];

const DEVELOPMENT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
];

function getAllowedOrigins(): string[] {
  if (process.env.NODE_ENV === 'development') {
    return [...PRODUCTION_ORIGINS, ...DEVELOPMENT_ORIGINS];
  }
  return PRODUCTION_ORIGINS;
}

/**
 * Get CORS headers for a response.
 * @param requestOrigin - The Origin header from the request (optional)
 */
export function getCorsHeaders(requestOrigin?: string | null): Record<string, string> {
  const allowedOrigins = getAllowedOrigins();
  const origin = requestOrigin || allowedOrigins[0];

  // Only reflect the origin if it's in our allowlist
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * Handle CORS preflight OPTIONS request.
 */
export function handleOptions(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request.headers.get('origin')),
  });
}
