/**
 * FilmSnaps Desktop — Provider Configuration Loader
 *
 * Loads blocklist.json (per-provider CDN domains, embed domains, profiles)
 * from the project root. This is a CJS-compatible replica of the ESM
 * @filmsnaps/adblock-config loader.
 *
 * blocklist.json structure (version 2):
 *   - allowedCdnHosts: global CDN allowlist
 *   - blockedDomains: always-blocked domains
 *   - providerProfiles: per-provider domain mappings
 *   - providerRootHosts: known provider embed/root hosts
 *   - rules.alwaysBlock: domains + path patterns
 *   - rules.videoDetection: extensions + path patterns for trust
 *   - providers[]: per-provider embed/cdn domains, enabled flags
 */

import { readFileSync, existsSync, watch } from "fs";
import { join, dirname, resolve } from "path";
import { app } from "electron";

// ── Types (mirrored from @filmsnaps/adblock-config) ─────────────────────────

export interface VideoDetectionConfig {
  extensions: string[];
  pathPatterns: string[];
  enableSessionTrust: boolean;
}

export interface AlwaysBlockConfig {
  domains: string[];
  pathPatterns: string[];
}

export interface ProviderConfig {
  id: string;
  embedDomains: string[];
  cdnDomains: string[];
  enabled: boolean;
  adblockDisabled?: boolean;
  /** Hosts the provider's video/player auth APIs run on (R3.5 API exemption). */
  apiDomains?: string[];
}

export interface BlocklistConfig {
  version: number;
  allowedCdnHosts: string[];
  blockedDomains: string[];
  providerProfiles?: Record<string, string[]>;
  providerRootHosts?: string[];
  rules?: {
    videoDetection?: VideoDetectionConfig;
    alwaysBlock?: AlwaysBlockConfig;
  };
  providers?: ProviderConfig[];
}

// ── Singleton state ─────────────────────────────────────────────────────────

let _config: BlocklistConfig | null = null;
let _configPath: string | null = null;

// ── Path resolution ─────────────────────────────────────────────────────────

/**
 * Walk up from a directory looking for blocklist.json.
 */
function findProjectRoot(dir: string): string | null {
  const candidate = resolve(dir);
  if (existsSync(join(candidate, "blocklist.json"))) return candidate;
  const parent = dirname(candidate);
  if (parent === candidate) return null;
  return findProjectRoot(parent);
}

/**
 * Resolve the path to blocklist.json.
 * Dev: walk up from dist/ to repo root
 * Prod: from process.resourcesPath (extraResources)
 */
function resolveConfigPath(): string {
  if ((app as any).isPackaged) {
    return join(process.resourcesPath, "blocklist.json");
  }

  // Dev: walk up from __dirname (dist/security/) to repo root
  let dir = dirname(__dirname);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "blocklist.json")))
      return join(dir, "blocklist.json");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Try cwd
  const root = findProjectRoot(process.cwd());
  if (root) return join(root, "blocklist.json");

  // Last resort: relative to package root
  const pkgRoot = findProjectRoot(join(__dirname, ".."));
  if (pkgRoot) return join(pkgRoot, "blocklist.json");

  return "";
}

// ── Loading ─────────────────────────────────────────────────────────────────

/**
 * Load and cache blocklist.json.
 * Returns null if not found.
 */
export function loadBlocklistConfig(): BlocklistConfig | null {
  if (_config) return _config;

  const path = resolveConfigPath();
  if (!path || !existsSync(path)) {
    console.warn("[ProviderConfig] blocklist.json not found at resolved paths");
    return null;
  }

  try {
    const raw = readFileSync(path, "utf-8");
    _config = JSON.parse(raw) as BlocklistConfig;
    _configPath = path;
    console.log(
      `[ProviderConfig] Loaded: ${path} (${_config.providers?.length || 0} providers, ` +
        `${_config.allowedCdnHosts?.length || 0} CDN hosts)`,
    );

    // Start watching for changes so edits take effect without restart
    startFileWatcher(path);

    return _config;
  } catch (err) {
    console.error("[ProviderConfig] Failed to parse blocklist.json:", err);
    return null;
  }
}

/**
 * Watch blocklist.json for changes and auto-reload.
 */
let watcherInitialized = false;
function startFileWatcher(path: string): void {
  if (watcherInitialized) return;
  watcherInitialized = true;

  try {
    watch(path, (eventType) => {
      if (eventType === "change") {
        console.log("[ProviderConfig] blocklist.json changed — reloading");
        reloadConfig();
      }
    });
  } catch (err) {
    console.warn("[ProviderConfig] Failed to watch blocklist.json:", err);
  }
}

