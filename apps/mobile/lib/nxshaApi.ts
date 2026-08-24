/**
 * Mobile-side nxsha API client. Talks to the web backend's proxy route
 * (app/api/player/nxsha/route.ts) which performs the encrypted nxsha request
 * server-side. Mobile ships NO crypto — the JS bundle stays OTA-only safe.
 *
 * On failure the caller falls back to the existing WebView CAPTCHA scrape.
 */

import { getApiBaseUrl } from "./api";
import type { NxshaServer } from "./nxshaLinks";

export interface NxshaApiResult {
  servers: NxshaServer[];
}

/**
 * Fetch nxsha download servers/links via the backend proxy.
 * @returns parsed servers, or null on any failure (caller uses WebView fallback)
 */
export async function fetchNxshaSources(params: {
  type: "movie" | "tv";
  id: string;
  season?: number;
  episode?: number;
}): Promise<NxshaServer[] | null> {
  const base = getApiBaseUrl();
  const qs = new URLSearchParams({
    type: params.type,
    id: params.id,
    season: String(params.season ?? 1),
    episode: String(params.episode ?? 1),
  });
  try {
    const res = await fetch(`${base}/api/player/nxsha?${qs.toString()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as NxshaApiResult;
    if (!json || !Array.isArray(json.servers)) return null;
    return json.servers;
  } catch {
    return null;
  }
}
