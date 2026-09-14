#!/usr/bin/env node
/**
 * download-mpv.mjs — ensure vendor/mpv/mpv.exe exists before building.
 *
 * In dev the binary is already present (manually downloaded). This script
 * only gates the build — if mpv.exe is missing, the build fails with a
 * clear message instead of a cryptic electron-builder error later.
 *
 * TODO: add actual download logic (fetch from GitHub releases) when
 * vendor/ is gitignored and fresh clones need the binary.
 */

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mpvDir = join(__dirname, "..", "vendor", "mpv");
const mpvExe = join(mpvDir, "mpv.exe");

if (existsSync(mpvExe)) {
  console.log(`[download-mpv] mpv.exe found at ${mpvExe} — skipping download`);
  process.exit(0);
}

console.error(
  `\n[download-mpv] mpv.exe not found at ${mpvExe}\n` +
    `Download mpv for Windows from https://sourceforge.net/projects/mpv-player-windows/files/64bit/\n` +
    `Extract mpv.exe into apps/desktop/vendor/mpv/\n`,
);
process.exit(1);
