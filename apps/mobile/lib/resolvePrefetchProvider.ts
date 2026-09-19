/**
 * Which direct provider should this title open with / prefetch?
 *
 * Precedence (mirrors the watch screen):
 *   1. last provider actually used for this title (CW "bring me back")
 *   2. the user's saved default server (settings.defaultServer)
 *   3. platform default — auto/unset resolves to "direct" (HDHub)
 *
 * Returns null when the resolved provider is NOT a direct provider (an
 * embed default) — there is no direct pool to prefetch for that session.
 */
import {
  getProvider,
  isDirectProvider,
  resolveInitialProviderId,
  type ProviderPlatform,
} from "@filmsnaps/shared";
import { getLastProvider } from "./lastProvider";

export async function resolvePrefetchProviderId(
  mediaType: "movie" | "tv",
  tmdbId: number,
  savedServer: string | null,
  platform: ProviderPlatform = "mobile",
): Promise<string | null> {
  const last = await getLastProvider(mediaType, tmdbId, platform);
  const resolvedId = resolveInitialProviderId({
    platform,
    routeProvider: last,
    savedServer,
  });
  const def = getProvider(resolvedId);
  return def && isDirectProvider(def) ? resolvedId : null;
}
