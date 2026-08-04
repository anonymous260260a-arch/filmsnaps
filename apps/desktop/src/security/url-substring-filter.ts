/**
 * FilmSnaps Desktop — Mobile-Parity URL-Substring Blocklist (R5b)
 *
 * Mirrors mobile's `AdblockEngine.kt` (`shouldBlock` step 3: Aho-Corasick
 * whole-URL substring trie) so the desktop provider <webview> blocks the SAME
 * ad/tracker traffic the Android WebView blocks — including rotating ad
 * orchestrator hostnames that @cliqz/adblocker (R4) misses because their
 * brand-new random subdomain prefixes aren't yet in the compiled lists.
 *
 * WHY SUBSTRING MATCHING (and not the R4 engine alone):
 *   Mobile's ground-truth mechanism (PlayerWebViewOverlayView + AdblockEngine)
 *   keeps a ~1098-entry `blockedUrlSubstrings` set extracted from the LIVE
 *   EasyList/EasyPrivacy/AdGuard/AdBlock filters (packages/filter-compiler/src/
 *   export-android.ts → android-adblock-patterns.json). It matches the WHOLE
 *   request URL against these substrings. The random subdomain prefix rotates
 *   every impression, but distinctive path/query/fragment tokens (e.g. `http`,
 *   `.m3u8`, `.ads/`, encoded payload fragments) stay constant — so substring
 *   matching catches them regardless of the rotating hostname.
 *
 *   Importantly this matches mobile's ORDER: after the domain allowlist clears,
 *   ANY https request whose URL contains a blocked substring is blocked, even
 *   when the specific rotator host is unknown. Video CDNs never reach this rule
 *   because they are allowlisted (R1/R2) or earn path-scoped R0 trust FIRST.
 *   An aggressive `http` literal desugars to "block every https request to a
 *   host that cleared no allowlist" — which is exactly the mobile behavior and
 *   exactly what desktop lacks today (its R4 engine is context-scoped and lets
 *   unknown hosts fall through to R8 default-allow).
 *
 * SAME SOURCE OF TRUTH AS MOBILE:
 *   Loads `android-adblock-patterns.json` — the file export-android.ts writes
 *   into BOTH packages/filter-compiler/build/ and the mobile assets dir. Desktop
 *   reads the same generated file, so patterns never diverge between platforms.
 *
 * WHY THIS DOESN'T BREAK VIDEO (replaces the earlier `http` risk):
 *   The generated asset is polluted with (a) universal length-4 substring
 *   tokens (`http`, `.css`, `.gif`, `.php`) that match EVERY https URL, and
 *   (b) bare-TLD / filter-trash entries in blockedDomains (the literal `com`,
 *   `$script,3p,domain=<hashed>,badfilter`, …) that turn a suffix domain walk
 *   into "block every host" (any hostname reduces down to its bare TLD).
 *   Mobile survives both because its native player bypasses the filter for
 *   actual stream bytes. Desktop has NO native-player bypass — onBeforeRequest
 *   sees every HLS/DASH byte — so the integration must harden the data:
 *     - blockedDomains keeps only REAL registrable hosts (isRealHost drops
 *       bare TLDs + filter trivia), so a video CDN no longer collapses to `com`.
 *     - substrings dropped if degenerate (`UNIVERSAL_SUBSTRINGS` / too short).
 *     - substring matching runs against pathname+search only, so even a stray
 *       generic token can never fire on the `https://` scheme/authority.
 *   Real ad-path fragments (`ads.`, `-468x60.`, `://ad1.`, …) and genuine
 *   blocked ad domains are preserved, so the rotating-orchestrator backstop
 *   still works — now without collapsing every CDN.
 *
 * SOURCE SELECTION:
 *   - Dev / packaged: resolve the SAME compiled-filter asset the R4 engine
 *     reads (compiled-engine.bin's sibling), i.e. the file export-android.ts
 *     produces in the monorepo build dir; packaged via extraResources.
 *   - At runtime the module reads the whole JSON once and builds Sets + a
 *     single linear scan of the substring list (≤1100 entries). A full
 *     Aho-Corasick trie is unnecessary at this size; keep it a simple scan to
 *     match mobile's O(L) intent without the trie overhead.
 *   - Fail-open: if the file is missing/unreadable, this layer no-ops (returns
 *     no match) and blocking falls back to R4/R5-R8. It must never break
 *     playback because the asset isn't shipped.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { app } from "electron";

// ── Types ───────────────────────────────────────────────────────────────────

export interface UrlSubstringDecision {
  blocked: boolean;
  matchedSubstring?: string;
  matchedDomain?: string;
}

let _substrings: string[] | null = null;
let _blockedDomains: Set<string> | null = null;
let _allowedDomains: Set<string> | null = null;

/**
 * Warm the substring filter off the startup critical path. Loading is lazy on
 * first use (decideUrlSubstringBlock), but this pre-loads it so the first
 * provider request never blocks on a synchronous file read. Safe to call
 * multiple times (idempotent — loads once).
 */