/**
 * Get the config file path (for logging / debugging).
 */
export function getConfigPath(): string | null {
  return _configPath;
}

/**
 * Reload the config from disk (discard cached version).
 */
export function reloadConfig(): BlocklistConfig | null {
  _config = null;
  _configPath = null;
  return loadBlocklistConfig();
}

// ── Provider queries ────────────────────────────────────────────────────────

/**
 * Get the ProviderConfig for a given provider ID.
 * Returns null if the provider is not found or disabled.
 */
export function getProviderProfile(providerId: string): ProviderConfig | null {
  const config = loadBlocklistConfig();
  if (!config?.providers) return null;

  const profile = config.providers.find(
    (p) => p.id === providerId && p.enabled !== false,
  );
  return profile ?? null;
}

/**
 * Per-provider profile allowlist (mobile Rule 5 parity — rotation-proof).
 *
 * Mobile's PlayerWebViewOverlayView blocks any page-facing `script`/`iframe`/
 * `image` whose host is NOT in the provider's profile set. That set (keyed by
 * provider embed domain in blocklist.json `providerProfiles`, e.g.
 * "web.nxsha.app" -> ["web.nxsha.app","workers.dev","cloudfront.net"]) is the
 * rotation-proof mechanism that defeats rotating ad-orchestrator hostnames
 * (a blocklist can't — a brand-new hostname per impression clears it).
 *
 * Resolution order:
 *   1. `blocklist.json` `providerProfiles` matched by the provider's embed
 *      domain as the key (mobile-style keying), falling back to `providerId`
 *      as the key.
 *   2. No explicit map entry -> fall back to `embedDomains + cdnDomains` so
 *      every enabled provider still has *some* profile (an empty profile must
 *      however fail open, so callers gate on `size > 0`).
 * Returns a lowercased Set.
 */
export function getProviderProfileAllowlist(providerId: string): Set<string> {
  const profile = getProviderProfile(providerId);
  const config = loadBlocklistConfig();

  // 1) Explicit providerProfiles map (mobile Rule 5 ground truth), keyed by
  //    embed domain or provider id.
  const map = config?.providerProfiles;
  if (map) {
    const profileKey =
      (profile?.embedDomains ?? []).find((d) => map[d]) ?? providerId;
    const mapped = map[profileKey];
    if (mapped && mapped.length > 0) {
      return new Set(mapped.map((h) => h.toLowerCase()));
    }
  }

  // 2) Fall back to embedDomains + cdnDomains (every provider has *some*).
  const domains = new Set<string>();
  if (profile?.embedDomains) {
    for (const d of profile.embedDomains) domains.add(d.toLowerCase());
  }
  if (profile?.cdnDomains) {
    for (const d of profile.cdnDomains) domains.add(d.toLowerCase());
  }
  return domains;
}

/**
 * Is `hostname` the current provider's own API/embed host? Used by R3.5 so an
 * xhr/fetch to the provider's real API (video auth) is exempt from the profile
 * gate — matching mobile, where only script/iframe/image are profile-blocked
 * and provider API traffic is left to the filter engine. Suffix-matched so a
 * subdomain of the embed host counts.
 */
export function isProviderApiHost(
  hostname: string,
  providerId: string,
): boolean {
  const profile = getProviderProfile(providerId);
  if (!profile) return false;
  const lower = hostname.toLowerCase();
  const candidates = [
    ...(profile.embedDomains ?? []),
    ...(profile.apiDomains ?? []),
  ];
  for (const c of candidates) {
    const lc = c.toLowerCase();
    if (lower === lc) return true;
    if (lower.endsWith(`.${lc}`)) return true;
  }
  return false;
}

/**
 * Get all allowed domains (embed + CDN) for a provider.
 * Returns a Set for fast lookup.
 */
export function getAllowedDomainsForProvider(providerId: string): Set<string> {
  const profile = getProviderProfile(providerId);
  if (!profile) return new Set<string>();

  const domains = new Set<string>();

  // Embed domains
  if (profile.embedDomains) {
    for (const d of profile.embedDomains) {
      domains.add(d.toLowerCase());
    }
  }

  // CDN domains
  if (profile.cdnDomains) {
    for (const d of profile.cdnDomains) {
      domains.add(d.toLowerCase());
    }
  }

  // Provider-specific profiles from providerProfiles (v1 compat)
  const config = loadBlocklistConfig();
  if (config?.providerProfiles) {
    // Match providerProfiles key by checking if providerId's embed domain
    // is a key or if the key matches the provider embed domain
    for (const [key, hosts] of Object.entries(config.providerProfiles)) {
      if (key === providerId || profile.embedDomains.includes(key)) {
        for (const h of hosts) {
          domains.add(h.toLowerCase());
        }
      }
    }
  }

  // Runtime-augmented per-provider domains (e.g. embed URL host seeded at init).
  const extra = extraProviderDomains.get(providerId);
  if (extra) {
    for (const d of extra) domains.add(d);
  }

  return domains;
}

