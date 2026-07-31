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
  // Desktop (Electron) → default nxsha, Web → default cinemaos
  const isDesktop = userAgent.includes("Electron");
  const defaultProvider = sp.provider || (isDesktop ? "nxsha" : "cinemaos");

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

  return (
    <WatchClient
      contentid={contentid}
      plat={plat}
      initialMeta={meta}
      initialSeasonData={initialSeasonData}
      defaultProvider={defaultProvider}
      minimal={sp.minimal === "1"}
      initialSeason={initialSeason}
      initialEpisode={initialEpisode}
    />
  );
};

export default Page;
