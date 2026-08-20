/**
 * Ed25519 signing/verification for the v5 split config.
 *
 * OTA integrity: the app must never apply a providers.json it did not
 * author. We sign the canonical JSON bytes with an Ed25519 private key kept
 * out of the shipped app; the app verifies against the embedded public key.
 *
 * - generateKeyPair(): create (privateKey, publicKey) — run once, keep the
 *   private key in CI secrets / local .keys/, commit ONLY the public key.
 * - signConfig(jsonPath | jsonBytes, privateKeyPath): produce
 *   providers.json.sig (base64 signature over the raw JSON bytes).
 * - verifySignature(jsonBytes, signatureB64, publicKeyPath): boolean.
 *
 * Canonical bytes = the exact bytes written to providers.json (we do NOT
 * re-stringify — a minified vs pretty-printed payload must not invalidate
 * the signature). Sign the raw file bytes.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  sign as cryptoSign,
  verify as cryptoVerify,
  generateKeyPairSync,
} from "node:crypto";

// NOTE: Ed25519 has NO digest. Use the one-shot crypto.sign/verify API with a
// null digest — it derives the algorithm from the key object. `createSign`/
// `createVerify` reject 'ed25519' as a digest name (ERR_CRYPTO_INVALID_DIGEST)
// on some Node builds, so we avoid them entirely.
//
// `key` may be a PEM string or a KeyObject; crypto.sign/verify accept both.

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Public API ────────────────────────────────────────────────────────

/** Generate a fresh Ed25519 keypair. Returns PEM-encoded keys. */
export function generateKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

/**
 * Sign the raw bytes of a JSON config file and write `<file>.sig`.
 * @param jsonPath path to providers.json (or any JSON config)
 * @param privateKeyPath path to the PEM Ed25519 private key
 * @returns base64 signature string
 */
export function signConfigFile(
  jsonPath: string,
  privateKeyPath: string,
): string {
  const json = readFileSync(jsonPath);
  const privateKey = readFileSync(privateKeyPath);
  // One-shot Ed25519 sign over the raw JSON bytes. null digest = derive from key.
  const signature = cryptoSign(null, json, privateKey).toString("base64");
  writeFileSync(`${jsonPath}.sig`, signature, "utf-8");
  return signature;
}

/**
 * Verify an Ed25519 signature over raw JSON bytes.
 * @param json bytes of the config file (as-written)
 * @param signatureB64 base64 signature (from `.sig`)
 * @param publicKeyPath path to the PEM Ed25519 public key
 */
export function verifySignature(
  json: Buffer,
  signatureB64: string,
  publicKeyPath: string,
): boolean {
  try {
    const publicKey = readFileSync(publicKeyPath);
    return cryptoVerify(
      null,
      json,
      publicKey,
      Buffer.from(signatureB64, "base64"),
    );
  } catch {
    return false;
  }
}

/** Verify from a file's own bytes + its `.sig` sibling. */
export function verifyConfigFile(
  jsonPath: string,
  publicKeyPath: string,
): boolean {
  if (!existsSync(`${jsonPath}.sig`)) return false;
  const json = readFileSync(jsonPath);
  const sig = readFileSync(`${jsonPath}.sig`, "utf-8");
  return verifySignature(json, sig, publicKeyPath);
}

/**
 * Convenience: sign the repo's providers.json and write providers.json.sig
 * in place. Run from the repo root after editing providers.json.
 */
export function signRepoConfig(privateKeyPath: string): string {
  const repoRoot = join(__dirname, "..", "..", "..");
  return signConfigFile(join(repoRoot, "providers.json"), privateKeyPath);
}

// ── Key management ────────────────────────────────────────────────────

/**
 * Resolve the repo's public key path (committed) — apps embed this.
 * The private key must NEVER be committed. Standard locations:
 *   .keys/filmsnaps-ed25519.pub  (committed)
 *   .keys/filmsnaps-ed25519.key  (gitignored — CI secret / local)
 */
export const REPO_KEY_DIR = join(__dirname, "..", "..", "..", ".keys");
export const PUBLIC_KEY_PATH = join(REPO_KEY_DIR, "filmsnaps-ed25519.pub");
export const PRIVATE_KEY_PATH = join(REPO_KEY_DIR, "filmsnaps-ed25519.key");
