/**
 * CSP Builder — generates the Content-Security-Policy string for the
 * `<iframe csp="...">` attribute, enforced by the parent page on a
 * cross-origin iframe.
 *
 * This is a browser-level enforcement layer that works WITHOUT a proxy.
 * It blocks crypto miners (worker-src 'none'), tracking beacons
 * (restricted connect-src), and plugin-based ads (object-src 'none'),
 * while still allowing provider scripts and HTTPS video/images.
 */

import type { ProviderDefinition } from "@filmsnaps/shared";

/**
 * Build a Content-Security-Policy string for the `<iframe csp="...">`
 * attribute — enforced by the parent page on a cross-origin iframe.
 *
 * @param provider - Provider definition (uses allowedOrigins for connect-src)
 */
export function buildIframeCSP(provider: ProviderDefinition): string {
  const origins = new Set([
    ...(provider.allowedOrigins ?? []),
    ...extractOrigin(provider.baseUrl),
  ]);
  const originsStr = Array.from(origins).sort().join(" ");

  const parts: string[] = [];

  // Base lockdown — deny everything by default
  parts.push("default-src 'none'");

  // Scripts: providers need JS to render video players
  parts.push("script-src 'unsafe-inline' 'unsafe-eval'");

  // Workers: blocked — crypto miners and heavy ad scripts need workers
  parts.push("worker-src 'none'");

  // Network requests: restricted to self + known CDNs
  if (originsStr) {
    parts.push(`connect-src 'self' ${originsStr}`);
  } else {
    parts.push("connect-src 'self'");
  }

  // Video/audio: permissive over HTTPS (video chunks come from various CDNs)
  parts.push("media-src 'self' blob: https:");

  // Images: provider UI needs images
  parts.push("img-src 'self' data: https:");

  // Styles: providers need inline styles
  parts.push("style-src 'unsafe-inline'");

  // Fonts: allow self + data URIs
  parts.push("font-src 'self' data: https:");

  // Objects/flash: blocked
  parts.push("object-src 'none'");

  // Frames: restrict to none (prevents nested ad iframes)
  // But allow the provider's own frames if needed
  if (originsStr) {
    parts.push(`frame-src ${originsStr}`);
  } else {
    parts.push("frame-src 'none'");
  }

  return parts.join("; ");
}

/**
 * Extract the origin(s) from a base URL.
 * For example, "https://peachify.top/embed" → ["https://peachify.top"]
 * Handles malformed URLs gracefully (returns empty array).
 */
function extractOrigin(baseUrl: string): string[] {
  try {
    const url = new URL(baseUrl);
    return [url.origin];
  } catch {
    return [];
  }
}