export function initUrlSubstringFilter(): void {
  ensureLoaded();
}

/**
 * Resolve the path to android-adblock-patterns.json.
 *  - Dev: walk up from __dirname (dist/security/) to the monorepo root, into
 *    packages/filter-compiler/build/android-adblock-patterns.json (the file
 *    export-android.ts writes).
 *  - Packaged: read it from process.resourcesPath/filter-engine/
 *    (electron-builder extraResources — same dir as compiled-engine.bin).
 */
function isPackaged(): boolean {
  try {
    return !!(app as any)?.isPackaged;
  } catch {
    return false;
  }
}

function resolveSubstringAssetPath(): string {
  if (isPackaged()) {
    // extraResources copies filter-engine assets to resourcesPath/filter-engine/.
    // electron-builder.yml maps android-adblock-patterns.json → filter-engine/.
    return join(
      process.resourcesPath,
      "filter-engine",
      "android-adblock-patterns.json",
    );
  }
  const repoRoot = resolveRepoRoot();
  return join(
    repoRoot,
    "packages",
    "filter-compiler",
    "build",
    "android-adblock-patterns.json",
  );
}

function resolveRepoRoot(): string {
  let dir = dirname(__dirname); // dist/ → apps/desktop
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** Load (once) the substring/domain sets from the mobile-parity asset. */
function ensureLoaded(): void {
  // Idempotent: only parse the asset on the FIRST call. onBeforeRequest hits
  // this per-subrequest, and re-reading/re-parsing the ~108KB JSON + rebuilding
  // the 10k-entry set every time would stall playback. Subsequent calls return
  // the already-built sets (empty sets still count as loaded — do not re-read).
  if (_substrings !== null || _blockedDomains !== null) return;

  let path = resolveSubstringAssetPath();
  let json: any = null;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    // Multiple resolution attempts before giving up (e.g. monorepo layout
    // differs in some packaging modes).
    for (const alt of [resolveAltAssetCandidates()]) {
      if (!alt) continue;
      try {
        json = JSON.parse(readFileSync(alt, "utf8"));
        path = alt;
        break;
      } catch {
        /* try next */
      }
    }
  }
  const net = json?.network;
  if (json && net) {
    const subs = Array.isArray(net.blockedUrlSubstrings)
      ? net.blockedUrlSubstrings
      : [];
    const allowDoms = toSet(net.allowedDomains);
    // Real-host filter: only honor blockedDomains entries that are genuine
    // registrable domains (contain a dot, no adblock syntax/trash). The generated
    // set is polluted with bare-TLD noise (the literal `com`) and filter
    // directives (`$script,3p,domain=<hashed>,badfilter`), which would otherwise
    // turn a suffix walk into "block EVERY host" (any hostname walks down to
    // its bare TLD). Rejecting non real hosts is the desktop analog of mobile's
    // layout — mobile survives only because its native player bypasses the
    // filter for actual stream bytes; desktop's onBeforeRequest sees them.
    const blockDoms = toSet((net.blockedDomains ?? []).filter(isRealDomain));
    // Drop universal/garbage URL substrings. The set contains length-4
    // catch-all tokens (`http`, `css`, `gif`, `php`) that match EVERY
    // https URL — they exist only so a hostname-based search matches
    // "everything"; on mobile they're neutralized by the native-player bypass
    // that desktop lacks. Requiring a real, non-universal length avoids
    // carpet-bombing every stream/CDN request while keeping every genuine
    // ad-path fragment (e.g. `ads.`, `-468x60.`).
    const realSubs = subs.filter((s: unknown) => !isDegenerateSubstring(s));
    _substrings = realSubs;
    _blockedDomains = blockDoms;
    _allowedDomains = allowDoms;
    console.log(
      `[UrlSubstring] Loaded mobile-parity patterns from ${path}: ` +
        `${realSubs.length} URL substrings (${subs.length - realSubs.length} degenerate dropped), ` +
        `${blockDoms.size} blocked domains (${net.blockedDomains.length - blockDoms.size} trash dropped), ` +
        `${allowDoms.size} allowed domains`,
    );
  } else {
    _substrings = [];
    _blockedDomains = new Set();
    _allowedDomains = new Set();
    console.warn(
      "[UrlSubstring] android-adblock-patterns.json missing/invalid — substring layer disabled (R4/R5-R8 still active).",
    );
  }
}

