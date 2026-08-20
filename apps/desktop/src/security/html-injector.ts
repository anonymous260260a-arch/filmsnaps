/**
 * FilmSnaps Desktop — HTML-bytes cosmetic injection (V5 Gap A)
 *
 * The session-level preload (registerPreloadScript) injects a guard IIFE at
 * document-start. This layer injects engine-derived cosmetic CSS + scriptlets
 * at the HTML-bytes level, before first paint — exactly like mobile's
 * `getCosmeticSelectors(host)` → <style> before first paint. No IPC, no
 * timing window, no hostname ambiguity, and no fail-open path (V5 Gap A —
 * the primary fix).
 *
 * The payload is hostname-based only (no DOM tokens at the HTML-bytes level,
 * exactly like mobile's HTML-level injection). DOM-triggered rules are handled
 * separately by the in-page DOM sweeper → IPC → per-frame injection.
 *
 * Defense in depth (idempotent via the GUARD sentinel):
 *   - Preload (L5/L6) runs at document-start in frames the mechanism covers.
 *   - This layer injects cosmetics as part of the document's BYTES, so there
 *     is no IPC, no timing, no fail-open path.
 *   - The protection's own GUARD (Symbol.for('__filmsnaps_preload_guard'))
 *     makes the two idempotent: whichever runs first wins, the other no-ops.
 */

/* eslint-disable */

import { readFileSync } from "fs";
import { join } from "path";
import { getCosmeticFilterPayload } from "./filter-engine";

// ── Protection source (loaded once per module) ─────────────────────────────────────────

let _protectionSource: string | null = null;

// Primary path: compiled dist/security/../preload/provider-preload.js
// (from apps/desktop/src/security/ → join __dirname ".." → dist/preload/)
const PRIMARY_PRELOAD_PATH = join(
  __dirname,
  "..",
  "preload",
  "provider-preload.js",
);

// Fallback path: project root for dev workflows without prior build
const FALLBACK_PRELOAD_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "apps",
  "desktop",
  "dist",
  "preload",
  "provider-preload.js",
);

export function getProtectionSource(): string {
  if (_protectionSource !== null) return _protectionSource;

  // Try primary path first (compiled dist)
  try {
    _protectionSource = readFileSync(PRIMARY_PRELOAD_PATH, "utf8");
    console.log(
      `[HtmlInjector] Protection source loaded (${_protectionSource.length} chars)`,
    );
    return _protectionSource;
  } catch {
    // Primary not available — ignore and try fallback
  }

  // Try fallback path (dev without build, or different workspace layout)
  try {
    _protectionSource = readFileSync(FALLBACK_PRELOAD_PATH, "utf8");
    console.log(
      `[HtmlInjector] Protection source loaded from fallback (${_protectionSource.length} chars)`,
    );
    return _protectionSource;
  } catch (err) {
    console.error(
      "[HtmlInjector] Failed to load protection source from both paths:",
      err,
    );
    _protectionSource = "";
  }

  return _protectionSource;
}

// ── HTML-bytes-level cosmetic injection ──────────────────────────────────────────

/**
 * Inject engine-derived cosmetic CSS + scriptlets before </head> (falling back
 * to before </body>, then </html>, then a bare append). This mirrors mobile's
 * `getCosmeticSelectors(host)` → `<style>` before first paint — the CSS is part
 * of the document's BYTES, so there is no IPC, no timing window, no
 * hostname ambiguity, and no fail-open path (V5 Gap A — the primary fix).
 *
 * The payload is hostname-based only (no DOM tokens at the HTML-bytes level,
 * exactly like mobile's HTML-level injection). DOM-triggered rules are handled
 * separately by the in-page DOM sweeper → IPC → per-frame injection.
 */
export function injectCosmetics(
  html: string,
  payload: { styles: string; scripts: string[] },
): string {
  if (!payload.styles && (!payload.scripts || payload.scripts.length === 0)) {
    return html;
  }

  let frag = "";
  if (payload.styles) {
    frag += `<style data-filmsnaps-cosmetic="true">${payload.styles}</style>\n`;
  }
  if (payload.scripts && payload.scripts.length) {
    for (const s of payload.scripts) {
      frag += `<script data-filmsnaps-scriptlet="true">${s}</script>\n`;
    }
  }

  // Insert before </head>, then </body>, then </html>, else append.
  const headEnd = html.search(/<\/head>/i);
  if (headEnd !== -1) {
    return html.slice(0, headEnd) + frag + html.slice(headEnd);
  }
  const bodyEnd = html.search(/<\/body>/i);
  if (bodyEnd !== -1) {
    return html.slice(0, bodyEnd) + frag + html.slice(bodyEnd);
  }
  const htmlEnd = html.search(/<\/html>/i);
  if (htmlEnd !== -1) {
    return html.slice(0, htmlEnd) + frag + html.slice(htmlEnd);
  }
  return html + frag;
}
