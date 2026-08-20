/**
 * FilmSnaps Desktop — OTA Config Loader (v5 split: providers.json + filters.txt)
 *
 * Port of mobile's BlocklistConfigLoader.kt with the v5 additions:
 *   - Ed25519 signature verification BEFORE applying any fetched config
 *     (invalid signature → reject, keep last-known-good, log telemetry)
 *   - Ring-buffer rollback: keep the last 3 validated configs on disk
 *     (providers.json, .v4, .v3 + their .sig siblings)
 *   - 3×-failure watchdog: if the main embed frame fails
 *     (ERR_FAILED / ERR_BLOCKED_BY_CLIENT) 3× in a row for a previously-working
 *     provider, revert to the prior validated config, flag current as failed,
 *     and log to heal-events.log
 *
 * Load order (priority high → low):
 *   1. Fresh OTA fetch (validated) — on launch + every 2h
 *   2. Ring-buffer cache on disk (last-known-good)
 *   3. Bundled default (extraResources providers.json / blocklist.json)
 */

import { app } from "electron";
import {
  existsSync,
  mkdirSync,
  appendFileSync,
  copyFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import {
  reloadConfig,
  verifyConfigFileSignature,
  verifyConfigSignature,
} from "./provider-config";

// ── Constants ──────────────────────────────────────────────────────────────

const OTA_URL =
  process.env.FILMSNAPS_OTA_URL ??
  "https://raw.githubusercontent.com/anonymous260260a-arch/filmsnaps/main/providers.json";
const OTA_FILTERS_URL =
  process.env.FILMSNAPS_OTA_FILTERS_URL ??
  "https://raw.githubusercontent.com/anonymous260260a-arch/filmsnaps/main/filters.txt";

/** How often to re-check for config updates (ms). 2 hours. */
const OTA_INTERVAL_MS = 2 * 60 * 60 * 1000;
/** Ring-buffer depth: keep N validated configs on disk. */
const RING_DEPTH = 3;
/** Watchdog: failures before reverting to prior config. */
const WATCHDOG_THRESHOLD = 3;
/** Watchdog failure codes that count toward a config rollback. */
const WATCHDOG_ERROR_CODES = new Set([
  "ERR_FAILED",
  "ERR_BLOCKED_BY_CLIENT",
  "ERR_ABORTED",
]);

// ── State ──────────────────────────────────────────────────────────────────

/** Failures per provider id, reset when a provider loads successfully. */
const providerFailures = new Map<string, number>();

// ── Paths ──────────────────────────────────────────────────────────────────

/** The ring-buffer lives in the user-data dir so it survives restarts but is
 *  app-private (not bundled). providers.json (active) + providers.v4/v3 (prior). */
function otaDir(): string {
  return join(app.getPath("userData"), "ota-config");
}

/** Active config path: userData/ota-config/providers.json (signed OTA) */
function activeConfigPath(): string {
  return join(otaDir(), "providers.json");
}

function activeFiltersPath(): string {
  return join(otaDir(), "filters.txt");
}

/** heal-events.log — human-readable OTA/heal telemetry (no external service). */
function healLogPath(): string {
  return join(otaDir(), "heal-events.log");
}

/** Log a heal event (timestamp, provider, errorCode, action, config). */
function logHealEvent(event: {
  provider?: string;
  errorCode?: string;
  action: string;
  config?: string;
  detail?: string;
}): void {
  try {
    mkdirSync(otaDir(), { recursive: true });
    const ts = new Date().toISOString();
    const parts = [
      ts,
      event.action,
      event.provider ? `provider=${event.provider}` : "",
      event.errorCode ? `error=${event.errorCode}` : "",
      event.config ? `config=${event.config}` : "",
      event.detail ? `detail=${event.detail}` : "",
    ].filter(Boolean);
    appendFileSync(healLogPath(), parts.join(" | ") + "\n", "utf-8");
    console.log(`[HealEvents] ${parts.join(" | ")}`);
  } catch {
    // Logging must never crash the app.
  }
}

// ── Watchdog ───────────────────────────────────────────────────────────────

/**
 * Record a provider frame failure. When a previously-working provider fails
 * WATCHDOG_THRESHOLD times in a row, revert to the prior validated config.
 *
 * Called from the did-fail-load handler in main.ts. This is the "auto-heal"
 * path: a bad OTA config that broke playback rolls back without the user
 * touching settings.
 *
 * @param providerId the provider whose embed failed
 * @param errorCode Electron error code (ERR_FAILED, ERR_BLOCKED_BY_CLIENT, …)
 * @returns true when a rollback was performed
 */
export function recordProviderFailure(
  providerId: string,
  errorCode: string,
): boolean {
  if (!WATCHDOG_ERROR_CODES.has(errorCode)) return false;

  const count = (providerFailures.get(providerId) ?? 0) + 1;
  providerFailures.set(providerId, count);

  if (count >= WATCHDOG_THRESHOLD) {
    providerFailures.set(providerId, 0);
    logHealEvent({
      provider: providerId,
      errorCode,
      action: "WATCHDOG_REVERT",
      detail: `reverting after ${count} consecutive failures`,
    });
    return rollbackConfig();
  }
  return false;
}

/** Reset the failure counter when a provider loads successfully. */
export function recordProviderSuccess(providerId: string): void {
  if (providerFailures.has(providerId)) {
    providerFailures.set(providerId, 0);
  }
}

// ── Ring-buffer rollback ───────────────────────────────────────────────────

/**
 * Rotate the ring buffer: current → .v4 → .v3 → drop, then place the new
 * validated config at the head.
 */
function rotateIntoRing(
  srcJson: string,
  srcFilters: string,
  sigB64: string,
): void {
  try {
    const dir = otaDir();
    mkdirSync(dir, { recursive: true });

    const head = join(dir, "providers.json");
    const v4 = join(dir, "providers.v4.json");
    const v3 = join(dir, "providers.v3.json");

    // Shift: v4 → v3 (drop old v3), head → v4, write new head.
    if (existsSync(v4)) {
      rmSync(v3, { force: true });
      copyFileSync(v4, v3);
      copyFileSync(`${v4}.sig`, `${v3}.sig`);
    }
    if (existsSync(head)) {
      rmSync(v4, { force: true });
      copyFileSync(head, v4);
      copyFileSync(`${head}.sig`, `${v4}.sig`);
    }

    writeFileSync(head, srcJson, "utf-8");
    writeFileSync(`${head}.sig`, sigB64, "utf-8");
    if (srcFilters) writeFileSync(activeFiltersPath(), srcFilters, "utf-8");
  } catch (err) {
    logHealEvent({
      action: "RING_ROTATE_FAILED",
      detail: (err as Error).message,
    });
  }
}

/**
 * Revert the active config to the prior validated ring-buffer entry.
 * Returns true when a rollback happened.
 */
function rollbackConfig(): boolean {
  const dir = otaDir();
  const head = join(dir, "providers.json");
  const v4 = join(dir, "providers.v4.json");

  // Prefer the newest prior config that still verifies.
  for (const candidate of [v4, join(dir, "providers.v3.json")]) {
    if (!existsSync(candidate)) continue;
    if (!verifyConfigFileSignature(candidate)) {
      logHealEvent({
        action: "ROLLBACK_SKIP",
        config: candidate,
        detail: "prior config signature invalid — skipping",
      });
      continue;
    }
    try {
      copyFileSync(candidate, head);
      const sigPath = `${candidate}.sig`;
      if (existsSync(sigPath)) copyFileSync(sigPath, `${head}.sig`);
      reloadConfig();
      logHealEvent({
        action: "ROLLBACK_APPLIED",
        config: candidate,
        detail: `reverted to prior validated config`,
      });
      return true;
    } catch (err) {
      logHealEvent({
        action: "ROLLBACK_FAILED",
        config: candidate,
        detail: (err as Error).message,
      });
    }
  }
  logHealEvent({
    action: "ROLLBACK_NONE",
    detail: "no prior validated config on disk",
  });
  return false;
}

// ── Fetching ───────────────────────────────────────────────────────────────

/**
 * Fetch a URL with a short timeout. Returns the body text or null.
 */
async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "FilmSnaps-Desktop/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * One OTA cycle: fetch providers.json + its .sig + filters.txt, verify the
 * signature, validate structure, and if everything is good rotate it into the
 * ring buffer and reload. Any failure keeps the current config.
 */
export async function performOtaUpdate(): Promise<boolean> {
  try {
    const [providersText, sigText, filtersText] = await Promise.all([
      fetchText(OTA_URL),
      fetchText(`${OTA_URL}.sig`),
      fetchText(OTA_FILTERS_URL),
    ]);

    if (!providersText || !sigText) {
      logHealEvent({
        action: "OTA_FETCH_FAILED",
        detail: "missing body or sig",
      });
      return false;
    }

    // Verify the signature over the canonical bytes.
    const jsonBuf = Buffer.from(providersText, "utf-8");
    if (!verifyConfigSignature(jsonBuf, sigText.trim())) {
      logHealEvent({
        action: "OTA_SIGNATURE_REJECTED",
        detail: "fetched config signature did not verify — keeping current",
      });
      return false;
    }

    // Structural validation (reject malformed or downgrade configs).
    try {
      const parsed = JSON.parse(providersText);
      if (typeof parsed !== "object" || parsed === null || parsed.version < 5) {
        logHealEvent({
          action: "OTA_STRUCTURE_REJECTED",
          detail: `version=${parsed?.version}`,
        });
        return false;
      }
    } catch {
      logHealEvent({ action: "OTA_PARSE_FAILED" });
      return false;
    }

    // All checks passed — rotate into ring buffer + reload.
    rotateIntoRing(providersText, filtersText ?? "", sigText.trim());
    reloadConfig();
    logHealEvent({
      action: "OTA_APPLIED",
      detail: `v${(JSON.parse(providersText) as { version?: number }).version ?? "?"}`,
    });
    return true;
  } catch (err) {
    logHealEvent({
      action: "OTA_FAILED",
      detail: (err as Error).message,
    });
    return false;
  }
}

/**
 * Ensure the OTA config exists on disk. If the ring buffer has a validated
 * config, use it (activates the OTA-updated providers.json over the bundled
 * default). Otherwise fall back to the bundled default (which provider-config
 * already resolves).
 */
export function activateOtaConfigIfPresent(): void {
  const dir = otaDir();
  const head = join(dir, "providers.json");
  if (!existsSync(head)) return;

  // The active OTA config must verify; if not, ignore it (bundled default wins).
  if (!verifyConfigFileSignature(head)) {
    logHealEvent({
      action: "OTA_ACTIVE_REJECTED",
      config: head,
      detail: "active OTA config signature invalid — using bundled default",
    });
    return;
  }
  reloadConfig();
  logHealEvent({ action: "OTA_ACTIVATED", config: head });
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

let otaInterval: NodeJS.Timeout | null = null;

/**
 * Start the OTA loop: run once at app launch, then every OTA_INTERVAL_MS.
 * Non-blocking — the fetch+verify runs in the background.
 */
export function startOtaConfigLoop(): void {
  activateOtaConfigIfPresent();

  // Fire the first fetch off the critical path.
  setTimeout(() => {
    performOtaUpdate().catch(() => {});
  }, 5_000);

  if (otaInterval) clearInterval(otaInterval);
  otaInterval = setInterval(() => {
    performOtaUpdate().catch(() => {});
  }, OTA_INTERVAL_MS);
}

/** Stop the OTA loop (app quit). */
export function stopOtaConfigLoop(): void {
  if (otaInterval) {
    clearInterval(otaInterval);
    otaInterval = null;
  }
}
