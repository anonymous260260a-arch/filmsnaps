/**
 * FilmSnaps Desktop — Prepackage web build step
 *
 * Builds the Next.js static export for desktop. The Electron app serves
 * static files via app:// protocol (no Node.js server, <200ms cold start).
 *
 *   1. Build @filmsnaps/shared (web app's build-time dependency).
 *   2. Run `pnpm build` in apps/web with BUILD_FOR_DESKTOP=true + NEXT_PUBLIC_API_URL.
 *   3. Verify apps/web/out/index.html exists.
 *
 * API URL selection:
 *   - Default (production): https://filmsnaps1.anonymous260260a.workers.dev
 *   - Dev override: set NEXT_PUBLIC_API_URL=http://localhost:3000
 *     (requires `pnpm dev:web` running in a separate terminal)
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

// 2. Build the web app for desktop (static export).
//    NEXT_PUBLIC_API_URL: where the desktop app fetches API data from.
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://filmsnaps1.anonymous260260a.workers.dev';
const isDev = API_URL.includes('localhost');
console.log(`[build-web] API URL: ${API_URL} (${isDev ? 'dev — requires running dev server' : 'production'})`);

runPnpm(['build'], {
  cwd: webRoot,
  env: { ...process.env, BUILD_FOR_DESKTOP: 'true', NEXT_PUBLIC_API_URL: API_URL },
});

// 3. Verify the static export output exists.
//    electron-builder maps `out/` → `resources/web`, and main.ts serves
//    via app:// protocol (no Node.js server).
const staticExport = join(webRoot, 'out', 'index.html');
if (!existsSync(staticExport)) {
  console.error(
    `[build-web] FAILED: static export not found at ${staticExport}`,
  );
  console.error(
    '[build-web] Did `next build` produce out/? ' +
      'Check that BUILD_FOR_DESKTOP=true reached apps/web/next.config.js.',
  );
  process.exit(1);
}

console.log(`[build-web] Web static export verified: ${staticExport}`);
