/**
 * FilmSnaps Desktop — Build-time injection of static cosmetic CSS into the
 * provider preload.
 *
 * The provider preload runs under `sandbox: true`, which means it has no
 * filesystem access — so it cannot read a CSS file at runtime. Instead we
 * embed the STATIC cosmetic rules (default + per-provider) into the compiled
 * `dist/preload/provider-preload.js` by replacing the
 * `/* __FS_COSMETIC_CSS__ *​/` placeholder with the JSON-escaped CSS string.
 *
 * Engine-derived cosmetic CSS is intentionally NOT included here — it depends
 * on the live page URL and the loaded filter engine, both of which are only
 * available in the main process. The static rules cover the vast majority of
 * ad containers; engine rules can be layered by the main-process CDP
 * verification layer if desired.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ── Build the static cosmetic CSS (mirrors cosmetic-css.ts) ──

const DEFAULT_COSMETIC_CSS = `
/* FilmSnaps Desktop — Default Element Hiding */
div[style*="position: fixed"][style*="z-index"]:not(:has(video)):not(:has(iframe[src*="player"])):not(:has(iframe[src*="embed"])),
section[style*="position: fixed"][style*="z-index"]:not(:has(video)):not(:has(iframe[src*="player"])),
aside[style*="position: fixed"][style*="z-index"]:not(:has(video)):not(:has(iframe[src*="player"])) {
  display: none !important;
}
div[class*="ad-container"],
div[class*="ad-wrapper"],
div[class*="ad-box"],
div[class*="ads-box"],
div[class*="banner-ad"],
div[class*="popup-ad"],
div[id*="ad-container"],
div[id*="ad-wrapper"],
div[id*="ad-box"],
div[id*="banner-ad"] {
  display: none !important;
}
div[style*="z-index: 999"],
div[style*="z-index:999"],
div[style*="z-index: 9999"],
div[style*="z-index:9999"],
div[style*="z-index: 99999"],
div[style*="z-index:99999"]:not(:has(video)) {
  display: none !important;
}
div[class*="popup"],
div[class*="modal"][style*="fixed"],
div[id*="popup"],
div[id*="modal"][style*="fixed"],
div[class*="interstitial"] {
  display: none !important;
}
/* uBO-style generic ad block patterns */
[id^="ad-container"], [class^="ad-overlay"],
[id*="popunder"], [class*="popunder"],
iframe[src*="doubleclick"], iframe[src*="adservice"],
div[id^="google_ads"], .adsbygoogle,
[data-ad-slot], .ad-banner, .ad-wrapper {
  display: none !important;
  visibility: hidden !important;
  height: 0 !important;
  width: 0 !important;
  position: absolute !important;
  left: -9999px !important;
}
`.trim();

// ── Locate the compiled preload ──

function resolveAppRoot() {
  // Running from apps/desktop (pnpm workspace) — find project root upward.
  let dir = __dirname;
  while (dir && !fs.existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir);
  return dir;
}

const appRoot = resolveAppRoot();
const preloadPath = path.join(appRoot, 'dist', 'preload', 'provider-preload.js');

if (!fs.existsSync(preloadPath)) {
  console.error(`[preload-css] Could not find compiled preload at ${preloadPath}`);
  process.exit(1);
}

let src = fs.readFileSync(preloadPath, 'utf8');
// The compiled TS emits:  const COSMETIC_CSS = /* __FS_COSMETIC_CSS__ */ '';
// Replace the placeholder AND the trailing empty-string literal together.
// Quote-agnostic ('' or "") — the formatter rewrote '' to "" during a commit
// hook and broke the single-quote-only match; match either.
const placeholder = /\/\*\s*__FS_COSMETIC_CSS__\s*\*\/\s*(?:''|"")/;

if (!placeholder.test(src)) {
  console.error(`[preload-css] Placeholder not found in ${preloadPath} — is the preload built?`);
  process.exit(1);
}

const escaped = JSON.stringify(DEFAULT_COSMETIC_CSS);
src = src.replace(placeholder, escaped);

fs.writeFileSync(preloadPath, src, 'utf8');
console.log(`[preload-css] Injected ${DEFAULT_COSMETIC_CSS.length} chars of cosmetic CSS into ${preloadPath}`);
