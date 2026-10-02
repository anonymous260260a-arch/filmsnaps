/**
 * anonId — a RANDOM per-install identifier for the anonymous statistics.
 *
 * What it is:
 *   - A v4-format UUID generated with Math.random values, created ONCE per
 *     app install and stored in AsyncStorage alongside the rest of the
 *     app's own settings/history.
 *   - NOT derived from any device hardware ID, OS advertising ID, IP,
 *     or account (there are none). It cannot be matched to a person;
 *     it only lets the dashboard tell "3 installs" apart from "1 install
 *     sending 3× the events".
 *
 * Lifecycle (privacy contract):
 *   - Created lazily the first time the analytics gate OPENS
 *     (legalAccepted AND analyticsEnabled).
 *   - DELETED from storage when the user turns statistics off
 *     (Settings → Anonymous usage statistics) — the next enable generates
 *     a fresh, unrelated ID, so old aggregates can never be re-linked.
 *   - Clearing app data (uninstall) removes it like everything else.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const ANON_ID_KEY = "telemetry:anonId:v1";

/** Format enforced server-side too: 36-char UUID-shaped, nothing else. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let cachedAnonId: string | null = null;
let initPromise: Promise<void> | null = null;

function randomHex(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

/** v4-shaped UUID (random). Not used for anything but grouping aggregates. */
function generateAnonId(): string {
  return (
    `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-` +
    `${"89ab"[Math.floor(Math.random() * 4)]}${randomHex(3)}-${randomHex(12)}`
  );
}

/**
 * Sync the anon ID with the analytics gate. Call whenever the gate state
 * changes (settings hydrate / legal accept / toggle flip):
 *   enabled=true  → load-or-create the ID (cached in memory for the
 *                   synchronous enqueue path)
 *   enabled=false → DELETE it (fresh unrelated ID on next enable)
 */
export function initAnonId(analyticsEnabled: boolean): Promise<void> {
  if (!analyticsEnabled) {
    initPromise = null;
    cachedAnonId = null;
    return AsyncStorage.removeItem(ANON_ID_KEY).catch(() => {});
  }
  if (cachedAnonId) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      let stored = await AsyncStorage.getItem(ANON_ID_KEY);
      if (!stored || !UUID_RE.test(stored)) {
        // First enable (or corrupt/foreign value) — mint a fresh ID.
        stored = generateAnonId();
        await AsyncStorage.setItem(ANON_ID_KEY, stored);
      }
      cachedAnonId = stored;
    } catch {
      // Storage unavailable — events send without anonId (server allows null).
      cachedAnonId = null;
    }
  })();
  return initPromise;
}

/**
 * The current anonymous ID, or null before the gate has opened / after the
 * user disabled statistics. Envelope-level only; never a dim.
 */
export function getAnonId(): string | null {
  return cachedAnonId && UUID_RE.test(cachedAnonId) ? cachedAnonId : null;
}

/** Test hook. */
export function resetAnonIdForTests(): void {
  cachedAnonId = null;
  initPromise = null;
}
