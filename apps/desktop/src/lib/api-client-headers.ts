/**
 * FilmSnaps Desktop — API client identification headers
 *
 * Injects x-client / x-app-version / x-anon-id on requests to the Filmsnaps
 * API (Cloudflare Worker) ONLY. Never attached to third-party requests
 * (providers, CDNs, upstream APIs) — the URL filter below is the guarantee.
 *
 * x-anon-id is a RANDOM per-install UUID stored in userData (same model as
 * legal-accepted.json): not derived from hardware, account, or IP. It exists
 * only so the server can tell "3 installs" apart from "1 install sending
 * 3x the requests".
 */

import { app } from "electron";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

let cachedInstallId: string | null = null;

function installId(): string {
  if (cachedInstallId) return cachedInstallId;
  const path = join(app.getPath("userData"), "client-id.json");
  try {
    if (existsSync(path)) {
      const raw = readFileSync(path, "utf-8");
      const stored = JSON.parse(raw)?.id;
      if (typeof stored === "string" && stored.length >= 8) {
        cachedInstallId = stored;
        return cachedInstallId;
      }
    }
  } catch {
    // fall through to mint a fresh id
  }
  cachedInstallId = randomUUID();
  try {
    writeFileSync(
      path,
      JSON.stringify({ id: cachedInstallId }, null, 2),
      "utf-8",
    );
  } catch {
    // best-effort persistence; a fresh id is minted per launch otherwise
  }
  return cachedInstallId;
}

function desktopVersion(): string {
  return app.getVersion() || "0.0.0";
}

function isApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith(".workers.dev")) return true;
    const configured = process.env.FILMSNAPS_API_HOST;
    if (configured && host === configured.toLowerCase()) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Mutates requestHeaders with the identification headers when the request
 * targets the Filmsnaps API. Returns the (possibly unchanged) headers object.
 * Designed to be called from the shell's existing onBeforeSendHeaders slot —
 * Electron allows one listener per webRequest event per session.
 */
export function stampApiClientHeaders(
  url: string,
  requestHeaders: Record<string, string>,
): Record<string, string> {
  if (!isApiUrl(url)) return requestHeaders;
  requestHeaders["x-client"] = "desktop";
  requestHeaders["x-app-version"] = desktopVersion();
  requestHeaders["x-anon-id"] = installId();
  return requestHeaders;
}
