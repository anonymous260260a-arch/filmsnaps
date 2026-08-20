/**
 * Regenerate adblock-trie.bin from the current build/android-adblock-patterns.json.
 *
 * The Kotlin AdblockEngine tries the binary trie FIRST (Fix 4), so whenever the
 * JSON engine data changes (e.g. the regexTriggers sanitization in export-android),
 * the binary must be regenerated too — otherwise the stale binary (with old/degenerate
 * regexes) shadows the fixed JSON.
 *
 * Run:  npx tsx scripts/gen-binary-trie.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeBinaryTrie } from "../src/binary-trie";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..", "..");
const jsonPath = join(
  __dirname,
  "..",
  "build",
  "android-adblock-patterns.json",
);
const buildBin = join(__dirname, "..", "build", "adblock-trie.bin");
const assetBin = join(
  root,
  "apps",
  "mobile",
  "modules",
  "player-webview",
  "android",
  "src",
  "main",
  "assets",
  "adblock-trie.bin",
);

const src = JSON.parse(readFileSync(jsonPath, "utf8"));
const net = src.network;
const blockedDomains = new Set<string>(net.blockedDomains);
const allowedDomains = new Set<string>(net.allowedDomains);
const allowedUrlPrefixes = new Set<string>(net.allowedUrlPrefixes);
const blockedUrlSubstrings = new Set<string>(net.blockedUrlSubstrings);
const regexTriggers = new Map<string, Set<string>>();
let degenerate = 0;
for (const [k, v] of Object.entries<any>(net.regexTriggers)) {
  const clean = (v as string[]).filter((r) => {
    let ok = false;
    try {
      ok = !new RegExp(r).test("");
    } catch {
      ok = false;
    }
    if (!ok) degenerate++;
    return ok;
  });
  if (clean.length) regexTriggers.set(k, new Set<string>(clean));
}
const cosmeticSelectors = src.cosmetic as Record<string, string[]>;

const bin = writeBinaryTrie(
  blockedDomains,
  allowedDomains,
  allowedUrlPrefixes,
  blockedUrlSubstrings,
  regexTriggers,
  cosmeticSelectors,
);

writeFileSync(buildBin, bin);
console.log(
  `[gen-binary-trie] Wrote ${buildBin} (${(bin.length / 1024).toFixed(1)} KB)`,
);
console.log(
  `[gen-binary-trie] Dropped ${degenerate} degenerate regexes from binary`,
);

if (existsSync(dirname(assetBin))) {
  writeFileSync(assetBin, bin);
  console.log(`[gen-binary-trie] Copied to asset: ${assetBin}`);
} else {
  console.warn(
    `[gen-binary-trie] Asset dir missing, skipped copy: ${dirname(assetBin)}`,
  );
}
