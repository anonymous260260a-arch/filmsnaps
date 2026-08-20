/**
 * CLI: key generation + config signing for the v5 split config.
 *
 * Usage (from packages/filter-compiler):
 *   node dist/sign-config-cli.js gen-key          # create .keys/ keypair
 *   node dist/sign-config-cli.js sign             # sign repo providers.json -> .sig
 *   node dist/sign-config-cli.js verify           # verify providers.json.sig
 *   node dist/sign-config-cli.js gen-key --force  # overwrite existing keypair
 *
 * The private key must live ONLY in CI secrets / the local dev machine.
 * Commit the .pub file; the app embeds/verifies against it.
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateKeyPair,
  signConfigFile,
  verifyConfigFile,
  REPO_KEY_DIR,
  PUBLIC_KEY_PATH,
  PRIVATE_KEY_PATH,
} from "./sign-config.js";
import { loadBlocklistConfig, validateConfig } from "@filmsnaps/adblock-config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");

function genKey(force = false): void {
  if (existsSync(PRIVATE_KEY_PATH) && !force) {
    console.error(`[sign] Private key already exists: ${PRIVATE_KEY_PATH}`);
    console.error(
      "[sign] Use --force to overwrite (invalidates all prior signatures).",
    );
    process.exit(1);
  }
  mkdirSync(REPO_KEY_DIR, { recursive: true });
  const { privateKey, publicKey } = generateKeyPair();
  writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
  writeFileSync(PUBLIC_KEY_PATH, publicKey, { mode: 0o644 });
  console.log(`[sign] Generated Ed25519 keypair in ${REPO_KEY_DIR}`);
  console.log(
    `[sign]   private: ${PRIVATE_KEY_PATH}  (gitignored — keep secret!)`,
  );
  console.log(`[sign]   public:  ${PUBLIC_KEY_PATH}   (commit this)`);
}

function sign(): void {
  if (!existsSync(PRIVATE_KEY_PATH)) {
    console.error(
      "[sign] No private key. Run `node dist/sign-config-cli.js gen-key` first.",
    );
    process.exit(1);
  }
  const providersPath = join(REPO_ROOT, "providers.json");
  if (!existsSync(providersPath)) {
    console.error(
      `[sign] ${providersPath} not found. Create providers.json first.`,
    );
    process.exit(1);
  }

  // Structural validation gate: refuse to sign an invalid config.
  const cfg = loadBlocklistConfig(providersPath);
  if (!cfg) {
    console.error("[sign] providers.json did not parse as a config object.");
    process.exit(1);
  }
  const result = validateConfig(cfg);
  if (!result.valid) {
    console.error(
      "[sign] providers.json FAILED validation — refusing to sign:",
    );
    for (const e of result.errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  for (const w of result.warnings) console.warn(`  ⚠ ${w}`);
  console.log("[sign] providers.json passed structural validation.");

  const sig = signConfigFile(providersPath, PRIVATE_KEY_PATH);
  console.log(`[sign] Signed providers.json -> ${providersPath}.sig`);
  console.log(`[sign]   base64 signature (${sig.length} chars)`);
}

function verify(): void {
  const providersPath = join(REPO_ROOT, "providers.json");
  if (!existsSync(PUBLIC_KEY_PATH)) {
    console.error("[sign] No public key committed. Run gen-key first.");
    process.exit(1);
  }
  const ok = verifyConfigFile(providersPath, PUBLIC_KEY_PATH);
  console.log(`[sign] providers.json.sig verify: ${ok ? "OK ✓" : "FAILED ✗"}`);
  process.exit(ok ? 0 : 1);
}

const [cmd, maybeFlag] = process.argv.slice(2);
switch (cmd) {
  case "gen-key":
    genKey(maybeFlag === "--force");
    break;
  case "sign":
    sign();
    break;
  case "verify":
    verify();
    break;
  default:
    console.log(`[sign] Usage:
  node dist/sign-config-cli.js gen-key [--force]
  node dist/sign-config-cli.js sign
  node dist/sign-config-cli.js verify`);
    process.exit(1);
}
