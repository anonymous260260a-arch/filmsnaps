/**
 * FilmSnaps Desktop — Build-time injection of the FULL MOBILE PROTECTION
 * BUNDLE + static cosmetic CSS into the provider preload.
 *
 * The provider preload runs under `sandbox: true`, so it has no filesystem
 * access — it cannot read a bundle or CSS file at runtime. This step bakes
 * both into the compiled `dist/preload/provider-preload.js` by replacing two
 * placeholders:
 *
 *   1. `/* __FS_MOBILE_BUNDLE__ *​/`   → the JSON-escaped output of
 *      buildAllScriptsWithScriptlets() from @filmsnaps/shared — the SAME
 *      15-layer guard + uBO-style scriptlets bundle the mobile app injects
 *      into every document (and which provably blocks all ads on the same
 *      providers). Replaces the ESM-only shared package (its dist output is
 *      what the web app uses at build time).
 *
 *   2. `/* __FS_COSMETIC_CSS__ *​/`    → the JSON-escaped STATIC cosmetic CSS
 *      (default + per-provider), folded in from the previous
 *      scripts/inject-preload-css.js so this one script owns both bake-ins.
 *
 * Engine-derived cosmetic filters are intentionally NOT baked here — they
 * depend on the live page URL/DOM and are fetched over IPC by the preload's
 * DOM sweeper (cosmetic:probe → getCosmeticFilterPayload).
 */

"use strict";

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, "..");

// ── Resolve the monorepo root (this file lives at apps/desktop/scripts/) ──
const monorepoRoot = join(appRoot, "..", "..");

// ── Locate the compiled preload ──
const preloadPath = join(appRoot, "dist", "preload", "provider-preload.js");
if (!existsSync(preloadPath)) {
  console.error(
    `[build-provider-preload] Could not find compiled preload at ${preloadPath}`,
  );
  process.exit(1);
}

let src = readFileSync(preloadPath, "utf8");

// ── 0. Read blocklist.json config (single source of truth) ─────────────────
const config = (() => {
  try {
    const configPath = join(monorepoRoot, "blocklist.json");
    if (!existsSync(configPath)) return {};
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    console.warn(
      `[build-provider-preload] blocklist.json not readable (${err.message}) — using defaults`,
    );
    return {};
  }
})();

const alwaysBlockDomains = (() => {
  const domains = config?.rules?.alwaysBlock?.domains;
  return Array.isArray(domains) && domains.length ? domains : undefined;
})();

// Per-provider API-state interception + cosmetic rules are flattened into the
// SINGLE generic desktop bundle. The webview loads one provider at a time, so a
// broad union is safe: each rule is scoped by URL substring ("match") or by
// selector, and no provider's unrelated flow is touched. Empty → no-op.
const apiIntercepts = (() => {
  const out = [];
  for (const p of config?.providers ?? []) {
    if (p?.enabled === false) continue;
    if (Array.isArray(p?.apiIntercepts)) {
      for (const r of p.apiIntercepts) {
        if (r && r.match && r.synthetic) out.push(r);
      }
    }
  }
  return out.length ? out : undefined;
})();

const cosmeticRules = (() => {
  const out = [];
  for (const p of config?.providers ?? []) {
    if (p?.enabled === false) continue;
    if (Array.isArray(p?.cosmeticRules)) {
      for (const c of p.cosmeticRules) {
        if (c && typeof c === "string") out.push(c);
      }
    }
  }
  return out.length ? out.join(" ") : "";
})();

// ── 1. Build the full mobile protection bundle ─────────────────────────────
// @filmsnaps/shared is ESM-only ("type": "module"), so we must dynamic-import
// it even from this .mjs script. The caller (pnpm build) already builds shared
// via build-web.mjs, so the dist output exists.
const { buildAllScriptsWithScriptlets } = await import(
  /* @vite-ignore */
  pathToFileURL(
    join(
      monorepoRoot,
      "packages",
      "shared",
      "dist",
      "security",
      "playerGuard.js",
    ),
  ).href,
);

// Same signature the mobile app uses: buildAllScriptsWithScriptlets(providerHostname, providerId, blockedDomains, apiIntercepts).
// Empty hostname + undefined providerId → generic bundle; alwaysBlockDomains
// feeds the guard's BLOCKED_DOMAINS patterns (falls back to the module's
// DEFAULT_AD_FULL/SHORT_PATTERNS when undefined, exactly matching mobile);
// apiIntercepts feeds the config-driven API state interception.
const bundle = buildAllScriptsWithScriptlets(
  "",
  undefined,
  alwaysBlockDomains,
  apiIntercepts,
);
const bundleEscaped = JSON.stringify(bundle);

// The compiled TS emits:  const __fsMobile = /* __FS_MOBILE_BUNDLE__ */ '';
// Quote-agnostic ('' or "") — same formatter rewrite hazard as the CSS
// placeholder, so match either.
const bundlePlaceholder = /\/\*\s*__FS_MOBILE_BUNDLE__\s*\*\/\s*(?:''|"")/;
if (!bundlePlaceholder.test(src)) {
  console.error(
    `[build-provider-preload] __FS_MOBILE_BUNDLE__ placeholder not found in ${preloadPath} — is the preload built?`,
  );
  process.exit(1);
}
src = src.replace(bundlePlaceholder, bundleEscaped);
console.log(
  `[build-provider-preload] Injected ${bundle.length} chars of mobile protection bundle`,
);

// ── 2. Static cosmetic CSS (folded from scripts/inject-preload-css.js) ─────
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

// ── Per-provider static cosmetic rules from blocklist.json ────────────────
// These are appended to the generic DEFAULT_COSMETIC_CSS so the badge/ad-state
// UI for a specific provider (e.g. screenscape's "Ads window ends" timer) is
// hidden at document-start. Selector-scoped — no provider's unrelated DOM is
// touched. Mirrors the mobile app's per-provider cosmetic config (the single
// source of truth is blocklist.json, not hardcoded selectors in code).
const FULL_COSMETIC_CSS = `${DEFAULT_COSMETIC_CSS}${cosmeticRules ? `\n/* FilmSnaps Desktop — Per-Provider Element Hiding (blocklist.json) */\n${cosmeticRules}` : ""}`.trim();

// The compiled TS emits:  const COSMETIC_CSS = /* __FS_COSMETIC_CSS__ */ '';
const cssPlaceholder = /\/\*\s*__FS_COSMETIC_CSS__\s*\*\/\s*(?:''|"")/;
if (!cssPlaceholder.test(src)) {
  console.error(
    `[build-provider-preload] __FS_COSMETIC_CSS__ placeholder not found in ${preloadPath}`,
  );
  process.exit(1);
}
const cssEscaped = JSON.stringify(FULL_COSMETIC_CSS);
src = src.replace(cssPlaceholder, cssEscaped);

writeFileSync(preloadPath, src, "utf8");
console.log(
  `[build-provider-preload] Injected ${FULL_COSMETIC_CSS.length} chars of static cosmetic CSS (${cosmeticRules.length} chars per-provider)`,
);
console.log(`[build-provider-preload] Wrote ${preloadPath}`);
