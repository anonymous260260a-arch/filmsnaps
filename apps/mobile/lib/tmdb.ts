/**
 * TMDB anime exclusion (Hard Mode Split).
 *
 * Movie/TV mode must never surface Japanese anime in its home/search feeds.
 * TMDB tags anime as Animation (genre id 16) AND Japanese language. Requiring
 * BOTH isolates Japanese anime while leaving Western animation (Arcane,
 * Spider-Verse) in the movie/TV feed. Client-side, zero-latency, no network.
 *
 * Reference verdict (MOBILE-ANIME-ARCHITECTURE-CONSULTATION.md Q2): do NOT use
 * `without_genres=16` (drops wanted Western animation) and do NOT use the
 * anime-map.json id exclusion (leaks unmapped new titles).
 */

const ANIMATION_GENRE_ID = 16;

export function isTmdbAnime(item: {
  genre_ids?: number[];
  genres?: Array<{ id: number }>;
  original_language?: string;
}): boolean {
  const genreIds = item.genre_ids ?? (item.genres ?? []).map((g) => g.id);
  const isAnimation = genreIds.includes(ANIMATION_GENRE_ID);
  const isJapanese = item.original_language === "ja";
  return Boolean(isAnimation && isJapanese);
}

/** Drop anime from a TMDB result list (home/search). */
export function filterTmdbAnime<T>(items: T[]): T[] {
  return items.filter((item) => !isTmdbAnime(item as any));
}
