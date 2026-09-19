/**
 * Spacedom selector — server-priority chain.
 *
 * SpaceDom's servers have a clear quality hierarchy the generic ranker can't
 * see (heron's links carry no size metadata, so "unknown size ranks last"
 * buries the BEST stream):
 *
 *   heron (original-quality mp4 file) → condor → kite → everything else
 *
 * All servers are fetched in parallel, so the pool is complete; this selector
 * only orders it. Ties within one server fall through to the generic ranker's
 * order (stable sort). Language preference and the connection cap still apply
 * through the base selection this reorders.
 */
import type { StreamLink } from "../sources/types";
import type { SelectOptions, StreamSelection } from "../streamSelector";
import { selectBestStream } from "../streamSelector";
import type { DirectStreamSelector } from "./types";

/** Lower = higher in the chain. Unlisted servers follow in pool order. */
const SERVER_RANK = ["heron", "condor", "kite"];

function serverRankOf(link: StreamLink): number {
  const idx = SERVER_RANK.indexOf(link._meta?.source ?? "");
  return idx >= 0 ? idx : SERVER_RANK.length;
}

export async function selectSpacedomStreams(
  links: StreamLink[],
  options: SelectOptions,
): Promise<StreamSelection> {
  const base = await selectBestStream(links, options);
  const ranked = [...base.sortedLinks].sort(
    (a, b) => serverRankOf(a) - serverRankOf(b),
  );
  const champion = ranked[0] ?? null;
  return {
    ...base,
    sortedLinks: ranked,
    bestIndex: 0,
    selectionReason: champion
      ? `SpaceDom · ${champion._meta?.source ?? "?"} first — ${base.selectionReason}`
      : base.selectionReason,
  };
}

export const spacedomSelector: DirectStreamSelector = {
  id: "spacedom",
  select: selectSpacedomStreams,
};
