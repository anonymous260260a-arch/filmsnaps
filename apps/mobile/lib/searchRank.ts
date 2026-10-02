/**
 * Search result re-ranking + shared quality helpers.
 *
 * Pure functions (no RN/network imports) so they run in vitest.
 *
 * Why a re-ranker: TMDB multi-search returns per-page results in a decent
 * but not title-first order — partial matches, no-art entries and 0-vote
 * junk interleave with the obvious hit, which reads as "search gives bad
 * results". The re-ranker scores every candidate on TITLE MATCH first
 * (exact > word-start > substring) with a popularity tiebreak, filters
 * no-art junk off page 1, and moves PEOPLE to a separate lane (person
 * cards are a different UI than title cards).
 */

export interface RankableSearchItem {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  poster_path?: string | null;
  profile_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
}

export interface RankedSearchSplit {
  /** Movies/TV — render as poster cards. */
  titles: RankableSearchItem[];
  /** People — render as person rows/cards. */
  people: RankableSearchItem[];
  /** True when every result was junk-filtered (likely a typo'd query). */
  allJunk: boolean;
}

/** Normalize for comparison: lowercase, strip accents/punctuation, collapse spaces. */
function normalizeTitle(s: string | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasArt(item: RankableSearchItem): boolean {
  if (item.media_type === "person") return !!item.profile_path;
  return !!item.poster_path;
}

/** How well the query matches this title (higher = better). */
export function titleMatchScore(
  query: string,
  item: RankableSearchItem,
): number {
  const q = normalizeTitle(query);
  if (!q) return 0;
  const candidates = [
    item.title,
    item.original_title,
    item.name,
    item.original_name,
  ]
    .map(normalizeTitle)
    .filter((t) => t.length > 0);
  if (candidates.length === 0) return 0;
  // Compare against the SHORTEST candidate (the most specific title) —
  // "Bubble" should match the movie, not rank against "Bubble Gum Girl".
  const t = candidates.reduce((a, b) => (b.length < a.length ? b : a));

  if (t === q) return 1; // exact (normalized)
  if (t.startsWith(q)) return 0.8; // word/phrase start
  const firstWord = q.split(" ")[0];
  if (new RegExp(`(^| )${firstWord}`).test(t)) return 0.6; // first word starts a word
  if (t.includes(q)) return 0.5; // contains
  if (q.split(" ").every((w) => t.includes(w))) return 0.4; // all words present
  // Any word overlap at all (ranked below non-matching-but-popular is wrong;
  // a tiny overlap still beats nothing).
  const overlap = q.split(" ").some((w) => w.length > 2 && t.includes(w));
  return overlap ? 0.1 : 0;
}

/**
 * Split + re-rank a raw multi-search page.
 *
 * - People are pulled out into `people` (caller renders its own lane).
 * - Junk (no poster art) is dropped UNLESS the whole page would empty —
 *   the one legit case is an obscure title without art.
 * - Rank: title match (dominant) × popularity (tiebreak), so the obvious
 *   hit lands first and partial matches sink below exact ones.
 */
export function rankSearchResults(
  query: string,
  results: RankableSearchItem[],
): RankedSearchSplit {
  const q = query.trim();
  const titles: RankableSearchItem[] = [];
  const people: RankableSearchItem[] = [];

  for (const r of results) {
    if (r.media_type === "person") {
      if (hasArt(r)) people.push(r);
      continue;
    }
    if (r.media_type !== "movie" && r.media_type !== "tv") continue;
    titles.push(r);
  }

  const scored = titles
    .map((item) => ({
      item,
      match: titleMatchScore(q, item),
      pop: Math.log10(1 + (item.popularity ?? 0)),
      votes: item.vote_count ?? 0,
    }))
    // Quality gate: no-art junk drops UNLESS the page would empty out.
    .filter((s) => hasArt(s.item) || s.match >= 1 || s.votes > 0);

  const withArt = scored.filter((s) => hasArt(s.item));
  // Drop no-art candidates when the page has art — EXCEPT exact matches,
  // which are exactly the obscure-but-real title the user typed.
  const rescuedExact = scored.filter((s) => !hasArt(s.item) && s.match >= 1);
  const kept = withArt.length > 0 ? [...withArt, ...rescuedExact] : scored;

  kept.sort((a, b) => {
    // Match dominates (×8); popularity breaks ties; vote count nudges.
    const sa = a.match * 8 + a.pop + Math.min(a.votes / 5000, 1);
    const sb = b.match * 8 + b.pop + Math.min(b.votes / 5000, 1);
    return sb - sa;
  });

  return {
    titles: kept.map((s) => s.item),
    people,
    allJunk: withArt.length === 0 && scored.length === 0,
  };
}
