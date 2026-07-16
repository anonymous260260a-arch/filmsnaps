/**
 * Filter List Compiler — CLI entry point.
 *
 * Fetches EasyList, EasyPrivacy, AdGuard, and uBlock Origin filter lists,
 * merges with Filmsnaps' per-provider overrides and legacy AD_PATTERNS,
 * compiles them into an optimized engine via @cliqz/adblocker,
 * and writes the serialized result to build/compiled-engine.bin.
 *
 * Run:  node dist/compile.js   (from packages/filter-compiler)
 *
 * Designed to run in CI (daily) or as a pre-commit hook.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FiltersEngine } from '@cliqz/adblocker';
import { loadAllOverrides, overridesToFilterRules, legacyAdPatternsToFilterRules } from './overrides/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Filter list URLs ──────────────────────────────────────────────
const FILTER_LISTS = [
  // EasyList — primary ad blocking
  'https://easylist.to/easylist/easylist.txt',
  // EasyPrivacy — tracking protection
  'https://easylist.to/easylist/easyprivacy.txt',
  // AdGuard Base — supplements EasyList
  'https://filters.adtidy.org/extension/ublock/filters/2_optimized.txt',
  // uBlock Unbreak — reduces false positives
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt',
  // uBlock Badware — blocks malware-hosting domains
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt',
];

// ── Cosmetic-only filters (for elements that need CSS hiding) ──────
const COSMETIC_FILTERS = [
  '! Filmsnaps custom cosmetic filters',
  '##div[class*="ad-container"]',
  '##div[class*="banner-ad"]',
  '##div[class*="popup-overlay"]',
  '##div[id*="ad-overlay"]',
  '##div[id*="popup-ad"]',
  '##div[style*="z-index: 9999"]:has(> a[target="_blank"])',
  '##div[style*="position: fixed"][style*="z-index"]:not(:has(video)):not(:has(iframe[src*="player"]))',
  '##a[target="_blank"][style*="display: none"]',
];

/**
 * Fetch a single URL with timeout and retry.
 */
async function fetchWithRetry(url: string, retries = 2): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const text = await res.text();
      if (attempt > 0) console.log(`  [retry ${attempt}] OK`);
      return text;
    } catch (err: any) {
      if (attempt < retries) {
        console.log(`  [retry ${attempt + 1}] ${err.message}`);
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        console.warn(`  [FAILED] ${url}: ${err.message}`);
        return ''; // return empty rather than crashing
      }
    }
  }
  return '';
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log('[FilterCompiler] Starting compilation...');
  console.log(`[FilterCompiler] Filter lists: ${FILTER_LISTS.length}`);

  // 1. Fetch all remote filter lists sequentially (avoids Node 24 undici assertion bug)
  console.log('[FilterCompiler] Fetching filter lists...');
  const fetchedContents: string[] = [];
  for (const url of FILTER_LISTS) {
    console.log(`  Fetching: ${url.split('/').pop()}`);
    const content = await fetchWithRetry(url);
    fetchedContents.push(content);
  }

  const fetchedCount = fetchedContents.filter((c) => c.length > 0).length;
  console.log(`[FilterCompiler] Fetched ${fetchedCount}/${FILTER_LISTS.length} lists`);

  // 2. Generate local override rules
  const overrides = loadAllOverrides();
  console.log(`[FilterCompiler] Loaded ${overrides.length} provider overrides`);

  const overrideRules = overridesToFilterRules(overrides);
  const legacyRules = legacyAdPatternsToFilterRules();
  const cosmeticRules = COSMETIC_FILTERS.join('\n');

  // 3. Combine ALL filter text into one big string
  const combinedFilters = [
    ...fetchedContents,
    overrideRules,
    legacyRules,
    cosmeticRules,
  ].join('\n\n');

  // 4. Parse everything with FiltersEngine.parse()
  //    (fromLists() expects only URLs, not raw filter text)
  console.log('[FilterCompiler] Compiling filter engine...');

  const engine = FiltersEngine.parse(combinedFilters, {
    enableMutationObserver: false,
    enableCompression: true,
    loadCosmeticFilters: true,
    enableHtmlFiltering: false,
    enableOptimizations: true,
  });

  // 5. Serialize the engine
  const serialized = engine.serialize();
  const serializedBuffer = Buffer.from(serialized);

  // 6. Write output files
  const buildDir = join(__dirname, '..', 'build');
  if (!existsSync(buildDir)) {
    mkdirSync(buildDir, { recursive: true });
  }

  // Write serialized engine (binary)
  const enginePath = join(buildDir, 'compiled-engine.bin');
  writeFileSync(enginePath, serializedBuffer);
  console.log(`[FilterCompiler] Written: ${enginePath} (${(serializedBuffer.length / 1024).toFixed(1)} KB)`);

  // Write a JSON metadata file
  const metaPath = join(buildDir, 'compiled-filters.json');
  const filters = engine.getFilters();
  const meta = {
    version: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    compiledAt: new Date().toISOString(),
    engineSizeBytes: serializedBuffer.length,
    engineSizeKB: (serializedBuffer.length / 1024).toFixed(1),
    filterLists: FILTER_LISTS,
    providerOverrides: overrides.length,
    totalNetworkFilters: filters.networkFilters.length,
    totalCosmeticFilters: filters.cosmeticFilters.length,
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  console.log(`[FilterCompiler] Written: ${metaPath}`);
  console.log(`[FilterCompiler] Stats: ${meta.totalNetworkFilters} network filters, ${meta.totalCosmeticFilters} cosmetic filters`);
  console.log('[FilterCompiler] Compilation complete.');
}

main().catch((err) => {
  console.error('[FilterCompiler] Fatal error:', err);
  process.exit(1);
});
