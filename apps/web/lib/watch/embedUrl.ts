/**
 * Embed URL construction for the watch page.
 *
 * Pure registry-driven URL building — no React, no platform calls.
 * Direct providers (type: "direct") intentionally return "" — their media
 * URL is resolved at runtime through their own API (/api/player/direct).
 */
import { getResumeMode, isDirectProvider } from "@filmsnaps/shared";
import type { ProviderDefinition } from "@filmsnaps/shared";

/** Resolved MegaPlay identity for this (title, season, episode). */
export interface MegaContext {
  malId: number | null;
  aniId: number | null;
  /** Episode number in MegaPlay's ID space (offset-adjusted when mapped). */
  episode: number;
}

export function buildEmbedUrl(
  provider: ProviderDefinition,
  contentid: string,
  plat: "movie" | "tv",
  selectedSeason: number,
  activeEpisode: number,
  resumeT?: number,
  mega?: { idSpace: "mal" | "ani"; id: number; episode: number } | null,
  audio: "sub" | "dub" = "sub",
): string {
  // Direct-video providers resolve their media URL at runtime through their
  // own API (/api/player/direct, falix) — there is no embed URL to build.
  if (isDirectProvider(provider)) return "";

  // Providers that natively honor a resume param are strictly better than a
  // post-load JS seek — thread the saved position into the embed URL when the
  // provider exposes that capability (expert verdict §3 / action item 3).
  const startAt =
    resumeT && resumeT > 0 && getResumeMode(provider) === "url"
      ? Math.floor(resumeT)
      : undefined;

  // Anime-only providers NEVER take the TMDB contentid — without a resolved
  // identity there is no URL at all (caller shows the loading/exhausted state).
  if (provider.animeOnly) {
    if (!mega) return "";
    return `${provider.baseUrl}${
      plat === "tv"
        ? provider.embed.tv(
            String(mega.id),
            selectedSeason,
            mega.episode,
            startAt,
            {
              idSpace: mega.idSpace,
              audio,
            },
          )
        : provider.embed.movie(String(mega.id), startAt, {
            idSpace: mega.idSpace,
            audio,
          })
    }`;
  }

  const embedPath =
    plat === "tv"
      ? provider.embed.tv(contentid, selectedSeason, activeEpisode, startAt)
      : provider.embed.movie(contentid, startAt);

  return `${provider.baseUrl}${embedPath}`;
}
