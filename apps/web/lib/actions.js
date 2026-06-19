'use server';
import { tmdb } from '@/lib/tmdb.server';

export async function getSeasonAction(contentid, seasonNumber) {
  return await tmdb(`/tv/${contentid}/season/${seasonNumber}`);
}
