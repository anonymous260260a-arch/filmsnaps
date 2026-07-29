/**
 * Announcements — Lightweight announcement system backed by a remote JSON endpoint.
 *
 * Architecture:
 *   - Fetch announcements from a remote CDN/worker URL
 *   - Cache in AsyncStorage for instant load on subsequent opens
 *   - Never blocks UI — returns empty array on any error
 *   - Supports three types: feature, alert, info, critical
 *
 * To migrate to Firebase Remote Config later:
 *   1. Install @react-native-firebase/remote-config
 *   2. Replace fetchAnnouncements() with RemoteConfig().getString('announcements')
 *   3. JSON.parse the string and pass through the same schema validation
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Constants ──

const CACHE_KEY = "@filmsnaps/announcements/v1";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Types ──

export interface Announcement {
  /** Unique identifier (used for dismiss tracking) */
  id: string;
  /** Visual category: feature, alert, info, critical */
  type: "feature" | "alert" | "info" | "critical";
  /** Short headline (1 line, shown in banner) */
  title: string;
  /** Short description (2-3 lines, shown in banner) */
  subtitle: string;
  /** Optional — full body content for the detail page (array of text paragraphs) */
  body?: string[];
  /** Optional — URL to the announcement's detail route in the app */
  detailRoute?: string;
  /** Optional — external URL to open in browser */
  externalUrl?: string;
  /** Optional — date string for display (ISO 8601) */
  date?: string;
  /** Optional — emoji/icon name override (defaults based on type) */
  icon?: string;
  /** Optional — action button label on detail page */
  actionLabel?: string;
  /** Optional — whether the banner can be dismissed (default: true) */
  dismissible?: boolean;
  /** ISO timestamp after which this announcement expires */
  expiresAt?: string;
}

export interface AnnouncementResponse {
  announcements: Announcement[];
}

// ── Remote fetch URL (from env or fallback) ──

function getAnnouncementsUrl(): string {
  // Try the existing worker URL
  const baseUrl =
    process.env.EXPO_PUBLIC_WEB_URL ||
    "https://filmsnaps1.anonymous260260a.workers.dev";
  return `${baseUrl.replace(/\/$/, "")}/announcements.json`;
}

// ── Schema validation (defensive — never trust remote data) ──

function isValidAnnouncement(raw: unknown): raw is Announcement {
  if (!raw || typeof raw !== "object") return false;
  const a = raw as Record<string, unknown>;
  if (typeof a.id !== "string" || !a.id) return false;
  if (!["feature", "alert", "info", "critical"].includes(a.type as string))
    return false;
  if (typeof a.title !== "string" || !a.title) return false;
  return true;
}

function parseResponse(raw: unknown): Announcement[] {
  if (!raw || typeof raw !== "object") return [];
  const resp = raw as Record<string, unknown>;
  const list = resp.announcements;
  if (!Array.isArray(list)) return [];
  return list.filter(isValidAnnouncement);
}

// ── Cache helpers ──

interface CacheEntry {
  data: Announcement[];
  fetchedAt: number;
}

async function readCache(): Promise<CacheEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!Array.isArray(parsed?.data)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(data: Announcement[]): Promise<void> {
  try {
    const entry: CacheEntry = { data, fetchedAt: Date.now() };
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Silently fail — cache is best-effort
  }
}

// ── Filter expired announcements ──

function filterExpired(announcements: Announcement[]): Announcement[] {
  const now = Date.now();
  return announcements.filter((a) => {
    if (!a.expiresAt) return true;
    return new Date(a.expiresAt).getTime() > now;
  });
}

// ── Dismissed IDs ──

const DISMISSED_KEY = "@filmsnaps/announcements/dismissed/v1";

async function getDismissedIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr);
  } catch {
    return new Set();
  }
}

export async function dismissAnnouncement(id: string): Promise<void> {
  try {
    const dismissed = await getDismissedIds();
    dismissed.add(id);
    await AsyncStorage.setItem(
      DISMISSED_KEY,
      JSON.stringify(Array.from(dismissed)),
    );
  } catch {
    // Best-effort
  }
}

// ── Public API ──

/**
 * Fetch announcements with cache-first strategy.
 *
 * 1. Returns cached announcements immediately (if available & fresh)
 * 2. Background-fetches from remote and updates cache
 * 3. Returns empty array on any error (never throws)
 * 4. Filters out expired and dismissed announcements
 *
 * This ensures the user NEVER sees a blank/loading state for announcements.
 */
export async function fetchAnnouncements(options?: {
  force?: boolean;
  includeDismissed?: boolean;
}): Promise<Announcement[]> {
  let cacheHit = false;

  // 1. Try cache first
  if (!options?.force) {
    const cached = await readCache();
    if (cached) {
      const age = Date.now() - cached.fetchedAt;
      if (age < CACHE_TTL_MS) {
        cacheHit = true;
        const filtered = filterExpired(cached.data);
        if (!options?.includeDismissed) {
          const dismissed = await getDismissedIds();
          return filtered.filter((a) => !dismissed.has(a.id));
        }
        return filtered;
      }
    }
  }

  // 2. Fetch from remote
  try {
    const url = getAnnouncementsUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      // Fall back to stale cache if remote fails and we have one
      if (!cacheHit) {
        const stale = await readCache();
        if (stale) {
          const filtered = filterExpired(stale.data);
          if (!options?.includeDismissed) {
            const dismissed = await getDismissedIds();
            return filtered.filter((a) => !dismissed.has(a.id));
          }
          return filtered;
        }
      }
      return [];
    }

    const json: unknown = await res.json();
    const announcements = parseResponse(json);

    // Update cache
    await writeCache(announcements);

    const filtered = filterExpired(announcements);

    if (!options?.includeDismissed) {
      const dismissed = await getDismissedIds();
      return filtered.filter((a) => !dismissed.has(a.id));
    }

    return filtered;
  } catch {
    // Network error — use stale cache if available
    if (!cacheHit) {
      const stale = await readCache();
      if (stale) {
        const filtered = filterExpired(stale.data);
        if (!options?.includeDismissed) {
          const dismissed = await getDismissedIds();
          return filtered.filter((a) => !dismissed.has(a.id));
        }
        return filtered;
      }
    }
    return [];
  }
}
