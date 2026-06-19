/**
 * Extract the YouTube trailer key from TMDB video results.
 */
export function getTrailerKey(videos?: {
  results?: { key: string; name: string; site: string; type: string }[];
}): string | undefined {
  return videos?.results?.find(
    (v) => v.type === 'Trailer' && v.site === 'YouTube',
  )?.key;
}
