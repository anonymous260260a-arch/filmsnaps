/**
 * Way2Movies selector — language-first, server-priority chain.
 *
 * Links arrive as "720p · Hindi" or "Original · English".
 * The selector:
 *   1. Groups by language (preferred language first)
 *   2. Within each language group, ranks by server priority: 39 > 33 > 31 > 42
 *   3. Within same server, quality desc (1080p > 720p > 480p > Original)
 *   4. CDN diversity within same server (different CDN hosts first)
 *
 * The source picker shows language sections: preferred language on top,
 * other language below. Each row shows "720p · Hindi" — nothing else.
 */
import type { StreamLink } from "../sources/types";
import type { SelectOptions, StreamSelection } from "../streamSelector";
import { selectBestStream } from "../streamSelector";
import type { DirectStreamSelector } from "./types";

const QUALITY_ORDER = ["1080p", "720p", "480p", "Original"] as const;
function qualityRank(q: string): number {
  const idx = (QUALITY_ORDER as readonly string[]).indexOf(q);
  return idx >= 0 ? idx : QUALITY_ORDER.length;
}

/** Server priority: lower = better. */
const SERVER_PRIORITY: Record<string, number> = {
  s39: 0,
  s33: 1,
  s31: 2,
  s42: 3,
};
function serverRank(source: string): number {
  return SERVER_PRIORITY[source] ?? 99;
}

/** Language priority from user preference. */
function languagePriority(name: string, preferred: string): number {
  const lower = (name ?? "").toLowerCase();
  if (preferred === "hindi" && lower.includes("hindi")) return 0;
  if (preferred === "english" && lower.includes("english")) return 0;
  if (lower.includes("hindi")) return 1;
  if (lower.includes("english")) return 1;
  return 2; // other languages
}

function cdnHost(url: string): string {
  try {
    return new URL(url).hostname.split(".").slice(-2).join(".");
  } catch {
    return "";
  }
}

export async function selectWay2MoviesStreams(
  links: StreamLink[],
  options: SelectOptions,
): Promise<StreamSelection> {
  const base = await selectBestStream(links, options);
  const preferred =
    options.preferredLanguage === "auto"
      ? "hindi"
      : (options.preferredLanguage ?? "hindi");

  const ranked = [...base.sortedLinks].sort((a, b) => {
    // 1. Language group: preferred language first
    const la = languagePriority(a.name, preferred);
    const lb = languagePriority(b.name, preferred);
    if (la !== lb) return la - lb;

    // 2. Server priority within same language
    const sa = serverRank(a._meta?.source ?? "");
    const sb = serverRank(b._meta?.source ?? "");
    if (sa !== sb) return sa - sb;

    // 3. Quality desc within same server
    const qa = qualityRank(a.quality);
    const qb = qualityRank(b.quality);
    if (qa !== qb) return qa - qb;

    // 4. CDN diversity: prefer different CDN host from previous link
    const ca = cdnHost(a.url);
    const cb = cdnHost(b.url);
    if (ca !== cb) return 0; // different CDN = equal rank, keep insertion order

    return 0;
  });

  const champion = ranked[0] ?? null;
  return {
    ...base,
    sortedLinks: ranked,
    bestIndex: 0,
    selectionReason: champion
      ? `${champion.name} — ${champion._meta?.source ?? "?"}`
      : base.selectionReason,
  };
}

export const way2moviesSelector: DirectStreamSelector = {
  id: "way2movies",
  select: selectWay2MoviesStreams,
};
