#!/usr/bin/env node
/**
 * copy-koffi.mjs — copy koffi from monorepo root into local node_modules
 * so electron-builder can bundle it (pnpm hoists it to root, outside the
 * app directory — electron-builder refuses files from outside the app dir).
 */
import { existsSync, cpSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const localNm = join(__dirname, "..", "node_modules", "koffi");
const rootNm = join(__dirname, "..", "..", "..", "node_modules", "koffi");

if (existsSync(localNm)) {
  console.log("[copy-koffi] local node_modules/koffi already exists — skipping");
  process.exit(0);
}

if (!existsSync(rootNm)) {
  console.error("[copy-koffi] koffi not found at", rootNm);
  process.exit(1);
}

mkdirSync(join(__dirname, "..", "node_modules"), { recursive: true });
cpSync(rootNm, localNm, { recursive: true });
console.log(`[copy-koffi] copied koffi from ${rootNm} → ${localNm}`);
