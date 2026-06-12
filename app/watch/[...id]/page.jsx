import React from 'react';
import WatchClient from './WatchClient';
import { tmdb } from '@/lib/tmdb.server';

const Page = async ({ params }) => {
  const { id } = await params;
  const [plat, contentid] = id;

  // Initial Server Fetch
  const meta = await tmdb(`/${plat}/${contentid}`);

  let initialSeasonData = null;
  if (plat === 'tv') {
    // Default to the first available season number
    const firstSeasonNum = meta.seasons?.[0]?.season_number ?? 1;
    initialSeasonData = await tmdb(`/tv/${contentid}/season/${firstSeasonNum}`);
  }

  return (
    <WatchClient
      contentid={contentid}
      plat={plat}
      initialMeta={meta}
      initialSeasonData={initialSeasonData}
    />
  );
};

export default Page;
