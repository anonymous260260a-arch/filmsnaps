import React from 'react';
import WatchClient from './WatchClient';
import { tmdb } from '@/lib/tmdb.server';

const Page = async ({ params, searchParams }) => {
  const { id } = await params;
  const [plat, contentid] = id;

  // Initial Server Fetch
  const meta = await tmdb(`/${plat}/${contentid}`);

  const sp = await searchParams;

  let initialSeasonData = null;
  let initialSeason = 1;
  let initialEpisode = 1;
  if (plat === 'tv') {
    // If season is provided via URL param, fetch that; otherwise first non-zero season
    const requestedSeason = sp.season
      ? parseInt(sp.season)
      : (meta.seasons?.find(s => s.season_number > 0)?.season_number ?? 1);
    initialSeason = requestedSeason;
    initialEpisode = sp.episode ? parseInt(sp.episode) : 1;
    initialSeasonData = await tmdb(`/tv/${contentid}/season/${requestedSeason}`);
  }

  return (
    <WatchClient
      contentid={contentid}
      plat={plat}
      initialMeta={meta}
      initialSeasonData={initialSeasonData}
      defaultProvider={sp.provider}
      minimal={sp.minimal === '1'}
      initialSeason={initialSeason}
      initialEpisode={initialEpisode}
    />
  );
};

export default Page;
