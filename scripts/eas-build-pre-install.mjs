// EAS build hook (runs before dependency installation).
//
// EAS restores a cached node_modules across builds, but its cache key does not
// include patches/*. When patches/expo-video@55.0.18.patch changes, pnpm's
// recorded patch_hash no longer matches and it re-applies the patch IN PLACE
// over the already-patched cached copy -> ERR_PNPM_PATCH_FAILED and the build
// dies. Deleting the stale copies here forces pnpm to extract a pristine
// expo-video from the store and apply the patch cleanly (same as CI on a fresh
// machine). Runs only on EAS; local installs are untouched.
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
console.log(`[eas-build-pre-install] cwd=${process.cwd()} root=${repoRoot}`);

const staleTargets = [
  "node_modules/expo-video",
  "node_modules/.pnpm/expo-video",
  "apps/mobile/node_modules/expo-video",
];

for (const rel of staleTargets) {
  rmSync(join(repoRoot, rel), { recursive: true, force: true });
}

// Hoisted/hidden-store layouts keep versioned dirs like
// "expo-video@55.0.18(patch_hash=...)" — sweep those too.
const pnpmStoreDir = join(repoRoot, "node_modules/.pnpm");
if (existsSync(pnpmStoreDir)) {
  for (const entry of readdirSync(pnpmStoreDir)) {
    if (entry.startsWith("expo-video@")) {
      rmSync(join(pnpmStoreDir, entry), { recursive: true, force: true });
    }
  }
}

console.log("[eas-build-pre-install] cleared stale expo-video copies for a clean patch apply");
