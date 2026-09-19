/**
 * Web wrapper around the canonical stream selector
 * (packages/shared/src/providers/streamSelector.ts).
 *
 * Platform responsibilities only:
 *   - resolve connectivity via navigator.connection (sync)
 *   - resolve the cached speed-test result (localStorage, sync)
 *   - keep `bestIndex` as an index into the ORIGINAL links array (the shared
 *     selector returns the canonical chain with the champion at index 0)
 * The ranking algorithm itself lives in shared and is identical on mobile.
 */

import {
  rankStreams,
  CDN_SUSTAIN_FACTOR,
  DEFAULT_SPEED_MBPS,
} from "@filmsnaps/shared";
import type {
  SelectOptions,
  StreamSelection,
  StreamLink,
} from "@filmsnaps/shared";

// Re-export the full selector surface so existing imports keep working.
export {
  rankStreams,
  effectiveQuality,
  sizeOf,
  parseLinkLanguages,
  parseLanguages,
  extractCDN,
  isDownloadOnlyLink,
  isCamPrint,
  isDemotedHost,
  linkContainerLabel,
  getLanguageSection,
  QUALITY_ORDER,
  CDN_RANK,
} from "@filmsnaps/shared";
export type { LinkLanguage, PreferredLanguage } from "@filmsnaps/shared";

/** Web's historical name for a selectable stream — same shape as StreamLink. */
export type StreamEntry = StreamLink;

// ── Network speed (cached, non-blocking) ──────────────────────────

function getCachedSpeed(): number | null {
  try {
    const raw = localStorage.getItem("@filmsnaps/network-speed");
    if (!raw) return null;
    const data = JSON.parse(raw) as {
      speed: number;
      timestamp: number;
      type: string;
    };
    if (Date.now() - data.timestamp > 24 * 60 * 60 * 1000) {
      localStorage.removeItem("@filmsnaps/network-speed");
      return null;
    }
    return data.speed;
  } catch {
    return null;
  }
}

function getNetwork(): { isCellular: boolean; speedMbps?: number } {
  let isCellular = false;
  try {
    const conn = (navigator as any).connection;
    if (conn?.type === "wifi" || conn?.type === "ethernet") isCellular = false;
    else if (
      conn?.type === "cellular" ||
      conn?.type === "slow-2g" ||
      conn?.type === "2g" ||
      conn?.type === "3g" ||
      conn?.type === "4g"
    )
      isCellular = true;
  } catch {}
  const speed = getCachedSpeed() ?? (isCellular ? 4 : DEFAULT_SPEED_MBPS);
  return { isCellular, speedMbps: speed * CDN_SUSTAIN_FACTOR };
}

/**
 * Smart source selection — synchronous (navigator.connection + localStorage
 * speed cache are both sync, so this stays usable inside useMemo).
 */
export function selectBestStream(
  links: StreamEntry[],
  options: SelectOptions = {},
): StreamSelection {
  const { isCellular, speedMbps } = getNetwork();
  const selection = rankStreams(links, { ...options, isCellular, speedMbps });
  // Remap the champion onto the caller's original array ordering.
  const bestIndex = selection.bestLink
    ? links.findIndex((l) => l.id === selection.bestLink!.id)
    : 0;
  return { ...selection, bestIndex: bestIndex >= 0 ? bestIndex : 0 };
}

// ── Source Remembering (localStorage) ─────────────────────────────

const SOURCE_STORAGE_KEY = "@filmsnaps/last-source/v1";
const SOURCE_TTL_DAYS = 30;

export function rememberWorkingSource(
  mediaType: string,
  tmdbId: string,
  url: string,
): void {
  try {
    const key = `${SOURCE_STORAGE_KEY}:${mediaType}:${tmdbId}`;
    const urlKey = url.split("?")[0]; // Strip query string (presigned tokens expire)
    localStorage.setItem(key, JSON.stringify({ urlKey, at: Date.now() }));
  } catch {}
}

export function getLastWorkingSource(
  mediaType: string,
  tmdbId: string,
): string | null {
  try {
    const key = `${SOURCE_STORAGE_KEY}:${mediaType}:${tmdbId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as { urlKey: string; at: number };
    if (Date.now() - data.at > SOURCE_TTL_DAYS * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(key);
      return null;
    }
    return data.urlKey;
  } catch {
    return null;
  }
}

export function forgetWorkingSource(mediaType: string, tmdbId: string): void {
  try {
    const key = `${SOURCE_STORAGE_KEY}:${mediaType}:${tmdbId}`;
    localStorage.removeItem(key);
  } catch {}
}

/**
 * If a link was remembered as working but is now failing, forget it.
 */
export function forgetIfRemembered(
  mediaType: string,
  tmdbId: string,
  url: string,
  rememberedKey: string | null,
): void {
  if (!rememberedKey) return;
  const urlKey = url.split("?")[0];
  if (urlKey === rememberedKey) {
    forgetWorkingSource(mediaType, tmdbId);
  }
}
