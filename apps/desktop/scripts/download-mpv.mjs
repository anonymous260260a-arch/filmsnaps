#!/usr/bin/env node
/**
 * download-mpv.mjs — ensure vendor/mpv/mpv.exe exists before building.
 *
 * vendor/ is gitignored (binaries don't belong in git), so fresh clones are
 * empty — this script downloads mpv automatically instead of gating on a
 * manual step:
 *
 *   1. Query the latest release of zhongfly/mpv-winbuild (daily Windows
 *      builds, GitHub-hosted — no SourceForge mirror dance).
 *   2. Pick the generic x86_64 asset (NOT the -v3 AVX2 build — dev machines
 *      and CI runners can be older than AVX2).
 *   3. Download it + the release's sha256.txt, verify the hash.
 *   4. Extract with the OS tar (Windows ships bsdtar, which reads 7z) and
 *      copy everything next to mpv.exe into vendor/mpv/.
 *
 * Cached: skipped entirely once vendor/mpv/mpv.exe exists.
 * Non-Windows: mpv.exe is a Windows binary — other platforms get the manual
 * instructions (the desktop player links the binary by name at runtime).
 */

import { createHash } from "node:crypto";
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const MPV_REPO = "zhongfly/mpv-winbuild";
const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "filmsnaps-desktop-build",
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const mpvDir = join(__dirname, "..", "vendor", "mpv");
const mpvExe = join(mpvDir, "mpv.exe");

async function downloadTo(url, destPath) {
  const res = await fetch(url, { headers: GITHUB_HEADERS, redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}) for ${url}`);
  }
  await pipeline(res.body, createWriteStream(destPath));
}

/** Recursively locate `name` under dir — returns its absolute path or null. */
function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

async function main() {
  if (existsSync(mpvExe)) {
    console.log(`[download-mpv] mpv.exe found at ${mpvExe} — skipping download`);
    return;
  }

  if (process.platform !== "win32") {
    console.error(
      `\n[download-mpv] mpv.exe not found at ${mpvExe}\n` +
        `Auto-download is Windows-only. Download mpv for your platform manually\n` +
        `and place the binary at apps/desktop/vendor/mpv/.\n`,
    );
    process.exit(1);
  }

  console.log(`[download-mpv] mpv.exe not found — downloading from ${MPV_REPO}…`);

  const release = await fetch(
    `https://api.github.com/repos/${MPV_REPO}/releases/latest`,
    { headers: GITHUB_HEADERS },
  ).then((r) => {
    if (!r.ok) throw new Error(`GitHub API failed (${r.status})`);
    return r.json();
  });

  // Generic x86_64 build: "mpv-x86_64-<date>-git-<sha>.7z" (8 digits right
  // after the arch excludes the "-v3" AVX2 variant).
  const asset = (release.assets ?? []).find((a) =>
    /^mpv-x86_64-\d{8}-git-[0-9a-f]+\.7z$/.test(a.name),
  );
  if (!asset) {
    throw new Error(
      `No mpv-x86_64 asset in the latest ${MPV_REPO} release — check https://github.com/${MPV_REPO}/releases`,
    );
  }

  // Temp workspace — fresh dir per run, cleaned up at the end.
  const workDir = mkdtempSync(join(tmpdir(), "filmsnaps-mpv-"));
  const archivePath = join(workDir, asset.name);
  const extractDir = join(workDir, "extract");
  mkdirSync(extractDir, { recursive: true });

  try {
    console.log(`[download-mpv] Downloading ${asset.name} (${Math.round(asset.size / 1024 / 1024)} MB)…`);
    await downloadTo(asset.browser_download_url, archivePath);

    // Integrity: match against the release's own sha256.txt.
    const shaAsset = (release.assets ?? []).find((a) => a.name === "sha256.txt");
    if (shaAsset) {
      const shaFile = join(workDir, "sha256.txt");
      await downloadTo(shaAsset.browser_download_url, shaFile);
      const expected = createHash("sha256")
        .update(readFileSync(archivePath))
        .digest("hex");
      const lines = readFileSync(shaFile, "utf8").split(/\r?\n/);
      const line = lines.find((l) => l.trimEnd().endsWith(asset.name));
      const want = line?.split(/\s+/)[0]?.toLowerCase();
      if (want && expected !== want) {
        throw new Error(
          `SHA-256 mismatch for ${asset.name}: got ${expected.slice(0, 16)}…, expected ${want.slice(0, 16)}…`,
        );
      }
      console.log("[download-mpv] SHA-256 verified");
    }

    // Extract — Windows bsdtar reads 7z. Use the FULL System32 path: on Git
    // Bash, PATH can resolve GNU tar first, which cannot read 7z.
    const systemTar = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    const tarBin = existsSync(systemTar) ? systemTar : "tar";
    const tar = spawnSync(tarBin, ["-xf", archivePath, "-C", extractDir], {
      stdio: "pipe",
    });
    if (tar.status !== 0) {
      throw new Error(
        `Extraction failed (${tar.stderr?.toString().trim().slice(0, 200)}).\n` +
          `Install 7-Zip and re-run, or extract ${asset.name} manually into apps/desktop/vendor/mpv/`,
      );
    }

    const exe = findFile(extractDir, "mpv.exe");
    if (!exe) {
      throw new Error("mpv.exe not found inside the archive — unexpected layout");
    }

    // Install ONLY mpv.exe — the archives ship doc/installer/updater cruft
    // (~3× the binary size) that the app never touches, and electron-builder
    // bundles the whole vendor/mpv directory into the installer.
    mkdirSync(mpvDir, { recursive: true });
    cpSync(exe, mpvExe);

    if (!existsSync(mpvExe)) {
      throw new Error(`Copy failed — ${mpvExe} still missing`);
    }
    console.log(`[download-mpv] mpv.exe installed at ${mpvExe}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function createReadStreamHash() {
  // Small helper kept sync-simple: the archive is ~60MB, readFileSync into the
  // hasher avoids stream plumbing for a one-shot build step.
  const { readFileSync } = require("node:fs");
  return createHash("sha256").update(readFileSync(archivePath)).digest("hex");
}

main().catch((e) => {
  console.error(`\n[download-mpv] FAILED: ${e?.message ?? e}`);
  console.error(
    `Manual fallback: download mpv for Windows from\n` +
      `  https://github.com/${MPV_REPO}/releases\n` +
      `and extract mpv.exe into apps/desktop/vendor/mpv/\n`,
  );
  process.exit(1);
});