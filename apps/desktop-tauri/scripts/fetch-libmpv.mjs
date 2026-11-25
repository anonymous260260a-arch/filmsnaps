#!/usr/bin/env node
/**
 * Puts libmpv-2.dll into src-tauri/vendor/mpv/ so the app can ship a player.
 *
 * The pinned build is mpv's own LGPL release. LGPL lets FilmSnaps redistribute
 * the library next to a closed app as long as users can replace it, which the
 * separate DLL and runtime loading already allow. A build that links the GPL
 * variant would put the whole app under GPL, so this script never defaults to
 * one.
 *
 *   node scripts/fetch-libmpv.mjs                       pinned download, verified
 *   MPV_LIBMPV_DLL=<path> node scripts/fetch-libmpv.mjs local file instead
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PINNED = {
  url: 'https://github.com/mpv-player/mpv/releases/download/v0.42.0/libmpv-v0.42.0-x86_64-w64-mingw32-lgpl.zip',
  archiveSha256: '8e5f77430efc53ef175804ba6618527e3af0448a0dcabf04d3cc72659d1a6fce',
  librarySha256: '94fb87247732c59915cd59808bc582e843a71c22214b7b6c1e5563aa8149cef4',
  member: 'libmpv-2.dll',
};

const targetDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'vendor', 'mpv');
const target = join(targetDir, 'libmpv-2.dll');

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

if (process.env.MPV_LIBMPV_DLL) {
  const source = process.env.MPV_LIBMPV_DLL;
  if (!existsSync(source)) {
    console.error(`[fetch-libmpv] MPV_LIBMPV_DLL does not exist: ${source}`);
    process.exit(1);
  }
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(source, target);
  console.log(`[fetch-libmpv] ${source} -> ${target} (local file, not verified)`);
  process.exit(0);
}

if (existsSync(target)) {
  if (sha256(target) === PINNED.librarySha256) {
    console.log(`[fetch-libmpv] present and verified: ${target}`);
    process.exit(0);
  }
  console.error(`[fetch-libmpv] ${target} is not the pinned build.`);
  console.error('  Delete it to download the pinned one, or set MPV_LIBMPV_DLL to use your own.');
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'filmsnaps-libmpv-'));
try {
  const archive = join(work, 'libmpv.zip');
  const response = await fetch(PINNED.url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`download failed: HTTP ${response.status} from ${PINNED.url}`);
  }
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()));

  const archiveHash = sha256(archive);
  if (archiveHash !== PINNED.archiveSha256) {
    throw new Error(
      `archive checksum mismatch\n  expected ${PINNED.archiveSha256}\n  got      ${archiveHash}`,
    );
  }

  const unpacked = join(work, 'unpacked');
  // PowerShell is part of Windows and expands the zip without extra tools.
  execFileSync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${unpacked}' -Force`,
  ]);

  const library = join(unpacked, PINNED.member);
  if (!existsSync(library)) {
    throw new Error(`${PINNED.member} is not in the archive`);
  }
  const libraryHash = sha256(library);
  if (libraryHash !== PINNED.librarySha256) {
    throw new Error(
      `${PINNED.member} checksum mismatch\n  expected ${PINNED.librarySha256}\n  got      ${libraryHash}`,
    );
  }

  mkdirSync(targetDir, { recursive: true });
  copyFileSync(library, target);
  const size = (statSync(target).size / 1024 / 1024).toFixed(1);
  console.log(`[fetch-libmpv] ${PINNED.member} ${size} MB -> ${target}`);
} catch (error) {
  console.error(`[fetch-libmpv] ${error.message}`);
  process.exit(1);
} finally {
  rmSync(work, { recursive: true, force: true });
}
