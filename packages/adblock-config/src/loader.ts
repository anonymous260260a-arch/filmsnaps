/**
 * Loader — reads blocklist.json from disk.
 *
 * Resolves from caller hints or the project root.
 * The caller should provide an explicit path when the root is known
 * (e.g., from __dirname in build scripts).
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BlocklistConfig } from './types.js';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Walk up from [dir] looking for blocklist.json.
 * Returns the directory containing it, or null.
 */
function findProjectRoot(dir: string): string | null {
  const candidate = resolve(dir);
  if (existsSync(join(candidate, 'blocklist.json'))) return candidate;
  const parent = dirname(candidate);
  // Stop at filesystem root
  if (parent === candidate) return null;
  return findProjectRoot(parent);
}

/**
 * Load and parse blocklist.json.
 *
 * @param hintPath Optional explicit path or directory hint.
 *   - If a file path to an actual blocklist.json: loaded directly.
 *   - If a directory: searched upward from there.
 *   - If omitted: walks up from this package's own location.
 *   - If null: uses process.cwd() as starting point.
 * @returns Parsed config, or null if not found / unreadable.
 */
export function loadBlocklistConfig(hintPath?: string | null): BlocklistConfig | null {
  // Determine the file path to read
  let targetPath: string | null = null;

  if (hintPath) {
    // If it looks like a file path and the file exists, use it
    if (existsSync(hintPath)) {
      targetPath = hintPath;
    } else {
      // Walk up from the directory hint
      const root = findProjectRoot(hintPath);
      if (root) targetPath = join(root, 'blocklist.json');
    }
  } else if (hintPath === null) {
    // Use cwd
    const root = findProjectRoot(process.cwd());
    if (root) targetPath = join(root, 'blocklist.json');
  } else {
    // Walk up from our own directory
    const root = findProjectRoot(CURRENT_DIR);
    if (root) targetPath = join(root, 'blocklist.json');
  }

  if (!targetPath) return null;

  try {
    const raw = readFileSync(targetPath, 'utf-8');
    return JSON.parse(raw) as BlocklistConfig;
  } catch {
    return null;
  }
}
