/**
 * FilmSnaps Desktop — Legal Acceptance Persistence
 *
 * Stores whether the user has accepted the Legal & DMCA terms as a JSON
 * file in the app's userData directory (mirrors window-state.ts).
 *
 * Why main-process, not localStorage: the desktop app spawns the Next.js
 * standalone server on a RANDOM free port each launch
 * (http://127.0.0.1:<port>), and Chromium keys localStorage by origin
 * (scheme + host + port). That origin changes every restart, so renderer
 * localStorage would NOT survive a relaunch. A JSON file in userData is
 * origin-independent and persists for the life of the app profile.
 */

import { app } from "electron";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

function getStatePath(): string {
  return join(app.getPath("userData"), "legal-accepted.json");
}

/**
 * Whether the user has accepted the Legal & DMCA terms.
 * Defaults to `false` on missing file or read/parse error (safe path —
 * show the gate rather than skip it).
 */
export function getLegalAccepted(): boolean {
  try {
    const statePath = getStatePath();
    if (!existsSync(statePath)) return false;
    const raw = readFileSync(statePath, "utf-8");
    return JSON.parse(raw)?.accepted === true;
  } catch {
    return false;
  }
}

/**
 * Persist legal acceptance. Failures are swallowed so a disk error can
 * never crash the app; the user would simply see the gate again next run.
 */
export function setLegalAccepted(value: boolean): void {
  try {
    const statePath = getStatePath();
    writeFileSync(
      statePath,
      JSON.stringify(
        { accepted: value, acceptedAt: new Date().toISOString() },
        null,
        2,
      ),
      "utf-8",
    );
  } catch (err) {
    console.warn("[LegalAccept] Failed to save:", err);
  }
}