/**
 * Is a blockedDomains entry a real registrable domain (suffix-matchable)?
 *
 * Rejects bare labels (TLD noise like `com`, single tokens) and ad-filter
 * directives / trash — but NO LONGER rejects entries whose subdomain prefix is
 * numeric. Rotating ad-orchestrator registrables like `cosedcost.com` /
 * `gringosauctors.cyou` ship in the shared asset with their committed suffix,
 * and their access hosts carry numeric subdomain prefixes (`ph.cosedcost.com`,
 * `gutty.gringosauctors.cyou`). Rejecting `\d{2,}` registrables screened those
 * legitimately-blocked domains OUT of the set, which is exactly why desktop's
 * R5b allowed them while mobile (which keeps the raw set) blocked them. The
 * suffix walk can still match the committed suffix regardless of the numeric
 * prefix, so dropping the digit-rejection is safe: the domain still needs a
 * dot and real letters to survive.
 */
function isRealDomain(entry: unknown): boolean {
  if (typeof entry !== "string") return false;
  const h = entry.toLowerCase();
  if (!h.includes(".")) return false; // bare label / bare TLD
  // Harden against ad-filter syntax / likely host junk (braces, angle brackets,
  // `$` directives, `@`, `=` from `domain=<hashed>` entries, etc.).
  if (/[$,<>@\\*&:;!?{}()'"]/.test(h)) return false;
  return true;
}

/**
 * Reject degenerate substrings that match essentially every URL and thus
 * would wipe real media. Kept extremely conservative: only drops the handful
 * of known universal tokens; everything else (even short real ad frags) stays.
 */
// Universal length-4 tokens present in the generated set that match essentially
// EVERY URL. They exist so a hostname-based search "matches everything" — on
// mobile they are neutralized by the native-player bypass; desktop has no such
// bypass (onBeforeRequest sees every stream byte), so they must not be used as
// real ad signals. `.css/.gif/.php` are content/extension-neutrals that could
// appear in any URL; `http` is in every https URL.
const UNIVERSAL_SUBSTRINGS = new Set(["http", ".css", ".gif", ".php"]);

function isDegenerateSubstring(s: unknown): boolean {
  if (typeof s !== "string") return true;
  const t = s.trim().toLowerCase();
  if (t.length < 4) return true;
  if (t.length === 4 && UNIVERSAL_SUBSTRINGS.has(t)) return true;
  // Pure scheme/host separators that match any URL.
  if (t.length <= 8 && /^(https?:)?(\/\/+|:\/\/|\/\/)/i.test(t)) return true;
  return false;
}

function toSet(arr?: string[]): Set<string> {
  if (!Array.isArray(arr)) return new Set<string>();
  return new Set(arr.map((s) => String(s).toLowerCase()));
}

function resolveAltAssetCandidates(): string | null {
  // In packaged builds the mobile asset may be placed directly under
  // resourcesPath/filter-engine/ (not the android/ subdir). Try that too.
  if (isPackaged()) {
    return join(
      process.resourcesPath,
      "filter-engine",
      "android-adblock-patterns.json",
    );
  }
  return null;
}

/** Domain suffix match — mobile AdblockEngine.checkDomainSuffix behavior. */
function checkDomainSuffix(host: string, set: Set<string> | null): boolean {
  if (!host || !set || set.size === 0) return false;
  let h = host.toLowerCase();
  while (h) {
    if (set.has(h)) return true;
    const dot = h.indexOf(".");
    if (dot < 0) break;
    h = h.slice(dot + 1);
  }
  return false;
}

/**
 * Decide whether a request should be blocked by the mobile-parity substring
 * rule. Mirrors mobile's AdblockEngine.shouldBlock ORDER:
 *   1. allowed domain → ALLOW (fast exit — never block allowlisted host)
 *   2. blocked domain → BLOCK
 *   3. whole-URL substring match → BLOCK
 *   4. no match → ALLOW (let R1-R8 decide)
 *
 * @param url  Full request URL (as seen by onBeforeRequest)
 * @param host Optional pre-parsed hostname (else parsed here)
 */
export function decideUrlSubstringBlock(
  url: string,
  host?: string,
): UrlSubstringDecision {
  ensureLoaded();
  const substrings = _substrings ?? [];
  if (
    substrings.length === 0 &&
    (!_blockedDomains || _blockedDomains.size === 0)
  ) {
    return { blocked: false };
  }

  let hostname = host;
  if (!hostname) {
    try {
      hostname = new URL(url).hostname;
    } catch {
      return { blocked: false }; // unparseable — don't substring-match
    }
  }

  // 1) allowed domain fast-exit
  if (checkDomainSuffix(hostname, _allowedDomains)) {
    return { blocked: false };
  }
  // 2) blocked domain
  if (checkDomainSuffix(hostname, _blockedDomains)) {
    return { blocked: true, matchedDomain: hostname };
  }
  // 3) PATH+QUERY-only substring match.
  //
  // We match against the URL's pathname + search (NOT the scheme/authority) so
  // that an undropped universal token could never fire on the `https://` prefix
  // — the exact vector that wiped every stream. Mobile's substring trie is
  // effectively an ad-PATH detector; matching the path keeps that intent while
  // never carpet-bombing every CDN just because it uses https.
  let pathAndQuery = url;
  try {
    const u = new URL(url);
    pathAndQuery = u.pathname + u.search;
  } catch {
    pathAndQuery = url;
  }
  const lower = pathAndQuery.toLowerCase();
  for (let i = 0; i < substrings.length; i++) {
    const s = substrings[i];
    // Skip empty / whitespace substrings
    if (!s) continue;
    if (lower.includes(s)) {
      return { blocked: true, matchedSubstring: s };
    }
  }
  return { blocked: false };
}

/** Exposed for tests / diagnostics. */
export function getSubstringFilterStats(): {
  substringCount: number;
  blockedDomainCount: number;
  allowedDomainCount: number;
} {
  ensureLoaded();
  return {
    substringCount: _substrings?.length ?? 0,
    blockedDomainCount: _blockedDomains?.size ?? 0,
    allowedDomainCount: _allowedDomains?.size ?? 0,
  };
}
