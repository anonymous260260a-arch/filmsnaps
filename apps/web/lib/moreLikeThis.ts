/**
 * "More Like This" payload selection for web detail pages.
 *
 * TMDB's /recommendations engine is what the TMDB website renders, and what
 * reads as dramatically better than the older /similar. The detail fetch
 * already appends BOTH (shared tmdb.ts); this helper picks recommendations
 * when present and falls back to similar for thin catalogs. Same policy as
 * the mobile detail pages.
 */
export interface MediaListPayload {
  page?: number;
  total_pages?: number;
  total_results?: number;
  results?: Array<Record<string, unknown>>;
}

export function pickMoreLikeThis<T extends MediaListPayload>(
  data: { recommendations?: T | null; similar?: T | null } | null | undefined,
): T | null {
  if (!data) return null;
  const recs = data.recommendations;
  if (recs?.results && recs.results.length > 0) return recs;
  return data.similar ?? null;
}
