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
