/**
 * Client-side utility functions.
 * Small localStorage helpers that don't depend on LocalStorageAdapter.
 * Used by form components for cooldown, drafts, and session management.
 */

const LAST_SUBMIT_KEY = "@filmsnaps/feedback/last-submit";

/**
 * Check submission cooldown. Returns 0 if not on cooldown,
 * or the remaining milliseconds if still on cooldown.
 */
export function checkSubmissionCooldown(cooldownMs: number): number {
  if (typeof window === "undefined") return 0;
  try {
    const lastRaw = localStorage.getItem(LAST_SUBMIT_KEY);
    if (!lastRaw) return 0;
    const elapsed = Date.now() - parseInt(lastRaw, 10);
    return elapsed < cooldownMs ? cooldownMs - elapsed : 0;
  } catch {
    return 0;
  }
}

/**
 * Record a submission timestamp for cooldown tracking.
 */
export function setLastSubmit(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LAST_SUBMIT_KEY, String(Date.now()));
  } catch {}
}

/**
 * Save a draft to localStorage.
 */
export function saveDraft(key: string, data: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {}
}

/**
 * Load a draft from localStorage.
 */
export function loadDraft<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Remove a draft from localStorage.
 */
export function removeDraft(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {}
}
