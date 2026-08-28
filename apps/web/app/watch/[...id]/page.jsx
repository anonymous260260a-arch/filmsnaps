import React from "react";
import WatchClient from "./WatchClient";
import { tmdb } from "@/lib/tmdb.server";
import { headers } from "next/headers";

const Page = async ({ params, searchParams }) => {
  const { id } = await params;
  const [plat, contentid] = id;

  const sp = await searchParams;
  const hdrs = await headers();
  const userAgent = hdrs.get("user-agent") || "";
  // Desktop (Electron) → default nxsha, Web → default cinemaos.
  // Anime-profiled sessions default to MegaPlay — its builders need the
  // MAL/AniList IDs, not TMDB ones. "Anime" = explicit origin (?mid=/?aid=)
  // OR the heuristic (Animation genre + Japanese original language), which
  // matches the client's isAnimeSession rule so the default agrees with the
  // provider allowlist (MegaPlay/Screenscape/Nxsha).
  const isDesktop = userAgent.includes("Electron");
  const animeOrigin = Boolean(sp.mid || sp.aid);

  let meta;
  let initialSeasonData = null;
  let initialSeason = 1;
  let initialEpisode = 1;
  if (plat === "tv") {
    // Speculate the season so the two TMDB fetches run in parallel —
    // season 1 is the overwhelmingly common first-view season. When the
    // season is pinned via URL, trust it.
    const speculatedSeason = sp.season ? parseInt(sp.season) : 1;
    const [metaRes, seasonRes] = await Promise.all([
      tmdb(`/${plat}/${contentid}`),
      tmdb(`/tv/${contentid}/season/${speculatedSeason}`),
    ]);
    meta = metaRes;

    // Reconcile: the true first non-zero season is known only after meta
    // resolves. If it differs from the speculation (rare) and no season was
    // pinned, do a corrective fetch so the initial view is always correct.
    const trueFirstSeason =
      meta?.seasons?.find((s) => s.season_number > 0)?.season_number ?? 1;
    if (!sp.season && trueFirstSeason !== speculatedSeason) {
      initialSeason = trueFirstSeason;
      initialSeasonData = await tmdb(
        `/tv/${contentid}/season/${trueFirstSeason}`,
      );
    } else {
      initialSeason = speculatedSeason;
      initialSeasonData = seasonRes;
    }
    initialEpisode = sp.episode ? parseInt(sp.episode) : 1;
  } else {
    meta = await tmdb(`/${plat}/${contentid}`);
  }

  const isAnimeMeta =
    Boolean(meta?.genres?.some?.((g) => g.id === 16)) &&
    meta?.original_language === "ja";
  const defaultProvider =
    animeOrigin || isAnimeMeta
      ? "megaplay"
      : isDesktop
        ? "nxsha"
        : "screenscape";
  // Explicit route provider (a deep link or server switch) wins over the
  // platform/anime default. The user's Settings → Default Source preference
  // is layered in client-side (WatchClient) so it can sit between the two.
  const routeProvider = sp.provider || null;

  return (
    <WatchClient
      contentid={contentid}
      plat={plat}
      initialMeta={meta}
      initialSeasonData={initialSeasonData}
      defaultProvider={defaultProvider}
      routeProvider={routeProvider}
      minimal={sp.minimal === "1"}
      initialSeason={initialSeason}
      initialEpisode={initialEpisode}
      initialResumeT={sp.t ? parseInt(sp.t, 10) : undefined}
      initialMalId={sp.mid ? parseInt(sp.mid, 10) : undefined}
      initialAnilistId={sp.aid ? parseInt(sp.aid, 10) : undefined}
    />
  );
};

export default Page;
