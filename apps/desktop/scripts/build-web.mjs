/**
 * FilmSnaps Desktop — Prepackage web build step
 *
 * The Electron app in production spawns the Next.js STANDALONE server from
 * `resources/web/apps/web/server.js` (see src/main.ts → startNextServer).
 * electron-builder maps `../web/.next/standalone` into the installer via the
 * `extraResources` config, but that directory only exists when the web app is
 * built with `BUILD_FOR_DESKTOP=true` (see apps/web/next.config.js).
 *
 * Previously that env var was never set by any local build chain, so
 * `pnpm dist` silently shipped an EMPTY `resources/web` — the packaged app
 * opened to a blank screen. This script codifies the missing step:
 *
 *   1. Build @filmsnaps/shared (the web app's dist output is used at build
 *      time, and CI does this explicitly before building web).
 *   2. Run `pnpm build` in apps/web with `BUILD_FOR_DESKTOP=true` so
 *      `.next/standalone/` is produced.
 *   3. Verify `apps/web/.next/standalone/apps/web/server.js` exists and exit
 *      nonzero if it doesn't — a missing bundle must fail the build loudly
 *      instead of shipping another broken installer.
 *
 * Cross-platform: spawns pnpm with `shell: true` (resolves pnpm.cmd on
 * Windows), and sets the env var via the spawn `env` object rather than shell
 * quoting so there are no `VAR=x cmd` portability issues.
 */

'use strict';

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve the monorepo layout from this file's own location
// (apps/desktop/scripts/build-web.mjs) so the script works regardless of cwd.
const desktopRoot = join(__dirname, '..');
const webRoot = join(desktopRoot, '..', 'web');
const monorepoRoot = join(desktopRoot, '..', '..');

/** Spawn pnpm and exit the whole build on failure with a clear message. */
function runPnpm(args, opts) {
  console.log(`[build-web] pnpm ${args.join(' ')}`);
  const result = spawnSync('pnpm', args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: 'inherit',
    shell: true, // resolves pnpm.cmd on Windows
  });
  if (result.status !== 0) {
    console.error(`[build-web] FAILED: pnpm ${args.join(' ')} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

// 1. Build the shared package — the web app consumes its compiled `dist`
//    output at build time. (CI does the same explicitly; doing it here makes
//    the desktop build self-contained.)
if (existsSync(join(monorepoRoot, 'pnpm-workspace.yaml'))) {
  runPnpm(['--filter', '@filmsnaps/shared', 'build'], { cwd: monorepoRoot });
} else {
  // Not running under a pnpm workspace (rare) — shared should already be built.
  console.log('[build-web] No pnpm workspace detected — skipping shared build');
}

// 2. Build the web app for desktop (standalone output).
runPnpm(['build'], {
  cwd: webRoot,
  env: { ...process.env, BUILD_FOR_DESKTOP: 'true' },
});

// 3. Verify the standalone bundle the installer depends on actually exists.
//    electron-builder maps `.next/standalone` → `resources/web`, and main.ts
//    spawns `resources/web/apps/web/server.js`.
const standaloneServer = join(webRoot, '.next', 'standalone', 'apps', 'web', 'server.js');
if (!existsSync(standaloneServer)) {
  console.error(
    `[build-web] FAILED: standalone server not found at ${standaloneServer}`,
  );
  console.error(
    '[build-web] Did `next build` produce .next/standalone? ' +
      'Check that BUILD_FOR_DESKTOP=true reached apps/web/next.config.js.',
  );
  process.exit(1);
}

console.log(`[build-web] Web standalone bundle verified: ${standaloneServer}`);
