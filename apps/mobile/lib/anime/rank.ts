/**
 * JustAnime's lightweight ranker — deliberately small, isolated from the
 * movie/TV ranker (streamSelector + per-provider selectors). Anime links are
 * a handful of per-server HLS/mp4s with no size metadata, so the taste here
 * is simple and stable:
 *
 *   1. audio track match — "sub" = Subbed links, "dub" = Dubbed links
 *   2. subtitle carrying — a link whose server listed vtt subtitles wins
 *      (anime captions ship as sidecars, not embedded HLS tracks)
 *   3. server preference — megaplay (HLS) > zokoanime (HLS) > animegg (mp4s).
 *      The HLS servers open in ~1-2s and carry clean captions; the animegg mp4s
 *      take 10-60s to initialize, so they rank last regardless of quality.
 *   4. quality descending — explicit 1080p > 720p > … ; "auto" last
 *   5. stable — input order preserved within a tie
 *
 * The champion is always index 0 ("bestIndex: 0"); there is no dead-probe
 * strike — the native player surfaces a dead head via its own error path.
 */
import type { StreamLink } from "../../components/player/streamTypes";

export type AnimeAudio = "sub" | "dub";

export interface AnimeRankResult {
  sortedLinks: StreamLink[];
  selectionReason: string;
  bestIndex: number;
}

/** Parse a quality label to a comparable number ("1080p" → 1080, "auto" → -1). */
function qualityNumeric(q: string | undefined): number {
  if (!q) return -1;
  const m = String(q).match(/(\d{3,4})p/i);
  return m ? Number(m[1]) : -1;
}

/**
 * Narrow a raw pool to one audio track. The JustAnime picker shows the chosen
 * language only — a sub session lists sub links, a dub session lists dub links.
 */
export function filterByAudio(
  links: StreamLink[],
  audio: AnimeAudio,
): StreamLink[] {
  return links.filter((l) => l._meta?.audio === audio);
}

/** Server preference — the HLS servers rank way above the slow mp4 server. */
function serverTier(source: string | undefined): number {
  if (!source) return 1;
  if (source.includes("megaplay")) return 2;
  if (source.includes("zoko")) return 1;
  return 0;
}

export function rankAnimeLinks(
  input: StreamLink[],
  audio: AnimeAudio,
): AnimeRankResult {
  if (input.length === 0) {
    return { sortedLinks: [], selectionReason: "no anime links", bestIndex: 0 };
  }

  const sorted = [...input].sort((a, b) => {
    const aAudio = a._meta?.audio;
    const bAudio = b._meta?.audio;
    const aMatch = aAudio === audio ? 1 : 0;
    const bMatch = bAudio === audio ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;

    const aSubs = (a._meta?.subtitles?.length ?? 0) > 0;
    const bSubs = (b._meta?.subtitles?.length ?? 0) > 0;
    if (aSubs !== bSubs) return bSubs ? 1 : -1;

    const aTier = serverTier(a._meta?.source);
    const bTier = serverTier(b._meta?.source);
    if (aTier !== bTier) return bTier - aTier;

    return qualityNumeric(b.quality) - qualityNumeric(a.quality);
  });

  console.log(
    `[Anime] rank ${audio}: ${input.length} in → head=${sorted[0]?.name ?? "none"} (${sorted
      .map((l) => l.quality)
      .join(", ")
      .slice(0, 80)})`,
  );

  const subs = sorted.some((l) => (l._meta?.subtitles?.length ?? 0) > 0)
    ? " · subtitles first"
    : "";
  return {
    sortedLinks: sorted,
    selectionReason: `justanime · ${audio} preferred${subs}`,
    bestIndex: 0,
  };
}
