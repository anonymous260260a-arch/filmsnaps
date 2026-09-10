/**
 * playerConfig — single source of truth for player tuning, JS and native.
 *
 * Post-ship fix path: every value here can be overridden by a small JSON
 * document fetched from the app API (GET {API}/api/player-config) and cached
 * in AsyncStorage — a player regression then becomes a server-side config
 * change, no store update and no OTA needed. Defaults are baked into the
 * bundle, so when the endpoint is missing/offline the player behaves exactly
 * as shipped.
 *
 * Native knobs (expo-video patch): the module-level Properties
 * mkvExtractorMode / defaultHttpHeaders / httpConnectTimeoutMs /
 * httpReadTimeoutMs are applied here from config. Native exposes the
 * mechanism; this file owns the policy. On binaries older than the knob
 * patch the setters no-op silently and JS defaults stay in effect.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBaseUrl } from "./api";

const STORAGE_KEY = "@settings/playerConfig";
const FETCH_TIMEOUT_MS = 8000;
const CONFIG_URL = `${getApiBaseUrl()}/api/player-config`;

/**
 * Built-in request headers shared by the probe and playback. Per-host rules
 * (and the remote defaultHttpHeaders) merge over these.
 */
const BASE_PLAYBACK_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Encoding": "identity",
  Connection: "keep-alive",
  Referer: "https://google.com/",
};

/** JS-side player heuristics. Values = shipped behavior. */
export interface PlayerTuning {
  /** streamValidator: per-attempt probe timeout (native + JS fetch path). */
  validationTimeoutMs: number;
  /** HevcPlayer: max wait for a source switch to produce frames. */
  switchTimeoutMs: number;
  /** HevcPlayer: N mid-play stalls inside rebufferWindowMs ⇒ swap source. */
  rebufferLimit: number;
  rebufferWindowMs: number;
  /** ExpoVideoAdapter: errors within this window after enabling subtitles are subtitle failures (keep source). */
  subtitleErrorWindowMs: number;
  /** VideoWebView: delay before auto-falling back to the next provider. */
  providerFallbackDelayMs: number;
}

const DEFAULT_TUNING: PlayerTuning = {
  validationTimeoutMs: 7000,
  switchTimeoutMs: 12000,
  rebufferLimit: 5,
  rebufferWindowMs: 20_000,
  subtitleErrorWindowMs: 6000,
  providerFallbackDelayMs: 600,
};

/** Per-host overrides, keyed by hostname (suffix-matched: "a.b.cdn.com" matches "cdn.com"). */
export interface PlayerHostRule {
  /** Extra request headers for this host (merged over the defaults). */
  headers?: Record<string, string>;
  /** Treat direct links on this host as dead — the player falls through its normal chain. */
  blockDirect?: boolean;
  /** Skip probing entirely — links count as unverified and may still play. */
  skipProbe?: boolean;
}

export interface PlayerRemoteConfig {
  /** expo-video patch knob: "vendored" (default) | "stock" (kill switch for the secondary-SeekHead MKV extractor). */
  mkvExtractorMode?: "vendored" | "stock";
  httpConnectTimeoutMs?: number;
  httpReadTimeoutMs?: number;
  /** Headers applied to EVERY playback source natively (per-source and per-host headers win). */
  defaultHttpHeaders?: Record<string, string>;
  tuning?: Partial<PlayerTuning>;
  hosts?: Record<string, PlayerHostRule>;
}

let remoteConfig: PlayerRemoteConfig = {};

// ── Sync accessors (snapshot semantics — config is loaded once at startup) ──

export function getPlayerTuning(): PlayerTuning {
  return { ...DEFAULT_TUNING, ...remoteConfig.tuning };
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostRuleForUrl(url: string): PlayerHostRule {
  const host = hostnameOf(url);
  const hosts = remoteConfig.hosts;
  if (!host || !hosts) return {};
  if (hosts[host]) return hosts[host];
  // Suffix match so "img.foo.cdn.net" picks up rules written for "cdn.net".
  for (const [key, rule] of Object.entries(hosts)) {
    if (key.includes(".") && host.endsWith(`.${key.toLowerCase()}`))
      return rule;
  }
  return {};
}

/** Headers for probe + playback of one URL: defaults ← remote defaults ← host rule. */
export function headersForUrl(url: string): Record<string, string> {
  return {
    ...BASE_PLAYBACK_HEADERS,
    ...(remoteConfig.defaultHttpHeaders ?? {}),
    ...(hostRuleForUrl(url).headers ?? {}),
  };
}

export function shouldBlockDirect(url: string): boolean {
  return !!hostRuleForUrl(url).blockDirect;
}

export function shouldSkipProbe(url: string): boolean {
  return !!hostRuleForUrl(url).skipProbe;
}

// ── Native knob application ──

function applyNativeKnobs(config: PlayerRemoteConfig): void {
  let mod: Record<string, unknown> | null = null;
  try {
    // Lazy require mirrors streamValidator — keeps this file import-safe on web.
    const { requireNativeModule } = require("expo-modules-core");
    mod = requireNativeModule("ExpoVideo") as Record<string, unknown>;
  } catch {
    return;
  }
  const set = (key: string, value: unknown) => {
    try {
      // Property missing ⇒ binary predates the knob patch — leave native defaults.
      if (mod && mod[key] !== undefined) mod[key] = value;
    } catch {
      // Set failed (readonly on this build) — ignore.
    }
  };
  if (config.mkvExtractorMode) set("mkvExtractorMode", config.mkvExtractorMode);
  if (config.defaultHttpHeaders)
    set("defaultHttpHeaders", config.defaultHttpHeaders);
  if (typeof config.httpConnectTimeoutMs === "number")
    set("httpConnectTimeoutMs", config.httpConnectTimeoutMs);
  if (typeof config.httpReadTimeoutMs === "number")
    set("httpReadTimeoutMs", config.httpReadTimeoutMs);
}

// ── Loading ──

function clampNumber(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(value, min), max)
    : undefined;
}

