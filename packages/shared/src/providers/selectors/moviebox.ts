/**
 * MovieBox (PenguPlay) selector — one pool, five upstreams.
 *
 * PenguPlay answers with whatever servers carry the title: MovieBox,
 * Anikoto, VAPlayer, Miruro and 4KHDHub. The canonical ranker orders that
 * pool by language → fit → quality → size/CDN, and this selector keeps ALL
 * of that and inserts the upstream preference where it is safe to do so:
 *
 *   1. Demoted hosts last (as the canonical chain does).
 *   2. Upstream priority — MovieBox first (the source this provider exists
 *      for), then Anikoto, Miruro, 4KHDHub, and VAPlayer at the very back.
 *      Primary within the pool: a MovieBox stream is never outranked by
 *      another upstream, and VAPlayer is outranked by every other source
 *      (owner request — VAPlayer is a generic WEB-DL mirror).
 *   3. User language — decides the CHAMPION inside one upstream: rows
 *      carrying the preferred language (or Multi) first, then rows with no
 *      language info at all (original/unknown audio), then other languages.
 *      The 🎧 line (`_meta.audioLanguage`) counts, so a "Hindi" row whose
 *      release name says nothing still wins for a Hindi-preferred user.
 *      "auto" keeps the shared section order (multi → hindi → english → other).
 *   4. Language section — the picker's grouping, as a refinement of 3.
 *   5. Direct before proxied — some rows stream through PenguPlay's
 *      `pengu.uk/direct/external/*` hop. A proxied row a direct CDN row
 *      already covers (same or better language standing) sinks below EVERY
 *      direct row — the proxy only stays up when it is the pool's sole
 *      source for that audio ("the only original audio is proxied").
 *      Proxied files under 95 MB are promo/sample clips, not the real
 *      content — they rank dead last, reached only when nothing above
 *      them works.
 *   6. Size class vs the connection cap — a link the connection can carry
 *      beats a bigger one, whatever its quality.
 *   7. Quality tier — 1080p before 720p inside the same class.
 *   8. The canonical chain's own order — every verdict this does not model
 *      (cam prints, size, web-playable container, CDN rank, HEVC) stays
 *      intact as the final tiebreak, because the input is base.sortedLinks.
 */
import type { StreamLink } from "../sources/types";
import type { SelectOptions, StreamSelection } from "../streamSelector";
import {
  QUALITY_ORDER,
  effectiveQuality,
  getLanguageSection,
  isDemotedHost,
  parseLinkLanguages,
  selectBestStream,
  sizeOf,
} from "../streamSelector";
import type { DirectStreamSelector } from "./types";

/** Pengu upstreams, best first — VAPlayer deliberately last. */
const SOURCE_PRIORITY: Record<string, number> = {
  moviebox: 0,
  anikoto: 1,
  miruro: 2,
  "4khdhub": 3,
  vaplayer: 4,
};

/** `_meta.source` is the full 🛰️ label ("Anikoto · Sub") — rank by server. */
function sourceRank(link: StreamLink): number {
  const server = (link._meta?.source ?? "")
    .split(/[·•]/)[0]
    .trim()
    .toLowerCase();
  return SOURCE_PRIORITY[server] ?? 9;
}

/** Picker section order: preferred language, then multi/hindi/english/other. */
function sectionRank(section: string): number {
  if (section.startsWith("Your language")) return 0;
  if (section === "Multi audio") return 1;
  if (section === "Hindi") return 2;
  if (section === "English") return 3;
  return 4;
}

function qualityRank(link: StreamLink): number {
  const idx = (QUALITY_ORDER as readonly string[]).indexOf(
    effectiveQuality(link),
  );
  return idx >= 0 ? idx : QUALITY_ORDER.length;
}

/** Languages this row carries: release-name tokens + the 🎧 audio word. */
function rowLanguages(link: StreamLink): Set<string> {
  const out = new Set<string>(parseLinkLanguages(link.name));
  const spoken = (link._meta?.audioLanguage ?? "").trim().toLowerCase();
  if (spoken) out.add(spoken);
  return out;
}

/**
 * User language decides the champion inside one upstream:
 *   0 — carries the preferred language (or Multi, which carries everything)
 *   2 — no language info at all (original/unknown audio — watchable by anyone)
 *   3 — some other language
 * "auto" keeps the shared section order (multi → hindi → english → other).
 */
function languageRank(
  link: StreamLink,
  preferred: SelectOptions["preferredLanguage"],
  section: number,
): number {
  if (preferred === "auto" || !preferred) return section;
  const langs = rowLanguages(link);
  if (langs.has(preferred) || langs.has("multi")) return 0;
  if (langs.size === 0) return 2;
  return 3;
}

