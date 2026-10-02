/**
 * "More Like This" aggregation — PURE module (no RN/network imports) so it
 * runs in vitest and stays out of the React hook.
 *
 * The old implementation took the last watched title's top-2 genres and ran
 * a popularity-sorted genre discover — that returns "popular movies sharing
 * a genre" (a horror fan got romcoms), the #1 source of "bad results". The
 * fix aggregates TMDB's OWN /recommendations engine (what their website
 * renders) across the last few watched titles with recency weighting.
 */

/** Recency weight: newest seed ×1.0, then ×0.7, ×0.49 … */
export function recencyWeight(index: number): number {
  return Math.pow(0.7, index);
}

/** Quality gate — deliberately LIGHT: TMDB's engine already curates for
 *  relevance. A heavy gate pruned real recommendations and made the row
 *  emptier (and worse) than the TMDB site. This only removes true
 *  bottom-feeder junk. */
const MLT_QUALITY_FLOOR = 5.5;
const MLT_MIN_VOTES = 15;

/**
 * Build a deduped, recency-weighted, quality-gated "More Like This" pool
 * from per-seed recommendation lists.
 *
 * Scoring: TMDB's OWN ordering is the primary signal (earlier position =
 * more relevant — it's what their site renders), scaled by the seed's
 * recency, with a capped agreement bonus when multiple seeds push the same
 * title. No raw popularity term — it overrode TMDB's curation and dragged
 * the row toward generic-popular filler.
 *
 * Exported pure for testing.
 */
export function aggregateRecommendations(
  seedLists: Array<{
    seedId: number | string;
    seedIndex: number;
    results: any[];
  }>,
): any[] {
  const scores = new Map<
    number,
    { item: any; score: number; seedIndex: number }
  >();
  // Every watched seed is excluded (built up front — a candidate matching a
  // later seed must still be dropped when encountered in an earlier list).
  const exclude = new Set<number>(
    seedLists.map((l) => Number(l.seedId)).filter((n) => Number.isFinite(n)),
  );

  for (const list of seedLists) {
    list.results.forEach((r, position) => {
      const id = Number(r.id);
      if (!Number.isFinite(id) || exclude.has(id)) return;
      const w = recencyWeight(list.seedIndex);
      const positionScore = Math.max(0, 20 - position) / 20;
      const score = positionScore * w;
      const existing = scores.get(id);
      if (existing) {
        // Agreement: +60% of the strongest contributing score per extra seed.
        existing.score += score + existing.score * 0.6;
        if (list.seedIndex < existing.seedIndex) {
          existing.seedIndex = list.seedIndex;
          existing.item = r;
        }
      } else {
        scores.set(id, { item: r, score, seedIndex: list.seedIndex });
      }
    });
  }

  return [...scores.values()]
    .filter(
      (e) =>
        (e.item.vote_average ?? 0) >= MLT_QUALITY_FLOOR &&
        (e.item.vote_count ?? 0) >= MLT_MIN_VOTES,
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((e) => ({
      ...e.item,
      _mediaType: e.item.media_type ?? (e.item.first_air_date ? "tv" : "movie"),
      _mltScore: e.score,
    }));
}
