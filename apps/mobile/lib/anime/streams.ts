/**
 * JustAnime on-device fetcher — the anime-exclusive mirror of
 * directStreams.fetchRegistryProviderLinks. Deliberately isolated so the
 * movie/TV pipeline (directStreams.ts / streamPrefetch.ts /
 * useDirectStreamPipeline.ts) never sees justanime links.
 *
 * Fetching is keyed purely by MAL id + MAL-relative episode — the TMDB/IMDB
 * machinery of the movie pipeline is not involved. Resolution goes through the
 * shared registry's streamSources[] (core.justanime.to, one entry per server)
 * and resolveStreams(), which parses each server response into sub+dub links.
 *
 * Two entry points:
 *  - fetchAnimeStreams(): the FULL pool, fetched in parallel and awaited —
 *    used by background warmers (next-episode, re-warm) where the trade-off is
 *    acceptable.
 *  - fetchAnimeSourceStreams(): ONE source, independently — the watch page
 *    fires all three so the first responder seeds playback while the rest
 *    stream into the source list.
 */
import {
  buildStreamSourceUrl,
  getProvider,
  resolveStreams,
  type StreamSourceConfig,
} from "@filmsnaps/shared";
import type { StreamLink } from "../../components/player/streamTypes";
import type { IntroDbResponse, IntroSegment } from "../introDetect";

export const ANIME_PROVIDER_ID = "justanime";

/** fetch() with a hard timeout (RN's AbortSignal has no static .timeout()). */
export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchAnimeStreamsParams {
  /** MAL id of the title (resolveShow/resolveMovie output). */
  malId: number;
  /** MAL-relative episode number (1 for movies). */
  episode: number;
  providerId?: string;
}

/** One server's worth of the raw pool (provider-tagged sub+dub links). */
export interface AnimeSourceResult {
  sourceId: string;
  links: StreamLink[];
  error?: string;
}

/** The context resolveStreams hands to each source fetch. */
type ResolveContext = {
  imdbId: string;
  tmdbId?: number;
  malId?: number;
  mediaType: "movie" | "tv";
  season?: number;
  episode?: number;
};

