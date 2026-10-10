import type { AdSlotName } from "../telemetry";

/**
 * Remote ads configuration (ads-config.json, same channel as
 * announcements.json). Everything the app can do with ads is decided by
 * this file — the binary only says "the SDK is present".
 *
 * Safe-by-default: the built-in config is all-off, and any schema drift in
 * the remote file falls back to all-off. A kill switch is one JSON edit
 * (no OTA, no rebuild): set `enabled: false`.
 */
export type AdFormat = "banner" | "mrec" | "cover";

export interface AdSlotConfig {
  enabled: boolean;
  format: AdFormat;
}

export interface AdsConfig {
  /** Schema version — rejected when > SUPPORTED (forward-compat guard). */
  version: number;
  /** Global kill switch. false → the SDK is never even initialized. */
  enabled: boolean;
  /** Start.io test ads. true until the canary proves fill is healthy. */
  testMode: boolean;
  /** 0-100: % of installs (bucketed by anonId) that see ads at all. */
  rolloutPercent: number;
  network: "startio";
  /** Start.io App ID (portal.start.io → My Apps). OTA-swappable. */
  appId: string;
  slots: Partial<Record<AdSlotName, AdSlotConfig>>;
}

export const SUPPORTED_ADS_CONFIG_VERSION = 1;

/** What the app runs with when there is no remote file / it fails validation. */
export const SAFE_ADS_CONFIG: AdsConfig = Object.freeze({
  version: 0,
  enabled: false,
  testMode: true,
  rolloutPercent: 0,
  network: "startio",
  appId: "",
  slots: {},
});

/** Known slot ids — unknown keys in the remote file are dropped. */
export const KNOWN_AD_SLOTS: readonly AdSlotName[] = [
  "home_hero",
  "search_list",
  "library_list",
  "settings_footer",
  "detail_above_overview",
  "announcements_page",
];

const AD_FORMATS: readonly AdFormat[] = ["banner", "mrec", "cover"];

/**
 * Validate + coerce a remote payload into AdsConfig. Any malformed piece is
 * replaced with the safe default for THAT field (a bad slot never takes the
 * whole file down; a bad global never enables ads).
 */
export function parseAdsConfig(raw: unknown): AdsConfig {
  if (typeof raw !== "object" || raw === null)
    return { ...SAFE_ADS_CONFIG, slots: {} };
  const o = raw as Record<string, unknown>;

  const version =
    typeof o.version === "number" && Number.isFinite(o.version) ? o.version : 0;
  if (version > SUPPORTED_ADS_CONFIG_VERSION) {
    // Future schema — refuse to guess. Stays all-off until the app updates.
    return { ...SAFE_ADS_CONFIG, slots: {} };
  }

  const slots: AdsConfig["slots"] = {};
  if (typeof o.slots === "object" && o.slots !== null) {
    for (const name of KNOWN_AD_SLOTS) {
      const s = (o.slots as Record<string, unknown>)[name];
      if (typeof s !== "object" || s === null) continue;
      const entry = s as Record<string, unknown>;
      const format =
        typeof entry.format === "string" &&
        (AD_FORMATS as readonly string[]).includes(entry.format)
          ? (entry.format as AdFormat)
          : "banner";
      slots[name] = { enabled: entry.enabled === true, format };
    }
  }

  const rolloutRaw =
    typeof o.rolloutPercent === "number" ? o.rolloutPercent : 0;
  const rolloutPercent = Math.max(0, Math.min(100, Math.round(rolloutRaw)));

  return {
    version,
    // `enabled` must be EXACTLY true — anything else is off.
    enabled: o.enabled === true,
    testMode: o.testMode !== false, // default true (safe: never serve real ads by accident)
    rolloutPercent,
    network: "startio",
    appId: typeof o.appId === "string" ? o.appId.slice(0, 64) : "",
    slots,
  };
}
