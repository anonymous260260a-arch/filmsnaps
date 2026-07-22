/**
 * Export filter patterns for Android native ad blocking.
 *
 * Loads the compiled @cliqz/adblocker FiltersEngine and extracts
 * network filter patterns (domains, URL substrings) into a compact
 * JSON file that Kotlin's AdblockEngine can load and match against
 * synchronously in shouldInterceptRequest.
 *
 * Run:  npx tsx src/export-android.ts
 *       (from packages/filter-compiler)
 *
 * Output: build/android-adblock-patterns.json (~1-2MB)
 * Copy to: apps/mobile/modules/player-webview/android/src/main/assets/
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FiltersEngine } from '@cliqz/adblocker';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildDir = join(__dirname, '..', 'build');
const enginePath = join(buildDir, 'compiled-engine.bin');

// ── Load engine ─────────────────────────────────────────────────────

if (!existsSync(enginePath)) {
  console.error('[ExportAndroid] Error: compiled-engine.bin not found.');
  console.error('[ExportAndroid] Run `pnpm compile` first.');
  process.exit(1);
}

console.log('[ExportAndroid] Loading compiled engine...');
const buffer = readFileSync(enginePath);
const engine = FiltersEngine.deserialize(new Uint8Array(buffer));
const { networkFilters, cosmeticFilters } = engine.getFilters();
console.log(`[ExportAndroid] Loaded: ${networkFilters.length} network, ${cosmeticFilters.length} cosmetic`);

// ── Extract patterns ────────────────────────────────────────────────

const blockedDomains = new Set<string>();
const blockedUrlSubstrings = new Set<string>();
const allowedDomains = new Set<string>();

// Path-anchored exception rules: @@||domain.com/path^
// These are more specific than $document exceptions — they allow a specific
// path on a domain while still blocking everything else on that domain.
// Without these, EasyList would block provider API endpoints that use
// standard tracking-like paths (e.g., /api/log, /beacon) which the
// provider actually needs for video auth/playback.
const allowedUrlPrefixes = new Set<string>();

// Regex triggers: substring-keyed map for deferred regex evaluation.
// Key = a constant literal substring extracted from the regex pattern.
// Value = the compiled regex patterns indexed under that key.
// During shouldInterceptRequest, the Kotlin engine only evaluates regexes
// whose key substring appears in the URL — avoiding a 28k-regex-per-request
// nightmare. This is the "trigger-based regex evaluation" strategy
// recommended by the expert.
const regexTriggers = new Map<string, Set<string>>();

// Per-domain cosmetics: maps "domain" -> array of CSS selectors
const cosmeticMap = new Map<string, Set<string>>();

// Counts for stats
let exceptionRules = 0;
let hostnameAnchored = 0;
let regexRules = 0;
let domainAllowRules = 0;

for (const filter of networkFilters) {
  const text = filter.toString();
  if (!text) continue;

  // Exception rules (@@...)
  if (text.startsWith('@@')) {
    exceptionRules++;

    // Strip $options suffix for path matching
    const clean = text.replace(/\$[^,]+(?:,[^,]+)*$/, '');

    // $document exceptions are domain allowlists
    if (text.includes('$document') || text.includes('$doc')) {
      domainAllowRules++;
      const m = clean.match(/^@@\|\|([^\/^]+)/);
      if (m) allowedDomains.add(m[1].toLowerCase());
    }

    // Path-anchored exceptions: @@||domain.com/path^
    // These allow a specific path while still blocking everything else on
    // that domain. Without these, EasyList would block provider API endpoints
    // (e.g., /api/log, /beacon) that the provider needs for video auth.
    // Reference: export-android Expert Review §5.2 Q5
    const pathMatch = clean.match(/^@@\|\|([^\/^]+\/)(.+)$/);
    if (pathMatch) {
      const domainPart = pathMatch[1].toLowerCase();
      const pathPart = pathMatch[2].replace(/\^$/, '').toLowerCase();
      allowedUrlPrefixes.add(`https://${domainPart}${pathPart}`);
      allowedUrlPrefixes.add(`http://${domainPart}${pathPart}`);
    } else {
      // Handle plain @@/path^ patterns (relative to current domain)
      const plainPath = clean.match(/^@@\/(.+)$/);
      if (plainPath) {
        allowedUrlPrefixes.add(`/${plainPath[1].replace(/\^$/, '')}`);
      }
    }
    continue;
  }

  // Domain-anchored: ||domain^ or ||domain/path^
  if (text.startsWith('||')) {
    hostnameAnchored++;
    // Extract hostname (everything between || and first / or ^ or $)
    const m = text.match(/^\|\|([^\/\^$:]+)/);
    if (m) {
      blockedDomains.add(m[1].toLowerCase());
    }
    continue;
  }

  // Left-anchored: |http://...
  if (text.startsWith('|')) {
    const m = text.match(/^\|https?:\/\/([^\/]+)/);
    if (m) {
      blockedDomains.add(m[1].toLowerCase());
    } else {
      // Just a URL prefix to match
      blockedUrlSubstrings.add(text.slice(1).toLowerCase());
    }
    continue;
  }

  // Regex patterns: /regex/flags
  // Strategy: Extract constant substring hints from the regex, then key the
  // full regex pattern under that hint. During matching, only evaluate regexes
  // whose hint appears in the URL — this avoids evaluating 28k regexes per
  // request (expert recommendation).
  // Reference: export-android Expert Review §5.2 Q4
  if (text.startsWith('/') && text.includes('/')) {
    regexRules++;
    // Find closing / (next / after the first char)
    const endSlash = text.indexOf('/', 1);
    if (endSlash === -1) continue;
    const pattern = text.slice(1, endSlash);
    // Extract a constant substring hint: sequences of non-regex-metachar
    // chars that are at least 4 chars long. These are likely to uniquely
    // identify the pattern without false positives.
    const hintMatch = pattern.match(/[a-zA-Z0-9._\/-]{4,}/);
    if (hintMatch) {
      const hint = hintMatch[0].toLowerCase();
      if (!regexTriggers.has(hint)) regexTriggers.set(hint, new Set());
      // Clean up options from the text if present
      const cleanOpts = text.replace(/\$[^,]+(?:,[^,]+)*$/, '');
      regexTriggers.get(hint)!.add(cleanOpts);
    }
    continue;
  }

  // Plain substring patterns (domain.com/path, /path, etc.)
  // These are URL substrings to check
  const clean = text.replace(/\$[^,]+(?:,[^,]+)*$/, '').trim();
  if (clean) {
    // Check if it starts with a domain pattern
    if (clean.includes('.') && !clean.startsWith('/')) {
      // Could be "domain.com" format — extract the domain
      const domainPart = clean.split('/')[0];
      if (domainPart.includes('.') && !domainPart.includes(' ')) {
        blockedDomains.add(domainPart.toLowerCase());
      }
    }
    // Still add the full pattern as substring if not too long
    if (clean.length > 3 && clean.length < 200) {
      blockedUrlSubstrings.add(clean.toLowerCase());
    }
  }
}

// ── Extract cosmetic selectors ──────────────────────────────────────

for (const filter of cosmeticFilters) {
  const text = filter.toString();
  if (!text) continue;

  // Format: "domain.com##.selector" or "domain.com,domain2.com##.selector"
  const m = text.match(/^([^#]+)##(.+)/);
  if (!m) continue;

  const domains = m[1].split(',').map(d => d.trim()).filter(Boolean);
  const selector = m[2].trim();
  if (!selector) continue;

  for (const domain of domains) {
    if (!cosmeticMap.has(domain)) {
      cosmeticMap.set(domain, new Set());
    }
    cosmeticMap.get(domain)!.add(selector);
  }
}

// ── Compact cosmetic selectors ──────────────────────────────────────

const cosmeticSelectors: Record<string, string[]> = {};
let totalCosmetic = 0;
for (const [domain, selectors] of cosmeticMap) {
  const arr = Array.from(selectors);
  if (arr.length > 0) {
    cosmeticSelectors[domain] = arr;
    totalCosmetic += arr.length;
  }
}

// ── Write output ────────────────────────────────────────────────────

const patterns = {
  version: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
  compiledAt: new Date().toISOString(),
  network: {
    blockedDomains: Array.from(blockedDomains).sort(),
    blockedUrlSubstrings: Array.from(blockedUrlSubstrings).sort(),
    allowedDomains: Array.from(allowedDomains).sort(),
    allowedUrlPrefixes: Array.from(allowedUrlPrefixes).sort(),
    regexTriggers: Object.fromEntries(
      Array.from(regexTriggers.entries())
        .map(([k, v]): [string, string[]] => [k, Array.from(v)])
        .sort((a, b) => a[0].localeCompare(b[0]))
    ),
  },
  cosmetic: cosmeticSelectors,
  stats: {
    totalNetworkFilters: networkFilters.length,
    totalCosmeticFilters: cosmeticFilters.length,
    extractedBlockedDomains: blockedDomains.size,
    extractedUrlSubstrings: blockedUrlSubstrings.size,
    extractedAllowedDomains: allowedDomains.size,
    extractedAllowedUrlPrefixes: allowedUrlPrefixes.size,
    extractedRegexTriggers: regexTriggers.size,
    extractedCosmeticDomains: Object.keys(cosmeticSelectors).length,
    extractedCosmeticSelectors: totalCosmetic,
    skippedExceptions: exceptionRules,
    skippedRegexes: regexRules,
  },
};

const outputPath = join(buildDir, 'android-adblock-patterns.json');
writeFileSync(outputPath, JSON.stringify(patterns));
const fileSizeKB = (Buffer.byteLength(JSON.stringify(patterns), 'utf-8') / 1024).toFixed(1);

console.log(`\n[ExportAndroid] Written: ${outputPath}`);
console.log(`[ExportAndroid] File size: ${fileSizeKB} KB`);
console.log(`[ExportAndroid] Stats:`);
console.log(`  Blocked domains:       ${blockedDomains.size}`);
console.log(`  URL substrings:        ${blockedUrlSubstrings.size}`);
console.log(`  Allowed domains:       ${allowedDomains.size}`);
console.log(`  Allowed URL prefixes:  ${allowedUrlPrefixes.size}`);
console.log(`  Regex triggers:        ${regexTriggers.size}`);
console.log(`  Cosmetic selectors:    ${totalCosmetic} (across ${Object.keys(cosmeticSelectors).length} domains)`);
console.log(`[ExportAndroid] Done.`);

// ── Copy to Android assets ──────────────────────────────────────────
const androidAssetsDir = join(
  __dirname, '..', '..', '..', 'apps', 'mobile',
  'modules', 'player-webview', 'android', 'src', 'main', 'assets'
);
if (!existsSync(androidAssetsDir)) {
  mkdirSync(androidAssetsDir, { recursive: true });
}
const androidOutputPath = join(androidAssetsDir, 'adblock-patterns.json');
writeFileSync(androidOutputPath, JSON.stringify(patterns));
console.log(`[ExportAndroid] Copied to Android assets: ${androidOutputPath}`);