/** Fetch + hard-parse one source, logging the raw body head for diagnostics. */
async function fetchSourceJson(
  source: StreamSourceConfig,
  ctx: ResolveContext,
  malId: number,
  episode: number,
  providerId: string,
): Promise<unknown> {
  const url = buildStreamSourceUrl(source, ctx);
  if (!url) throw new Error(`source ${source.id} has no urlTemplate`);
  const res = await fetchWithTimeout(url, source.timeoutMs ?? 10_000, {
    headers: { Accept: "application/json", ...(source.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status}${res.status === 403 ? " (Referer/Origin rejected?)" : ""}`,
    );
  }
  const text = await res.text();
  console.log(
    `[Anime] raw ${providerId}/${source.id} (MAL ${malId} e${episode}): ${text.slice(0, 220)}${text.length > 220 ? ` …(${text.length}b)` : ""}`,
  );
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `non-JSON body (${text.length}b, head: ${text.slice(0, 60).replace(/\s+/g, " ").slice(0, 60)}) — ${text.startsWith("<!doctype") ? "likely error page" : "unexpected shape"}`,
    );
  }
}

/** Tag every link with its provider so the player can recognize it. */
function tagProvider(links: StreamLink[], providerId: string): StreamLink[] {
  return links.map((l) => {
    const m = l._meta;
    return {
      ...l,
      _meta: m
        ? { ...m, providerId }
        : {
            codec: "unknown",
            audio: "unknown",
            source: "",
            isDownloadOnly: false,
            isWebReady: true,
            providerId,
          },
    };
  });
}

/** The ids of this provider's enabled streamSources, in registry order. */
export function getAnimeSourceIds(
  providerId: string = ANIME_PROVIDER_ID,
): string[] {
  const def = getProvider(providerId);
  return (
    def?.streamSources?.filter((s) => s.enabled !== false).map((s) => s.id) ??
    []
  );
}

/**
 * Fetch the raw JustAnime pool (sub + dub links, merged across all servers)
 * for one MAL-relative episode, awaiting every source. Used by the background
 * warmers; the watch page prefers fetchAnimeSourceStreams (progressive).
 * Never throws: upstream failures surface as an empty array.
 */
export async function fetchAnimeStreams({
  malId,
  episode,
  providerId = ANIME_PROVIDER_ID,
}: FetchAnimeStreamsParams): Promise<StreamLink[]> {
  const def = getProvider(providerId);
  if (!def?.streamSources || def.streamSources.length === 0) {
    console.log(`[Anime] fetch ${providerId}: no streamSources — aborting`);
    return [];
  }

  const result = await resolveStreams(
    {
      streamSources: def.streamSources,
      imdbId: "",
      malId,
      // JustAnime's path is /api/watch/{malId}/episode/{ep}/<server> for both
      // movies and series (MAL movies are episode 1) — routing everything
      // through the tv template keeps {episode} replacement in one place.
      mediaType: "tv",
      season: 1,
      episode,
      mergeStrategy: "concat",
    },
    (source, ctx) => fetchSourceJson(source, ctx, malId, episode, providerId),
  );

  for (const f of result.failedSources) {
    console.log(
      `[Anime] fetch ${providerId}/${f.id} (MAL ${malId} e${episode}): ${f.error}`,
    );
  }
  const byAudio: Record<string, number> = { sub: 0, dub: 0 };
  let subCount = 0;
  for (const l of result.links) {
    const a = l._meta?.audio;
    if (a === "sub" || a === "dub") byAudio[a] += 1;
    if ((l._meta?.subtitles?.length ?? 0) > 0) subCount += 1;
  }
  console.log(
    `[Anime] fetch ${providerId} (MAL ${malId} e${episode}): ${result.links.length} links (sub=${byAudio.sub} dub=${byAudio.dub}, ${subCount} with sidecar subs) from [${result.fetchedSources.join(", ") || "none"}]`,
  );

  return tagProvider(result.links, providerId);
}

/**
 * Fetch a single streamSource's pool independently. Resolves as soon as that
 * one server answers — no waiting on the other two. The watch hook fires one
 * call per source and seeds playback from the first caption-carrying response.
 */
export async function fetchAnimeSourceStreams({
  malId,
  episode,
  providerId = ANIME_PROVIDER_ID,
  sourceId,
}: {
  malId: number;
  episode: number;
  providerId?: string;
  sourceId: string;
}): Promise<AnimeSourceResult> {
  const def = getProvider(providerId);
  const source = def?.streamSources?.find((s) => s.id === sourceId);
  if (!source) {
    return {
      sourceId,
      links: [],
      error: `streamSource '${sourceId}' not registered for ${providerId}`,
    };
  }
  try {
    const result = await resolveStreams(
      {
        streamSources: [source],
        imdbId: "",
        malId,
        mediaType: "tv",
        season: 1,
        episode,
        mergeStrategy: "concat",
      },
      (s, ctx) => fetchSourceJson(s, ctx, malId, episode, providerId),
    );
    const links = tagProvider(result.links, providerId);
    if (links.length === 0) {
      return {
        sourceId,
        links: [],
        error: result.failedSources[0]?.error ?? "no streams for this title",
      };
    }
    return { sourceId, links };
  } catch (err) {
    return {
      sourceId,
      links: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Convert JustAnime's upstream per-episode `intro`/`outro` ([start, end]
 * seconds) into the native skip-button shape (IntroDbResponse). Upstream
 * segments are authoritative — confidence is pinned to 1 so isSegmentUsable
 * accepts them. Returns null when neither segment is present/valid.
 */
export function introDbFromUpstream(
  meta: StreamLink["_meta"] | undefined,
  season: number,
  episode: number,
): IntroDbResponse | null {
  const toSeg = (
    range: [number, number] | null | undefined,
  ): IntroSegment | null => {
    if (
      !range ||
      range.length !== 2 ||
      !Number.isFinite(range[0]) ||
      !Number.isFinite(range[1]) ||
      range[1] <= range[0]
    ) {
      return null;
    }
    return {
      start_sec: range[0],
      end_sec: range[1],
      start_ms: Math.round(range[0] * 1000),
      end_ms: Math.round(range[1] * 1000),
      confidence: 1,
      submission_count: 0,
      updated_at: "",
    };
  };
  const intro = toSeg(meta?.intro);
  const outro = toSeg(meta?.outro);
  if (!intro && !outro) return null;
  return { imdb_id: "", season, episode, intro, recap: null, outro };
}
