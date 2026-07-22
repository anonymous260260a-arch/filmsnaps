#!/usr/bin/env tsx
/**
 * Blocklist config CLI validator.
 *
 * Usage:
 *   pnpm validate                    # validates project root blocklist.json
 *   tsx src/validate-cli.ts <path>   # validate a specific file
 *
 * Exit code: 0 = valid, 1 = has errors, 2 = not found
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateConfig } from './validator.js';

function main(): void {
  const hintPath = process.argv[2]
    ? resolve(process.argv[2])
    : findDefaultPath();

  if (!hintPath || !existsSync(hintPath)) {
    console.error(`[adblock-config] Error: blocklist.json not found at ${hintPath ?? '<none>'}`);
    process.exit(2);
  }

  console.log(`[adblock-config] Validating: ${hintPath}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(hintPath, 'utf-8'));
  } catch (e) {
    console.error(`[adblock-config] Error: invalid JSON — ${(e as Error).message}`);
    process.exit(1);
  }

  const result = validateConfig(raw);
  const icon = result.valid ? '✓' : '✗';

  if (result.errors.length > 0) {
    console.error(`[adblock-config] ${icon} ${result.errors.length} error(s):`);
    for (const err of result.errors) {
      console.error(`  ✗  ${err}`);
    }
  }

  if (result.warnings.length > 0) {
    console.warn(`[adblock-config] ⚠ ${result.warnings.length} warning(s):`);
    for (const warn of result.warnings) {
      console.warn(`  ⚠  ${warn}`);
    }
  }

  if (result.valid && result.warnings.length === 0) {
    console.log(`[adblock-config] ✓ Config is valid`);
  }

  process.exit(result.valid ? 0 : 1);
}

function findDefaultPath(): string | null {
  // Walk up from cwd
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, 'blocklist.json');
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

main();
