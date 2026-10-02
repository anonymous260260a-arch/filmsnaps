/**
 * Mobile wrapper around the canonical stream selector
 * (packages/shared/src/providers/streamSelector.ts).
 *
 * Platform responsibilities only:
 *   - resolve connectivity via NetInfo
 *   - resolve the cached speed-test result (AsyncStorage-backed)
 * The ranking algorithm itself lives in shared and is identical on web.
 */

import NetInfo from "@react-native-community/netinfo";
import { getCachedSpeed } from "./networkSpeedTest";
import {
  rankStreams,
  CDN_SUSTAIN_FACTOR,
  DEFAULT_SPEED_MBPS,
} from "@filmsnaps/shared";
import type { SelectOptions, StreamSelection } from "@filmsnaps/shared";
import type { StreamLink } from "../components/player/streamTypes";

// Re-export the full selector surface so existing imports keep working.
export {
  rankStreams,
  selectBestStream as selectBestStreamBase,
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
export type {
  LinkLanguage,
  PreferredLanguage,
  StreamSelection,
} from "@filmsnaps/shared";

export type { SelectOptions };

/** Resolve the sustained connection speed (Mbps, after CDN calibration). */
async function resolveNetwork(): Promise<{
  isCellular: boolean;
  speedMbps?: number;
}> {
  const netInfo = await NetInfo.fetch();
  const isCellular = netInfo.type === "cellular";
  const cachedSpeed = await getCachedSpeed();
  const speedMbps =
    cachedSpeed?.speedMbps ?? (isCellular ? 4 : DEFAULT_SPEED_MBPS);
  return { isCellular, speedMbps: speedMbps * CDN_SUSTAIN_FACTOR };
}

/** Main entry — instant (NetInfo + cached speed only, no probing). */
export async function selectBestStream(
  links: StreamLink[],
  options: SelectOptions = {},
): Promise<StreamSelection> {
  const { isCellular, speedMbps } = await resolveNetwork();
  return rankStreams(links, { ...options, isCellular, speedMbps });
}

/**
 * Display-only audio chip for MovieBox (PenguPlay) rows. The API's 🎧 line
 * ("Audio: Arabic" / "French" / "Tamil" …) is stored in `_meta.audioLanguage`
 * — a free-form word no shared name parser knows, so those rows rendered with
 * no language at all; when the upstream states none (or "unknown") the row is
 * the untouched original track. Gated to `providerId === "moviebox"` so every
 * other provider's rows keep their exact current labels (display only — this
 * must not feed ranking, sections, or filters).
 */
export function movieboxAudioLabel(link: StreamLink): string | null {
  if (link._meta?.providerId !== "moviebox") return null;
  const spoken = (link._meta?.audioLanguage ?? "").trim();
  if (spoken) return spoken.charAt(0).toUpperCase() + spoken.slice(1);
  // No 🎧 line / audio unknown (and the "original" tag) → the original track.
  return "Original Audio";
}
