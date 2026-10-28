import AsyncStorage from "@react-native-async-storage/async-storage";
import { MovieAds } from "../../modules/movie-ads";
import { getApiBaseUrl } from "../api";
import { parseAdsConfig, SAFE_ADS_CONFIG, type AdsConfig } from "./types";

/**
 * ads-config.json — the single remote switch for every ad behavior.
 *
 * Mirrors the announcements channel: cache-first (AsyncStorage), never
 * blocks UI, any fetch/validation failure keeps the SAFE all-off config.
 *
 * Two layers of "off":
 *  - BUILT-IN default: SAFE_ADS_CONFIG (enabled=false) — even a missing
 *    file means zero ads.
 *  - REMOTE kill: set enabled=false in the hosted JSON and every install
 *    turns ads off on its next boot/config refresh (≤6h).
 *
 * Initialization of the native SDK happens ONLY when the effective config
 * is enabled + has an appId + the user accepted the legal gate. Until then
 * Start.io makes no network calls at all.
 */

const CACHE_KEY = "@filmsnaps/ads-config/v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — ads config can wait, perf can't

function getConfigUrl(): string {
  return `${getApiBaseUrl().replace(/\/$/, "")}/ads-config.json`;
}

// ── In-memory store (useSyncExternalStore source) ──

let current: AdsConfig = { ...SAFE_ADS_CONFIG, slots: {} };
let loadedAt = 0;
let sdkInitialized = false;
let lastConsent: boolean | null = null;
const listeners = new Set<() => void>();

export function getAdsConfig(): AdsConfig {
  return current;
}

export function subscribeAdsConfig(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setConfig(next: AdsConfig): void {
  const changed = JSON.stringify(next) !== JSON.stringify(current);
  current = next;
  if (changed) for (const fn of listeners) fn();
}

// ── Cache helpers ──

async function readCache(): Promise<AdsConfig | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parseAdsConfig((parsed as { config?: unknown }).config ?? parsed);
  } catch {
    return null;
  }
}

async function writeCache(cfg: AdsConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ config: cfg, at: Date.now() }),
    );
  } catch {
    // cache write failures are non-fatal
  }
}

function isFresh(): boolean {
  return Date.now() - loadedAt < CACHE_TTL_MS;
}

// ── SDK bootstrap ──

function syncSdk(cfg: AdsConfig, legalAccepted: boolean): void {
  if (!MovieAds) return; // old binary / iOS — ads simply never run

  if (!legalAccepted) {
    // Legal gate closed: never talk to the ad network. (Consent withdrawn.)
    if (sdkInitialized) MovieAds.setConsent(false);
    lastConsent = false;
    return;
  }

  if (lastConsent !== true) {
    lastConsent = true;
    // Personalized-ads consent follows the single legal gate (IAB "pas").
    MovieAds.setConsent(true);
  }

  // Initialize ONLY when the remote config actually wants ads. This is the
  // line that keeps a shipped-but-disabled SDK completely inert.
  if (cfg.enabled && cfg.appId && !sdkInitialized) {
    sdkInitialized = MovieAds.initialize(cfg.appId, cfg.testMode, true);
  }
}

// ── Public API ──

/**
 * Cache-first refresh; safe to call from multiple places (boot + legal
 * gate). Returns the effective config (never null — SAFE when nothing).
 */
export async function fetchAdsConfig(options?: {
  force?: boolean;
  legalAccepted?: boolean;
}): Promise<AdsConfig> {
  const legalAccepted = options?.legalAccepted ?? lastConsent === true;

  // 1. Serve in-memory immediately if fresh (or cache on first call).
  if (current.version === 0 && !options?.force) {
    const cached = await readCache();
    if (cached) setConfig(cached);
  }

  // 2. Background refresh when stale/forced.
  if (!options?.force && isFresh()) {
    syncSdk(current, legalAccepted);
    return current;
  }

  try {
    const resp = await fetch(getConfigUrl(), {
      headers: { Accept: "application/json" },
    });
    if (resp.ok) {
      const cfg = parseAdsConfig(await resp.json());
      setConfig(cfg);
      loadedAt = Date.now();
      await writeCache(cfg);
    }
  } catch {
    // offline / worker down → keep whatever we had (or SAFE)
  }

  syncSdk(current, legalAccepted);
  return current;
}

/**
 * Called from AppContent whenever the legal/analytics gate changes.
 * Ads depend on legalAccepted only (analytics toggle controls telemetry,
 * not the ad network).
 */
export function configureAds(legalAccepted: boolean): void {
  lastConsent = legalAccepted;
  void fetchAdsConfig({ legalAccepted });
}
