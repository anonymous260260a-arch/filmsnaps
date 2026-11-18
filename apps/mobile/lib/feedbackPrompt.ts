/**
 * Decides when the in-app rating prompt appears.
 *
 * Rules, persisted in AsyncStorage (never sent anywhere):
 *   - nothing until the app has been running this code for 7 days — the
 *     stamp starts on the first launch after install or after the update
 *     that delivered the prompt, so nobody sees it on the delivery day;
 *   - if the user does not rate, it comes back after 14 days;
 *   - a second refusal is final — no third ask;
 *   - once rated, never again.
 *
 * The install date is stamped the first time this runs on a device, which is
 * the earliest launch we can observe without adding a new identifier.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "feedback:prompt:v2";
const INSTALL_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_REFUSALS = 2;

/**
 * Testing switch, off by default.
 *
 * While on, the prompt ignores every schedule gate (7-day install age, 14-day
 * retry, already rated, refusals) and appears on each app open, so the flow
 * can be exercised. Rated/refused outcomes are still recorded.
 *
 * It cannot ship: `__DEV__` is a build constant that Metro replaces with
 * `false` in every release bundle, so this is only ever true in a development
 * build and the forcing branch is dead code in production. Flipping
 * ENABLE_PROMPT_TESTING therefore only affects local testing.
 */
const ENABLE_PROMPT_TESTING = false;
const FORCE_SHOW_FOR_TESTING = __DEV__ && ENABLE_PROMPT_TESTING;

interface PromptState {
  installedTs: number;
  lastShownTs: number;
  refusals: number;
  ratedTs: number | null;
}

const DEFAULT_STATE: PromptState = {
  installedTs: 0,
  lastShownTs: 0,
  refusals: 0,
  ratedTs: null,
};

let cached: PromptState | null = null;
let loadPromise: Promise<PromptState> | null = null;

function sanitize(raw: unknown): PromptState {
  const s = (raw ?? {}) as Partial<PromptState>;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
  return {
    installedTs: num(s.installedTs, 0),
    lastShownTs: num(s.lastShownTs, 0),
    refusals: Math.floor(num(s.refusals, 0)),
    ratedTs: typeof s.ratedTs === "number" ? s.ratedTs : null,
  };
}

async function load(): Promise<PromptState> {
  if (cached) return cached;
  if (loadPromise) return loadPromise;
  loadPromise = AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (!raw) return DEFAULT_STATE;
      try {
        return sanitize(JSON.parse(raw));
      } catch {
        return DEFAULT_STATE;
      }
    })
    .catch(() => DEFAULT_STATE)
    .then((state) => {
      cached = state;
      return state;
    });
  return loadPromise;
}

async function persist(): Promise<void> {
  if (!cached) return;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // Storage unavailable — this session still follows the rules in memory.
  }
}

/**
 * Stamps the install date if needed and answers whether the prompt is due now.
 * Call once per cold start, after the legal gate has been accepted.
 */
export async function registerAppOpenAndShouldPrompt(
  now: number = Date.now(),
): Promise<boolean> {
  const s = await load();
  if (!s.installedTs) s.installedTs = now;

  if (FORCE_SHOW_FOR_TESTING) {
    s.lastShownTs = now;
    await persist();
    return true;
  }

  const due =
    now - s.installedTs >= INSTALL_AGE_MS &&
    s.ratedTs === null &&
    s.refusals < MAX_REFUSALS &&
    (s.lastShownTs === 0 || now - s.lastShownTs >= RETRY_MS);

  if (due) s.lastShownTs = now;
  await persist();
  return due;
}

export async function markPromptRated(now: number = Date.now()): Promise<void> {
  const s = await load();
  s.ratedTs = now;
  await persist();
}

export async function markPromptRefused(): Promise<void> {
  const s = await load();
  s.refusals += 1;
  await persist();
}
