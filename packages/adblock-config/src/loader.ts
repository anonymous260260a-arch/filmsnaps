/**
 * Loader — reads the v5 split config (providers.json + filters.txt).
 *
 * Resolves from caller hints or the project root.
 * The caller should provide an explicit path when the root is known
 * (e.g., from __dirname in build scripts).
 *
 * V5: the single blocklist.json becomes providers.json (app-logic) +
 * filters.txt (uBO/EasyList engine input). For backward compatibility
 * during the desktop-first migration, blocklist.json (v4) is still
 * resolved when providers.json is absent — mobile keeps reading it until
 * Phase 4.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BlocklistConfig } from "./types.js";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

// Config file basenames, newest first. V5 = providers.json (with filters.txt
// sibling); fallback = blocklist.json (legacy v4, mobile-facing until Phase 4).
const CONFIG_CANDIDATES = ["providers.json", "blocklist.json"];

/**
 * Walk up from [dir] looking for a config file (providers.json preferred,
 * blocklist.json fallback). Returns the directory containing it, or null.
 */
function findProjectRoot(dir: string): string | null {
  const candidate = resolve(dir);
  for (const name of CONFIG_CANDIDATES) {
    if (existsSync(join(candidate, name))) return candidate;
  }
  const parent = dirname(candidate);
  // Stop at filesystem root
  if (parent === candidate) return null;
  return findProjectRoot(parent);
}

/**
 * Resolve the on-disk path to the config JSON (providers.json preferred,
 * blocklist.json fallback) given a caller hint.
 *
 * @param hintPath Optional explicit path or directory hint.
 *   - If a file path to an actual providers.json/blocklist.json: used directly.
 *   - If a directory: searched upward from there.
 *   - If omitted: walks up from this package's own location.
 *   - If null: uses process.cwd() as starting point.
 */
export function resolveConfigPath(hintPath?: string | null): string | null {
  let targetPath: string | null = null;

  if (hintPath) {
    if (existsSync(hintPath)) {
      targetPath = hintPath;
    } else {
      const root = findProjectRoot(hintPath);
      if (root) targetPath = join(root, CONFIG_CANDIDATES[0]);
    }
  } else if (hintPath === null) {
    const root = findProjectRoot(process.cwd());
    if (root) targetPath = join(root, CONFIG_CANDIDATES[0]);
  } else {
    const root = findProjectRoot(CURRENT_DIR);
    if (root) targetPath = join(root, CONFIG_CANDIDATES[0]);
  }

  return targetPath;
}

/**
 * Load and parse the config JSON (providers.json, fallback blocklist.json).
 *
 * @param hintPath Optional explicit path or directory hint (see resolveConfigPath).
 * @returns Parsed config, or null if not found / unreadable.
 */
export function loadBlocklistConfig(
  hintPath?: string | null,
): BlocklistConfig | null {
  const targetPath = resolveConfigPath(hintPath);
  if (!targetPath) return null;

  try {
    const raw = readFileSync(targetPath, "utf-8");
    return JSON.parse(raw) as BlocklistConfig;
  } catch {
    return null;
  }
}

/**
 * Load filters.txt (v5 uBO/EasyList engine input) from the same directory
 * as the resolved config. Returns null when the config is legacy v4
 * (blocklist.json without a filters.txt sibling) or the file is missing.
 *
 * @param hintPath Same hint semantics as loadBlocklistConfig.
 */
export function loadFiltersTxt(hintPath?: string | null): string | null {
  const configPath = resolveConfigPath(hintPath);
  if (!configPath) return null;

  const filtersPath = join(dirname(configPath), "filters.txt");
  if (!existsSync(filtersPath)) return null;

  try {
    return readFileSync(filtersPath, "utf-8");
  } catch {
    return null;
  }
}
