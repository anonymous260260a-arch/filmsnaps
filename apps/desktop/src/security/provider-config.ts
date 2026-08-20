/**
 * FilmSnaps Desktop — Provider Configuration Loader
 *
 * Loads the v5 split config (providers.json + filters.txt) with Ed25519
 * signature verification. providers.json carries per-provider CDN domains,
 * embed domains, profiles, navigation guard, video detection. filters.txt
 * carries the uBO/EasyList engine rules. The two travel together and are
 * signed by the same Ed25519 key (providers.json.sig).
 *
 * For backward compatibility during the desktop-first rollout, blocklist.json
 * (v4) is still resolved when providers.json is absent.
 *
 * providers.json structure (version 5):
 *   - allowedCdnHosts: global CDN allowlist (v1 compat — v5 uses filters.txt)
 *   - blockedDomains: always-blocked domains (v1 compat)
 *   - providerProfiles: per-provider domain mappings
 *   - providerRootHosts: known provider embed/root hosts
 *   - rules.alwaysBlock: domains + path patterns (v1/v2 compat)
 *   - rules.videoDetection: extensions + path patterns for trust (+ trustTTLMs)
 *   - providers[]: per-provider embed/cdn domains, enabled flags,
 *                  allowServerRedirects, blockHomePaths, apiIntercepts
 *   - navigationGuard: universal block paths
 *   - signature / publicKey: Ed25519 OTA integrity
 */

import { readFileSync, existsSync, watch } from "fs";
import { join, dirname, resolve } from "path";
import { app } from "electron";
import { verify as cryptoVerify } from "crypto";

// ── Types (mirrored from @filmsnaps/adblock-config) ─────────────────────────

export interface VideoDetectionConfig {
  extensions: string[];
  pathPatterns: string[];
  enableSessionTrust: boolean;
  /** V5: sliding trust TTL in ms (default 900000 = 15 min). */
  trustTTLMs?: number;
}

export interface AlwaysBlockConfig {
  domains: string[];
  pathPatterns: string[];
}

export interface ApiInterceptRule {
  match: string;
  methods?: string[];
  synthetic?: {
    primary?: Record<string, unknown>;
    fallback?: Record<string, unknown>;
    fallbackCondition?: string;
  };
}

export interface ProviderConfig {
  id: string;
  embedDomains: string[];
  cdnDomains: string[];
  enabled: boolean;
  adblockDisabled?: boolean;
  /** Hosts the provider's video/API auth APIs run on (R3.5 API exemption). */
  apiDomains?: string[];
  /**
   * Provider home/list paths that escape the player frame ("Go Home" on an
   * error UI → provider.com/). Additive deny-list — append new shapes as
   * discovered. Single source of truth = providers.json providers[].blockHomePaths.
   */
  blockHomePaths?: string[];
  /** V5: allow the provider's own initial server redirect during the NavGuard
   *  bootstrap window (redirect-mesh upstreams: viduki.net, videasy.to). */
  allowServerRedirects?: boolean;
  /** V5: API synthetic-interception rules (screenscape /api/ads/cycles). */
  apiIntercepts?: ApiInterceptRule[];
  /** V5: CSS cosmetic rules applied via injectCosmetics. */
  cosmeticRules?: string[];
}

export interface NavigationGuardConfig {
  /** Paths blocked for EVERY provider (e.g. bare "/"). */
  universalBlockPaths?: string[];
  /** Reserved (deny-list is primary); parsed for schema parity. */
  shallowDepthThreshold?: number;
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
  navigationGuard?: NavigationGuardConfig;
  providers?: ProviderConfig[];
  /** V5: Ed25519 signature over the canonical JSON bytes (OTA integrity). */
  signature?: string;
  /** V5: hex-encoded Ed25519 public key that must verify `signature`. */
  publicKey?: string;
}

// ── Singleton state ─────────────────────────────────────────────────────────

let _config: BlocklistConfig | null = null;
let _configPath: string | null = null;