/**
 * Check if adblocking is disabled for a given provider.
 * Some providers (screenscape, cinemaos) have adblockDisabled: true
 * because their ad scripts double as video auth mechanisms.
 */
export function isAdblockDisabledForProvider(providerId: string): boolean {
  const profile = getProviderProfile(providerId);
  return profile?.adblockDisabled === true;
}

// ── Global allow/block lists ────────────────────────────────────────────────

/**
 * Runtime-augmented allowlists. The config getters (getGlobalCdnAllowlist /
 * getAllowedDomainsForProvider) read from cached blocklist.json; these sets hold
 * domains ADDED at runtime (e.g. the embed URL host or startup pre-seed) that
 * don't appear in the config file. Feeding R1/R2 here — NOT R0 trust — lets
 * config/embed-derived hosts reach R4/R5 so always-block domains are still
 * blocked, while the session trust manager (R0) stays empty until a host
 * actually serves verified video (V4 step 2 / V5).
 */
const extraGlobalCdnDomains = new Set<string>();
const extraProviderDomains = new Map<string, Set<string>>();

/** Register extra global CDN-allowlist domains (fed at runtime). */
export function addGlobalCdnAllowlistDomains(domains: Iterable<string>): void {
  for (const d of domains) {
    const lower = d.toLowerCase().trim();
    if (lower) extraGlobalCdnDomains.add(lower);
  }
}

/** Register extra per-provider allowed domains (fed at runtime). */
export function addProviderAllowlistDomains(
  providerId: string,
  domains: Iterable<string>,
): void {
  let set = extraProviderDomains.get(providerId);
  if (!set) {
    set = new Set<string>();
    extraProviderDomains.set(providerId, set);
  }
  for (const d of domains) {
    const lower = d.toLowerCase().trim();
    if (lower) set.add(lower);
  }
}

/** Clear all runtime-augmented allowlists (provider session teardown). */
export function clearRuntimeAllowlists(): void {
  extraGlobalCdnDomains.clear();
  extraProviderDomains.clear();
}

/**
 * Get the global CDN allowlist.
 */
export function getGlobalCdnAllowlist(): Set<string> {
  const config = loadBlocklistConfig();
  const set = new Set(
    (config?.allowedCdnHosts ?? []).map((h) => h.toLowerCase()),
  );
  for (const d of extraGlobalCdnDomains) set.add(d);
  return set;
}

/**
 * Get the global always-block domains.
 */
export function getAlwaysBlockDomains(): Set<string> {
  const config = loadBlocklistConfig();
  const domains = new Set<string>();

  // From rules.alwaysBlock.domains
  if (config?.rules?.alwaysBlock?.domains) {
    for (const d of config.rules.alwaysBlock.domains) {
      domains.add(d.toLowerCase());
    }
  }

  // Also include top-level blockedDomains (v1 compat)
  if (config?.blockedDomains) {
    for (const d of config.blockedDomains) {
      domains.add(d.toLowerCase());
    }
  }

  return domains;
}

/**
 * Get the always-block path patterns (as strings for substring matching).
 */
export function getAlwaysBlockPathPatterns(): string[] {
  const config = loadBlocklistConfig();
  return config?.rules?.alwaysBlock?.pathPatterns ?? [];
}

/**
 * Get video detection configuration.
 */
export function getVideoDetectionConfig(): VideoDetectionConfig | null {
  const config = loadBlocklistConfig();
  return config?.rules?.videoDetection ?? null;
}

/**
 * Get the list of known provider root hosts (for bootstrap trust).
 */
export function getProviderRootHosts(): Set<string> {
  const config = loadBlocklistConfig();
  return new Set((config?.providerRootHosts ?? []).map((h) => h.toLowerCase()));
}

/**
 * Check if a hostname is a known provider root host.
 */
export function isProviderRootHost(hostname: string): boolean {
  const roots = getProviderRootHosts();
  const lower = hostname.toLowerCase();
  return roots.has(lower);
}
