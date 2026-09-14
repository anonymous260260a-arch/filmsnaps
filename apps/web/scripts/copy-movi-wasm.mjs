/**
 * Copy movi-player's WASM engine into /public so the slim element bundle can
 * stream it at runtime via the `wasmurl="/movi.wasm"` attribute.
 *
 * The slim build resolves the asset itself only when it sits next to the JS
 * bundle — inside a Next.js bundle that path is /_next/static/chunks/, so we
 * host it as a public asset instead. The desktop shell serves /public files
 * through the same app:// protocol handler as everything else, and the
 * deployed site serves them statically — one attribute works in both.
 *
 * Idempotent: copies only when the destination is missing or stale, so it is
 * safe to run on every build/dev.
 */
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

let src;
try {
  // The package exports map exposes the wasm directly ("./movi.wasm").
  src = require.resolve("movi-player/movi.wasm");
} catch {
  console.error("[copy-movi-wasm] movi-player is not installed — run pnpm install first.");
  process.exit(1);
}

const destDir = join(webRoot, "public");
const dest = join(destDir, "movi.wasm");

const sameSize = () => {
  try {
    return statSync(dest).size === statSync(src).size;
  } catch {
    return false;
  }
};

if (sameSize()) {
  console.log("[copy-movi-wasm] public/movi.wasm already up to date");
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[copy-movi-wasm] copied movi.wasm (${statSync(src).size} bytes) → public/`);
