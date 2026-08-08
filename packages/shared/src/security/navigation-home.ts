/**
 * Provider home-page escape guard — path-level navigation containment.
 *
 * Provider embeds (e.g. `provider.com/embed/movie/1234`) render the provider's
 * own error UI when the server is down, and that UI sometimes includes a
 * "Go Home" button (or auto-redirect) that navigates the player frame to the
 * provider's HOME page (`provider.com/` — same host). The existing host-level
 * guards (mobile P0 session allowlist, desktop bootstrap whitelist) allow it
 * because the host doesn't change. This module keys on PATH SHAPE instead.
 *
 * This is a PURE FUNCTION — no React, no platform imports, no hardcoded
 * URLs/hostnames. Single source of truth = blocklist.json (navigationGuard +
 * per-provider blockHomePaths). Both platforms consume it:
 *   - Android native: ported to Kotlin in PlayerWebViewOverlayView.kt
 *   - Desktop main: CJS replica in navigation-guard.ts (shared is ESM,
 *     desktop main is CJS — same precedent as provider-config.ts)
 */

export interface NavigationGuardConfig {
  /** Paths blocked for EVERY provider with zero per-provider config (e.g. ["/"]). */
  universalBlockPaths: string[];
  /** Per-provider deny-list of home/list paths (additive — append as discovered). */
  blockHomePaths: string[];
  /**
   * Unused for enforcement (deny-list is primary). Reserved per expert verdict
   * for a future shallow-depth rule. Kept in the config contract for schema parity.
   */
  shallowDepthThreshold: number;
}

/**
 * Normalize a full URL to `pathname + search` (path lowercased, trailing slash
 * stripped). Query is part of the identity because query-only embeds
 * (screenscape: `?tmdb={id}&type=movie`) have a bare "/" path but a NON-EMPTY
 * query — that query is what separates an embed from the home page, which is
 * bare "/" with NO query. Comparing path ONLY makes home "/" path-identical to
 * the embed, so the HARD-ALLOW would let it through.
 */
function normalizeFullUrl(url: string): string {
  if (url.startsWith("/")) return normalizeFullUrl(`https://x.invalid${url}`);
  try {
    const u = new URL(url);
    let p = u.pathname || "/";
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    const q = u.search || "";
    return p.toLowerCase() + q;
  } catch {
    return "";
  }
}

/**
 * Normalize a path string to a trailing-slash-free form. Works on both raw
 * paths ("/movies") and full URLs ("https://provider.com/movies/").
 */
function normalizePath(raw: string): string {
  let p = raw;
  if (!p) return "";
  if (p.startsWith("http")) {
    try {
      p = new URL(p).pathname;
    } catch {
      return "";
    }
  }
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/**
 * True when a normalized full URL still carries a numeric media id (path or
 * query). An embed always identifies its title (`/embed/movie/1234` or
 * `?tmdb=1234`); a home/list page never does. Used to keep the HARD-ALLOW from
 * swallowing a bare-root home URL that happens to share the embed's path.
 */
function looksEmbedLike(normalizedFullUrl: string): boolean {
  if (!normalizedFullUrl) return false;
  return (
    /\/(?:movie|tv|embed|player|watch|tou|api)\/\d+(\/|$)/.test(
      normalizedFullUrl,
    ) || /(?:tmdb|video_id|id)=\d+/.test(normalizedFullUrl)
  );
}

/**
 * Universal bare-root escape — applies to every provider, zero per-provider
 * config. A home page is usually `/` (or a shallow list path under the
 * universal list). The bare root is blocked for all providers.
 */
export function isUniversalHomeEscape(
  targetPath: string,
  universalBlockPaths: string[],
): boolean {
  const t = normalizePath(targetPath);
  for (const bp of universalBlockPaths) {
    const b = normalizePath(bp);
    if (b === "") continue;
    if (t === b || t === b + "/") return true;
  }
  return false;
}

/**
 * Expert verdict §9.2 — the canonical home-escape decision.
 *
 * Rule order (deny-list primary, embed hard-allow, universal block,
 * per-provider block):
 *   1. HARD ALLOW — the target is the SAME embed (exact full URL), or a
 *      sub-route of the embed that still carries the media identity (path or
 *      query). A bare-root home URL has no media id, so it is NEVER hard-
 *      allowed — it falls through to the blocks below. This is the fix for
 *      query-only embeds (screenscape `?tmdb={id}`): the home "/" shares the
 *      embed's path but not its query/id, so it is blocked.
 *   2. UNIVERSAL BLOCK — target path === any universalBlockPaths entry
 *      (bare "/" root by default).
 *   3. PER-PROVIDER BLOCK — target path === any blockHomePaths entry.
 *   4. Otherwise allow.
 */
export function isHomeEscape(
  targetUrl: string,
  requestedEmbedUrl: string,
  cfg: NavigationGuardConfig,
): boolean {
  const targetFull = normalizeFullUrl(targetUrl);
  const embedFull = normalizeFullUrl(requestedEmbedUrl);
  const targetPath = normalizePath(targetUrl);
  const embedPath = normalizePath(requestedEmbedUrl);

  // HARD ALLOW — same embed, or a sub-route that keeps the media id.
  if (embedFull && targetFull === embedFull) return false;
  if (targetPath === embedPath && looksEmbedLike(targetFull)) return false;
  if (
    embedFull &&
    targetFull.startsWith(embedFull + "/") &&
    looksEmbedLike(targetFull)
  ) {
    return false;
  }

  // UNIVERSAL BLOCK — home/root paths for every provider.
  if (isUniversalHomeEscape(targetPath, cfg.universalBlockPaths)) return true;

  // PER-PROVIDER BLOCK — provider-specific home/list shapes.
  for (const bp of cfg.blockHomePaths) {
    const b = normalizePath(bp);
    if (b === "") continue;
    if (targetPath === b || targetPath === b + "/") return true;
  }

  return false;
}

/**
 * Numeric-id heuristic — the expert's "log-only" signal. A valid embed's
 * title URL always carries a numeric media id (in the path, e.g. `/movie/1234`,
 * or as `tmdb=`/`video_id=`/`id=` query). A home/list page does not. This is
 * informational (never an enforcement trigger) — used to log a possible escape
 * that the deny-list hasn't listed yet.
 */
export function looksHomeLikeWithoutId(
  targetUrl: string,
  requestedEmbedUrl: string,
): boolean {
  const embedHasNumericId =
    /\/(?:movie|tv|embed|player|watch|tou|api)\/\d+(\/|$)/.test(
      requestedEmbedUrl,
    ) || /(?:tmdb|video_id|id)=\d+/.test(requestedEmbedUrl);
  if (!embedHasNumericId) return false;

  try {
    const u = new URL(targetUrl);
    const hasNumericId =
      /\/(?:movie|tv|embed|player|watch|tou|api)\/\d+(\/|$)/.test(u.pathname) ||
      /(?:tmdb|video_id|id)=\d+/.test(u.search);
    return !hasNumericId;
  } catch {
    return false;
  }
}