function sanitizeHeaders(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof k === "string" && typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitize(raw: unknown): PlayerRemoteConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as PlayerRemoteConfig;
  const config: PlayerRemoteConfig = {};

  if (r.mkvExtractorMode === "vendored" || r.mkvExtractorMode === "stock") {
    config.mkvExtractorMode = r.mkvExtractorMode;
  }
  const connect = clampNumber(r.httpConnectTimeoutMs, 1000, 120_000);
  if (connect !== undefined) config.httpConnectTimeoutMs = connect;
  const read = clampNumber(r.httpReadTimeoutMs, 1000, 600_000);
  if (read !== undefined) config.httpReadTimeoutMs = read;
  config.defaultHttpHeaders = sanitizeHeaders(r.defaultHttpHeaders);

  if (r.tuning && typeof r.tuning === "object") {
    const t = r.tuning as Partial<PlayerTuning>;
    const tuning: Partial<PlayerTuning> = {};
    const validation = clampNumber(t.validationTimeoutMs, 2000, 60_000);
    const switchTimeout = clampNumber(t.switchTimeoutMs, 2000, 120_000);
    const rebufferLimit = clampNumber(t.rebufferLimit, 1, 20);
    const rebufferWindow = clampNumber(t.rebufferWindowMs, 5000, 300_000);
    const subtitleWindow = clampNumber(t.subtitleErrorWindowMs, 1000, 120_000);
    const providerDelay = clampNumber(t.providerFallbackDelayMs, 0, 30_000);
    if (validation !== undefined) tuning.validationTimeoutMs = validation;
    if (switchTimeout !== undefined) tuning.switchTimeoutMs = switchTimeout;
    if (rebufferLimit !== undefined)
      tuning.rebufferLimit = Math.round(rebufferLimit);
    if (rebufferWindow !== undefined) tuning.rebufferWindowMs = rebufferWindow;
    if (subtitleWindow !== undefined)
      tuning.subtitleErrorWindowMs = subtitleWindow;
    if (providerDelay !== undefined)
      tuning.providerFallbackDelayMs = providerDelay;
    if (Object.keys(tuning).length > 0) config.tuning = tuning;
  }

  if (r.hosts && typeof r.hosts === "object" && !Array.isArray(r.hosts)) {
    const hosts: Record<string, PlayerHostRule> = {};
    for (const [host, rule] of Object.entries(
      r.hosts as Record<string, unknown>,
    )) {
      if (!rule || typeof rule !== "object") continue;
      const rr = rule as PlayerHostRule;
      const clean: PlayerHostRule = {};
      const headers = sanitizeHeaders(rr.headers);
      if (headers) clean.headers = headers;
      if (typeof rr.blockDirect === "boolean")
        clean.blockDirect = rr.blockDirect;
      if (typeof rr.skipProbe === "boolean") clean.skipProbe = rr.skipProbe;
      if (Object.keys(clean).length > 0) hosts[host.toLowerCase()] = clean;
    }
    if (Object.keys(hosts).length > 0) config.hosts = hosts;
  }

  return config;
}

/**
 * Load the player config: cached copy first (instant, applied to native),
 * then a fresh fetch to refresh the cache. Safe to call more than once —
 * only the first call does work. Never throws.
 */
let initPromise: Promise<void> | null = null;

export function initPlayerConfig(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    // 1) Cached config — applied immediately so a cold start keeps last known state.
    try {
      const cached = await AsyncStorage.getItem(STORAGE_KEY);
      if (cached) {
        const parsed = sanitize(JSON.parse(cached));
        if (parsed) {
          remoteConfig = parsed;
          applyNativeKnobs(parsed);
        }
      }
    } catch {
      // Unreadable cache — defaults apply.
    }

    // 2) Fresh config — refresh the cache for the next cold start.
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(CONFIG_URL, {
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const fresh = sanitize(await response.json());
      if (fresh) {
        remoteConfig = fresh;
        applyNativeKnobs(fresh);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(fresh)).catch(
          () => {},
        );
        console.log("[PlayerConfig] remote config applied");
      }
    } catch {
      // Endpoint missing/offline — cached/default config keeps shipped behavior.
    }
  })();
  return initPromise;
}
