/**
 * Intro/Outro/Recap segment detection via introdb.app API.
 *
 * Fetches community-sourced intro timestamps using IMDB ID + season/episode.
 * Used for "Skip Intro" and "Skip Recap" buttons in the player overlay.
 */

const INTRODB_API_BASE = 'https://api.introdb.app';

export interface IntroSegment {
  start_sec: number;
  end_sec: number;
  start_ms: number;
  end_ms: number;
  confidence: number;
  submission_count: number;
  updated_at: string;
}

export interface IntroDbResponse {
  imdb_id: string;
  season: number;
  episode: number;
  intro: IntroSegment | null;
  recap: IntroSegment | null;
  outro: IntroSegment | null;
}

/**
 * Minimum confidence threshold to show skip button (0–1).
 * introdb.app returns 1.0 for well-submitted segments, lower for sparse data.
 */
const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Number of seconds before the segment starts to show the skip button.
 */
const LEAD_IN_SECONDS = 3;

/**
 * Number of seconds after the segment ends to hide the button.
 */
const LEAD_OUT_SECONDS = 3;

/**
 * Fetch intro/outro segment data for a specific TV episode.
 *
 * @param imdbId - The show's IMDB ID (e.g. "tt0903747")
 * @param season - Season number
 * @param episode - Episode number
 * @returns The intro/outro/recap segment data, or null if unavailable
 */
export async function fetchIntroSegments(
  imdbId: string,
  season: number,
  episode: number,
): Promise<IntroDbResponse | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(
      `${INTRODB_API_BASE}/segments?imdb_id=${encodeURIComponent(imdbId)}&season=${season}&episode=${episode}`,
      { signal: controller.signal },
    );
    clearTimeout(timeoutId);

    if (!res.ok) {
      if (res.status === 404) return null; // No data for this episode
      console.warn('[IntroDetect] HTTP ' + res.status + ' for ' + imdbId + ' S' + season + 'E' + episode);
      return null;
    }

    const data: IntroDbResponse = await res.json();
    return data;
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      console.warn('[IntroDetect] Timeout for ' + imdbId + ' S' + season + 'E' + episode);
    } else {
      console.warn('[IntroDetect] Error: ' + (e?.message ?? String(e)));
    }
    return null;
  }
}

/**
 * Check whether a segment is usable (meets confidence threshold).
 */
export function isSegmentUsable(segment: IntroSegment | null | undefined): segment is IntroSegment {
  if (!segment) return false;
  return segment.confidence >= CONFIDENCE_THRESHOLD && segment.end_sec > segment.start_sec;
}

/**
 * Get the active segment whose window the current time falls in.
 * Returns the segment + a label if within the show-window, null otherwise.
 */
export function getActiveSkipSegment(
  segments: IntroDbResponse | null,
  currentTime: number,
): { segment: IntroSegment; label: string } | null {
  if (!segments) return null;

  // Check recap first (usually comes before intro)
  if (isSegmentUsable(segments.recap)) {
    const r = segments.recap;
    if (currentTime >= r.start_sec - LEAD_IN_SECONDS && currentTime < r.end_sec + LEAD_OUT_SECONDS) {
      return { segment: r, label: 'Skip Recap' };
    }
  }

  // Check intro
  if (isSegmentUsable(segments.intro)) {
    const i = segments.intro;
    if (currentTime >= i.start_sec - LEAD_IN_SECONDS && currentTime < i.end_sec + LEAD_OUT_SECONDS) {
      return { segment: i, label: 'Skip Intro' };
    }
  }

  // Check outro (near the end)
  if (isSegmentUsable(segments.outro)) {
    const o = segments.outro;
    if (currentTime >= o.start_sec - LEAD_IN_SECONDS && currentTime < o.end_sec + LEAD_OUT_SECONDS) {
      return { segment: o, label: 'Skip Outro' };
    }
  }

  return null;
}
