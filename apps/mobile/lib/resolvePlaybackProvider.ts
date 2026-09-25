/**
 * Canonical which-direct-provider resolution for playback + prefetch.
 *
 * Precedence (product requirement — flag if this reorders intentional behavior):
 *   1. route param      — explicit ?provider= share/deep link
 *   2. session pick     — user manually chose a server this session
 *   3. settings.defaultServer — saved "default server"
 *   4. lastProvider     — last direct provider that served this title (CW)
 *   5. platform default — auto/unset resolves to "direct" (HDHub); anime → megaplay
 *
 * NOTE: settings.defaultServer now outranks lastProvider. The previous details
 * path used last → saved → default (CW restore beat the setting). If CW
 * "bring me back" must stay stronger than the setting, flip tiers 3 and 4 here
 * and in resolvePlaybackProviderId call sites — do not silently restore the
 * old order at one call site only.
 *
 * Returns null from the async wrapper when the resolved provider is NOT a
 * direct provider (an embed default) — there is no direct pool to prefetch.
 */
import {
  getProvider,
  getDefaultProviderId,
  isDirectProvider,
  type ProviderPlatform,
} from "@filmsnaps/shared";
import { getLastProvider } from "./lastProvider";

export interface PlaybackProviderQuery {
  /** Explicit route/share param (wins over everything). */
  routeProvider?: string | null;
  /** User pick this session (watch server sheet) — beats saved/last. */
  sessionPick?: string | null;
  /** settings.defaultServer */
  savedServer?: string | null;
  /** Per-title last-used direct provider (CW restore) — tier 4. */
  lastProvider?: string | null;
  platform?: ProviderPlatform;
  anime?: boolean;
}

function isValidCandidate(id: string | null | undefined): string | null {
  if (!id) return null;
  const def = getProvider(id);
  return def ? def.id : null;
}

export interface ResolvedPlaybackProvider {
  providerId: string;
  tier: "route" | "session" | "saved" | "last" | "default";
}

/** Sync core: resolve with all tiers already in hand (returns id only). */
export function resolvePlaybackProviderIdCore(q: PlaybackProviderQuery): string {
  return resolvePlaybackProviderIdTiered(q).providerId;
}

/** Sync core + which tier supplied the winner (for [watchperf] logs). */
export function resolvePlaybackProviderIdTiered(
  q: PlaybackProviderQuery,
): ResolvedPlaybackProvider {
  const platform = q.platform ?? "mobile";
  const candidates: Array<[string | null | undefined, ResolvedPlaybackProvider["tier"]]> = [
    [q.routeProvider, "route"],
    [q.sessionPick, "session"],
    [q.savedServer, "saved"],
    [q.lastProvider, "last"],
  ];
  for (const [id, tier] of candidates) {
    const valid = isValidCandidate(id);
    if (valid) return { providerId: valid, tier };
  }
  return {
    providerId: getDefaultProviderId(platform, { anime: q.anime }),
    tier: "default",
  };
}

export interface PlaybackProviderRequest {
  mediaType: "movie" | "tv";
  tmdbId: number;
  routeProvider?: string | null;
  sessionPick?: string | null;
  savedServer?: string | null;
  platform?: ProviderPlatform;
  anime?: boolean;
}

/**
 * Async wrapper: loads lastProvider for this title, then resolves.
 * Returns null when the winner is not a direct provider (skip prefetch).
 */
export async function resolvePlaybackProviderId(
  req: PlaybackProviderRequest,
): Promise<string | null> {
  const platform = req.platform ?? "mobile";
  const last = await getLastProvider(req.mediaType, req.tmdbId, platform);
  const resolved = resolvePlaybackProviderIdTiered({
    routeProvider: req.routeProvider,
    sessionPick: req.sessionPick,
    savedServer: req.savedServer,
    lastProvider: last,
    platform,
    anime: req.anime,
  });
  const def = getProvider(resolved.providerId);
  return def && isDirectProvider(def) ? resolved.providerId : null;
}