/**
 * PenguPlay's `pengu.uk/direct/external/*` hop proxies the file; a CDN URL
 * (sacdn.hakunaymatata.com, …) streams directly — prefer the direct one.
 */
function isProxied(link: StreamLink): boolean {
  return /^https?:\/\/([^/]*\.)?pengu\.uk\//i.test(link.url ?? "");
}

/**
 * Proxied files under 95 MB are PenguPlay promo/sample clips, not the real
 * content — they stay in the pool but rank dead last (MiB, matching the
 * app's "94 MB" display: 98 818 056 bytes = 94 MiB).
 */
const TINY_PROXY_BYTES = 95 * 1024 * 1024;

export async function selectMovieBoxStreams(
  links: StreamLink[],
  options: SelectOptions,
): Promise<StreamSelection> {
  const base = await selectBestStream(links, options);
  const preferred = options.preferredLanguage ?? "auto";
  const capBytes = base.capBytes;
  const position = new Map<StreamLink, number>();
  base.sortedLinks.forEach((link, i) => position.set(link, i));

  const sizeClass = (link: StreamLink): number => {
    const bytes = sizeOf(link);
    if (bytes <= 0) return 2; // unknown size ranks after known sizes
    return bytes <= capBytes ? 0 : 1;
  };

  // Language standing per row + the best standing any DIRECT row holds.
  // A proxied row a direct row already covers sinks below every direct row;
  // a proxied row that is the pool's SOLE source for its audio stays up.
  const langRankOf = (l: StreamLink) =>
    languageRank(l, preferred, sectionRank(getLanguageSection(l, preferred)));
  let minDirectLangRank = Infinity;
  for (const l of base.sortedLinks) {
    if (!isProxied(l)) {
      minDirectLangRank = Math.min(minDirectLangRank, langRankOf(l));
    }
  }

  /** 0 = normal · 1 = proxied but a direct row covers it · 2 = proxied < 95 MB. */
  const bucketOf = new Map<StreamLink, number>();
  for (const l of base.sortedLinks) {
    let bucket = 0;
    if (isProxied(l)) {
      const bytes = sizeOf(l);
      if (bytes > 0 && bytes < TINY_PROXY_BYTES) bucket = 2;
      else if (langRankOf(l) >= minDirectLangRank) bucket = 1;
    }
    bucketOf.set(l, bucket);
  }

  const ranked = [...base.sortedLinks].sort((a, b) => {
    // Proxy demotion first: tiny promo dead last, covered proxies below
    // every direct row — before source/language so it cannot be undone.
    const ba = bucketOf.get(a) ?? 0;
    const bb = bucketOf.get(b) ?? 0;
    if (ba !== bb) return ba - bb;

    const da = isDemotedHost(a) ? 1 : 0;
    const db = isDemotedHost(b) ? 1 : 0;
    if (da !== db) return da - db;

    // Upstream first: MovieBox ahead of everything, VAPlayer behind it all.
    const xa = sourceRank(a);
    const xb = sourceRank(b);
    if (xa !== xb) return xa - xb;

    // User language decides the champion inside this upstream.
    const sa = sectionRank(getLanguageSection(a, preferred));
    const sb = sectionRank(getLanguageSection(b, preferred));
    const la = languageRank(a, preferred, sa);
    const lb = languageRank(b, preferred, sb);
    if (la !== lb) return la - lb;

    if (sa !== sb) return sa - sb;

    // Direct CDN before the pengu.uk proxy hop, at equal standing.
    const pa = isProxied(a) ? 1 : 0;
    const pb = isProxied(b) ? 1 : 0;
    if (pa !== pb) return pa - pb;

    const ca = sizeClass(a);
    const cb = sizeClass(b);
    if (ca !== cb) return ca - cb;

    const qa = qualityRank(a);
    const qb = qualityRank(b);
    if (qa !== qb) return qa - qb;

    return (position.get(a) ?? 0) - (position.get(b) ?? 0);
  });

  const champion = ranked[0] ?? null;
  return {
    ...base,
    sortedLinks: ranked,
    // Keep bestLink/bestIndex/selectionReason consistent with the new order
    // — the platform auto-selects the champion, not sortedLinks[bestIndex].
    bestLink: champion ?? base.bestLink,
    bestIndex: 0,
    selectionReason: champion
      ? `${champion.name} — ${champion._meta?.source ?? "?"}`
      : base.selectionReason,
  };
}

export const movieboxSelector: DirectStreamSelector = {
  id: "moviebox",
  select: selectMovieBoxStreams,
};