// ── V5 Ed25519 OTA integrity ────────────────────────────────────────────────
// The app must never apply a providers.json it did not author. OTA updates are
// signed with a key whose PUBLIC half ships with the app. Verification uses
// Node's crypto (Ed25519 one-shot verify — no digest).

// Embedded public key. In dev, also allow a .keys/filmsnaps-ed25519.pub in the
// repo so local edits + re-signs round-trip. In production, prefer the public
// key shipped via extraResources (process.resourcesPath/filter-engine/).
const EMBEDDED_PUBLIC_KEY = "";
function resolvePublicKeyPath(): string | null {
  if ((app as any).isPackaged) {
    const p = join(
      process.resourcesPath,
      "filter-engine",
      "filmsnaps-ed25519.pub",
    );
    return existsSync(p) ? p : null;
  }
  const devKey = join(dirname(__dirname), ".keys", "filmsnaps-ed25519.pub");
  if (existsSync(devKey)) return devKey;
  const repoKey = findProjectRoot(join(__dirname, ".."));
  if (repoKey) {
    const p = join(repoKey, ".keys", "filmsnaps-ed25519.pub");
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Verify the Ed25519 signature of a config JSON's bytes against the public key.
 * @param json raw bytes exactly as loaded (the signature is over canonical bytes)
 * @param signatureB64 base64 signature from providers.json.sig
 */
export function verifyConfigSignature(
  json: Buffer,
  signatureB64: string,
): boolean {
  const keyPath = resolvePublicKeyPath();
  if (!keyPath) return false;
  try {
    const publicKey = readFileSync(keyPath);
    // Ed25519 has no digest — use the one-shot verify (null algorithm derives
    // from the key). createVerify('ed25519') throws ERR_CRYPTO_INVALID_DIGEST.
    return cryptoVerify(
      null,
      json,
      publicKey,
      Buffer.from(signatureB64, "base64"),
    );
  } catch {
    return false;
  }
}

/**
 * Verify a providers.json file's signature against its .sig sibling.
 * @param jsonPath absolute path to the JSON config
 * @returns true when the .sig exists and verifies
 */
export function verifyConfigFileSignature(jsonPath: string): boolean {
  const sigPath = `${jsonPath}.sig`;
  if (!existsSync(sigPath)) return false;
  try {
    const json = readFileSync(jsonPath);
    const sig = readFileSync(sigPath, "utf-8");
    return verifyConfigSignature(json, sig.trim());
  } catch {
    return false;
  }
}

// ── Path resolution ─────────────────────────────────────────────────────────

const CONFIG_CANDIDATES = ["providers.json", "blocklist.json"];

/**
 * Walk up from a directory looking for a config file (providers.json
 * preferred, blocklist.json fallback).
 */
function findProjectRoot(dir: string): string | null {
  const candidate = resolve(dir);
  for (const name of CONFIG_CANDIDATES) {
    if (existsSync(join(candidate, name))) return candidate;
  }
  const parent = dirname(candidate);
  if (parent === candidate) return null;
  return findProjectRoot(parent);
}

/**
 * Resolve the path to the config JSON (providers.json preferred, blocklist.json
 * fallback).
 * Dev: walk up from dist/ to repo root
 * Prod: from process.resourcesPath (extraResources)
 */
function resolveConfigPath(): string {
  if ((app as any).isPackaged) {
    return join(process.resourcesPath, "providers.json");
  }

  // Dev: walk up from __dirname (dist/security/) to repo root
  let dir = dirname(__dirname);
  for (let i = 0; i < 10; i++) {
    for (const name of CONFIG_CANDIDATES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Try cwd
  const root = findProjectRoot(process.cwd());
  if (root) return join(root, CONFIG_CANDIDATES[0]);

  // Last resort: relative to package root
  const pkgRoot = findProjectRoot(join(__dirname, ".."));
  if (pkgRoot) return join(pkgRoot, CONFIG_CANDIDATES[0]);

  return "";
}

// ── Loading ─────────────────────────────────────────────────────────────────

/**
 * Load and cache the config JSON (providers.json, fallback blocklist.json).
 * Returns null if not found.
 */
export function loadBlocklistConfig(): BlocklistConfig | null {
  if (_config) return _config;

  const path = resolveConfigPath();
  if (!path || !existsSync(path)) {
    console.warn("[ProviderConfig] providers.json not found at resolved paths");
    return null;
  }

  try {
    const raw = readFileSync(path, "utf-8");
    _config = JSON.parse(raw) as BlocklistConfig;
    _configPath = path;
    const isV5 = _config.version >= 5;
    console.log(
      `[ProviderConfig] Loaded: ${path} (v${_config.version}, ` +
        `${_config.providers?.length || 0} providers, ` +
        `${_config.allowedCdnHosts?.length || 0} CDN hosts, ` +
        `${isV5 ? "signed" : "legacy v4"})`,
    );

    // Start watching for changes so edits take effect without restart
    startFileWatcher(path);

    return _config;
  } catch (err) {
    console.error("[ProviderConfig] Failed to parse providers.json:", err);
    return null;
  }
}

/**
 * Watch the config for changes and auto-reload.
 */
let watcherInitialized = false;
function startFileWatcher(path: string): void {
  if (watcherInitialized) return;
  watcherInitialized = true;

  try {
    watch(path, (eventType) => {
      if (eventType === "change") {
        console.log("[ProviderConfig] providers.json changed — reloading");
        reloadConfig();
      }
    });
  } catch (err) {
    console.warn("[ProviderConfig] Failed to watch providers.json:", err);
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
 * Per-provider home/list paths that escape the player frame (the provider
 * error-UI "Go Home" → provider.com/ escape). Additive deny-list from
 * blocklist.json providers[].blockHomePaths. Empty for providers with no
 * listed home shapes — the universal bare-root block still applies.
 */
export function getProviderBlockHomePaths(providerId: string): string[] {
  const profile = getProviderProfile(providerId);
  return profile?.blockHomePaths ?? [];
}

/**
 * Top-level navigation guard config (blocklist.json navigationGuard).
 * Defaults to blocking bare "/" for every provider (universalBlockPaths: ["/"]).
 */
export function getNavigationGuardConfig(): NavigationGuardConfig | null {
  const config = loadBlocklistConfig();
  return config?.navigationGuard ?? null;
}

/** Universal home/root paths blocked for every provider (default: bare "/"). */
export function getUniversalBlockPaths(): string[] {
  return getNavigationGuardConfig()?.universalBlockPaths ?? ["/"];
}

/** Reserved depth threshold (schema parity; not used for enforcement). */
export function getShallowDepthThreshold(): number {
  return getNavigationGuardConfig()?.shallowDepthThreshold ?? 1;
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
 * Get the sliding trust TTL (ms) from rules.videoDetection.trustTTLMs.
 * Defaults to 900000 (15 min) when unset — the v5 default.
 */
export function getTrustTTLMs(): number {
  return getVideoDetectionConfig()?.trustTTLMs ?? 900_000;
}

/**
 * Should the provider's own initial server redirect (301/302/307/308 during
 * the NavGuard bootstrap window) be allowed? Redirect-mesh providers
 * (vidsrc → viduki.net, videasy → videasy.to) need this true or they ERR_FAIL.
 */
export function getAllowServerRedirects(providerId: string): boolean {
  return getProviderProfile(providerId)?.allowServerRedirects === true;
}

/**
 * API synthetic-interception rules for a provider (screenscape /api/ads/cycles).
 * These are injected by the security layer to short-circuit ad-orchestrator
 * APIs that are not safe to let through.
 */
export function getProviderApiIntercepts(
  providerId: string,
): ApiInterceptRule[] {
  return getProviderProfile(providerId)?.apiIntercepts ?? [];
}

/**
 * Per-provider CSS cosmetic rules (provider chrome to hide, e.g. ad-window
 * badges, download-source buttons). Applied via injectCosmetics.
 */
export function getProviderCosmeticRules(providerId: string): string[] {
  return getProviderProfile(providerId)?.cosmeticRules ?? [];
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
