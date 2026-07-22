/**
 * MovieBox API Client — server-side proxy for moviebox.ph
 *
 * Ported from the MovieBox API Pro Python/FastAPI reference implementation.
 * Provides a full API client for browsing, searching, and streaming
 * content from moviebox.ph's backend (h5-api.aoneroom.com).
 *
 * The API works by:
 * 1. Auto-acquiring a guest JWT from the x-user response header
 * 2. Using that token for all subsequent requests
 * 3. The stream endpoint returns direct MP4 URLs from netfilm.world
 *    that can be played in a standard <video> element (H.264, no HEVC issues)
 *
 * This is an experimental integration — the API surface may change.
 */

// ── Constants ────────────────────────────────────────────────────────

const API_BASE = 'https://h5-api.aoneroom.com/wefeed-h5api-bff';

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  Referer: 'https://moviebox.ph/',
  Origin: 'https://moviebox.ph',
  'X-Client-Info': '{"timezone":"Asia/Dhaka"}',
  'X-Request-Lang': 'en',
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'cross-site',
};

const PLAYER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'X-Client-Info': '{"timezone":"Asia/Dhaka"}',
  'X-Source': '',
  'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
};

// ── Bearer Token (module-level cache — persists in dev mode) ─────────

let _bearerToken: string | null = null;

/**
 * Acquire or return the cached guest JWT.
 * Fetches /home and extracts the token from the x-user response header.
 */
async function getBearerToken(): Promise<string> {
  if (_bearerToken) return _bearerToken;

  const resp = await fetch(`${API_BASE}/home?host=moviebox.ph`, {
    headers: DEFAULT_HEADERS,
    cache: 'no-store',
  } as RequestInit);

  const xUser = resp.headers.get('x-user');
  if (xUser) {
    try {
      const parsed = JSON.parse(xUser);
      if (parsed.token) {
        _bearerToken = parsed.token;
        return parsed.token;
      }
    } catch {}
  }

  // Fallback: extract from Set-Cookie
  const cookie = resp.headers.get('set-cookie') || '';
  const match = cookie.match(/token=([^;]+)/);
  if (match) {
    _bearerToken = match[1];
  }

  return _bearerToken || '';
}

/**
 * Make an authenticated request to the MovieBox API.
 * Auto-refreshes the bearer token if the server sends a new one.
 */
async function makeRequest(
  url: string,
  method: 'GET' | 'POST' = 'GET',
  payload?: Record<string, unknown>,
  customHeaders?: Record<string, string>,
): Promise<any> {
  const token = await getBearerToken();
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(customHeaders || {}),
  };

  const fetchOpts: RequestInit = {
    method,
    headers,
    cache: 'no-store',
  } as RequestInit;

  if (method === 'POST' && payload) {
    fetchOpts.body = JSON.stringify(payload);
  }

  const resp = await fetch(url, fetchOpts);

  // Refresh token if server sends a new one
  const xUser = resp.headers.get('x-user');
  if (xUser) {
    try {
      const parsed = JSON.parse(xUser);
      if (parsed.token) {
        _bearerToken = parsed.token;
      }
    } catch {}
  }

  if (!resp.ok) {
    throw new Error(`MovieBox API error: ${resp.status} ${resp.statusText}`);
  }

  return resp.json();
}

// ── API Methods ──────────────────────────────────────────────────────

export interface MovieBoxBannerItem {
  name: string;
  poster_url: string;
  slug: string;
  subject_id: string;
  badge?: string;
}

export interface MovieBoxSection {
  section: string;
  count: number;
  items: MovieBoxBannerItem[];
}

export interface MovieBoxCatalogItem {
  name: string;
  poster_url: string;
  slug: string;
  subject_id: string;
  badge?: string;
  rating?: string;
  year?: string;
}

export interface MovieBoxStream {
  resolution: string;
  format: string;
  url: string;
  size: string;
  codec: string;
  duration: string;
}

export interface StreamResult {
  subject_id: string;
  se: number;
  ep: number;
  has_resource: boolean;
  sources: MovieBoxStream[];
  hls: any[];
  dash: any[];
  free_episodes?: number;
  limited: boolean;
  note: string | null;
}

export interface CaptionEntry {
  url: string;
  lang: string;
  format: string;
}

/**
 * Get home page sections (banners, recommended, trending).
 */
export async function getHome(): Promise<{ status: string; sections: MovieBoxSection[] }> {
  const url = `${API_BASE}/home?host=moviebox.ph`;
  const data = await makeRequest(url);

  const sections: MovieBoxSection[] = [];

  for (const op of data?.data?.operatingList || []) {
    const opType = op.type;
    const title = op.title || 'Featured';

    if (opType === 'BANNER') {
      const items: MovieBoxBannerItem[] = (op.banner?.items || [])
        .filter((item: any) => item.title && !item.title.includes('Communities'))
        .map((item: any) => ({
          name: item.title || item.subject?.title,
          poster_url: item.image?.url || item.subject?.cover?.url,
          slug: item.detailPath || item.subject?.detailPath,
          subject_id: item.subject?.subjectId,
          badge: item.subject?.corner,
        }));
      sections.push({ section: 'Banner', count: items.length, items });
    } else if (
      opType === 'SUBJECTS_MOVIE' ||
      opType === 'SUBJECTS_TV' ||
      opType === 'SUBJECTS_ANIMATION'
    ) {
      const items: MovieBoxBannerItem[] = (op.subjects || []).map((sub: any) => ({
        name: sub.title,
        poster_url: sub.cover?.url,
        slug: sub.detailPath,
        subject_id: sub.subjectId,
        badge: sub.corner,
        rating: sub.imdbRatingValue,
      }));
      sections.push({ section: title, count: items.length, items });
    }
  }

  return { status: 'success', sections };
}

/**
 * Get catalog items (movies, TV series, animation) with pagination.
 */
export async function getCatalog(
  tabId: number,
  page: number = 1,
  perPage: number = 24,
  sort: string = 'RECOMMEND',
): Promise<{ page: number; per_page: number; total: number; items: MovieBoxCatalogItem[] }> {
  const url = `${API_BASE}/subject/filter`;
  const data = await makeRequest(url, 'POST', {
    tabId,
    filter: { sort, genre: 'ALL', country: 'ALL', year: 'ALL', language: 'ALL' },
    page,
    perPage,
  });

  const inner = data?.data || {};
  const rawItems = inner.items || inner.subjects || [];

  const items: MovieBoxCatalogItem[] = rawItems.map((sub: any) => ({
    name: sub.title,
    poster_url: sub.cover?.url,
    slug: sub.detailPath,
    subject_id: sub.subjectId,
    badge: sub.corner,
    rating: sub.imdbRatingValue,
    year: sub.releaseDate ? sub.releaseDate.slice(0, 4) : undefined,
  }));

  const pager = inner.pager || {};
  const total = pager.totalCount || inner.total || items.length;

  return { page, per_page: perPage, total, items };
}

/**
 * Search suggestions (autocomplete).
 */
export async function searchSuggest(
  q: string,
): Promise<{ suggestions: Array<{ title: string; slug: string; subject_id: string }> }> {
  const url = `${API_BASE}/subject/search-suggest`;
  const data = await makeRequest(url, 'POST', { keyword: q, perPage: 10 });
  const inner = data?.data || {};
  const raw = inner.items || inner.list || [];

  const suggestions = raw.map((item: any) => {
    const sub = item.subject || item;
    return {
      title: sub.title || item.word,
      slug: sub.detailPath || item.detailPath,
      subject_id: sub.subjectId || item.subjectId,
    };
  });

  return { suggestions };
}

/**
 * Full search with pagination.
 */
export async function search(
  q: string,
  page: number = 1,
): Promise<{ query: string; page: number; total: number; items: MovieBoxCatalogItem[] }> {
  const url = `${API_BASE}/subject/search`;
  const data = await makeRequest(url, 'POST', { keyword: q, page, perPage: 20 });
  const inner = data?.data || {};
  const raw = inner.items || inner.list || [];

  const items: MovieBoxCatalogItem[] = raw.map((sub: any) => ({
    name: sub.title,
    poster_url: sub.cover?.url,
    slug: sub.detailPath,
    subject_id: sub.subjectId,
  }));

  const pager = inner.pager || {};
  const total = pager.totalCount || inner.total || items.length;

  return { query: q, page, total, items };
}

/**
 * Get full subject detail by slug.
 * Returns raw API response (includes episodes, seasons, metadata).
 */
export async function getDetail(slug: string): Promise<any> {
  const url = `${API_BASE}/detail?detailPath=${slug}`;
  return makeRequest(url);
}

/**
 * Get stream sources for a subject + episode.
 * This is the core playback endpoint.
 */
export async function getStream(
  subjectId: string,
  detailPath: string,
  se: number = 1,
  ep: number = 1,
): Promise<StreamResult> {
  // Step 1: Get the player domain
  const domData = await makeRequest(`${API_BASE}/media-player/get-domain`);
  console.log(`[MovieBox] get-domain response:`, JSON.stringify(domData).slice(0, 200));
  let domain = 'https://netfilm.world';
  if (typeof domData?.data === 'string') {
    domain = domData.data;
  } else if (domData?.data?.domain) {
    domain = domData.data.domain;
  } else if (domData?.domain) {
    domain = domData.domain;
  }
  domain = domain.replace(/\/+$/, '');
  console.log(`[MovieBox] Resolved domain: ${domain}`);

  // Step 2: Build Referer and fetch play URL
  const playerReferer = `${domain}/spa/videoPlayPage/movies/${detailPath}?id=${subjectId}&type=/movie/detail&detailSe=${se}&detailEp=${ep}&lang=en`;
  const playUrl = `${domain}/wefeed-h5api-bff/subject/play?subjectId=${subjectId}&se=${se}&ep=${ep}&detailPath=${detailPath}`;

  console.log(`[MovieBox] Stream request — domain: ${domain}, url: ${playUrl.slice(0, 150)}`);

  const playResp = await fetch(playUrl, {
    headers: { ...PLAYER_HEADERS, Referer: playerReferer },
    cache: 'no-store',
  } as RequestInit);

  let playData: any = {};
  try {
    const playJson = await playResp.json();
    console.log(`[MovieBox] Stream response — status: ${playResp.status}, keys: ${Object.keys(playJson).join(', ')}`);
    playData = playJson?.data || {};
    console.log(`[MovieBox] Stream data keys: ${Object.keys(playData).join(', ')}, hasResource: ${playData?.hasResource}, streams: ${playData?.streams?.length || 0}`);
  } catch (e) {
    const text = await playResp.text().catch(() => '');
    console.error(`[MovieBox] Stream response parse failed — status: ${playResp.status}, body: ${text.slice(0, 300)}`);
    throw new Error(`Stream endpoint returned ${playResp.status}`);
  }
  const streams = playData.streams || [];
  const hasResource = playData.hasResource ?? false;

  const sources: MovieBoxStream[] = streams.map((s: any) => ({
    resolution: `${s.resolutions}p`,
    format: s.format,
    url: s.url,
    size: s.size,
    duration: s.duration,
    codec: s.codecName,
  }));

  return {
    subject_id: subjectId,
    se,
    ep,
    has_resource: hasResource,
    sources,
    hls: playData.hls || [],
    dash: playData.dash || [],
    free_episodes: playData.freeNum,
    limited: playData.limited ?? false,
    note: hasResource ? null : 'No stream found for this episode.',
  };
}

/**
 * Get captions/subtitles for a stream.
 */
export async function getCaptions(
  subjectId: string,
  detailPath: string,
  se: number = 1,
  ep: number = 1,
): Promise<{ subject_id: string; se: number; ep: number; count: number; captions: CaptionEntry[] }> {
  const domData = await makeRequest(`${API_BASE}/media-player/get-domain`);
  let domain = 'https://netfilm.world';
  if (typeof domData?.data === 'string') {
    domain = domData.data;
  } else if (domData?.data?.domain) {
    domain = domData.data.domain;
  } else if (domData?.domain) {
    domain = domData.domain;
  }
  domain = domain.replace(/\/+$/, '');

  const playerReferer = `${domain}/spa/videoPlayPage/movies/${detailPath}?id=${subjectId}&type=/movie/detail&detailSe=${se}&detailEp=${ep}&lang=en`;
  const playUrl = `${domain}/wefeed-h5api-bff/subject/play?subjectId=${subjectId}&se=${se}&ep=${ep}&detailPath=${detailPath}`;

  const playResp = await fetch(playUrl, {
    headers: { ...PLAYER_HEADERS, Referer: playerReferer },
    cache: 'no-store',
  } as RequestInit);

  const playData = (await playResp.json())?.data || {};
  const streams = playData.streams || [];
  const dash = playData.dash || [];

  let streamId: string | null = null;
  let streamFormat: string | null = null;

  if (streams.length > 0) {
    streamId = streams[0].id;
    streamFormat = streams[0].format || 'MP4';
  } else if (dash.length > 0) {
    streamId = dash[0].id;
    streamFormat = dash[0].format || 'DASH';
  }

  if (!streamId) {
    return { subject_id: subjectId, se, ep, count: 0, captions: [] };
  }

  const capUrl = `${API_BASE}/subject/caption?format=${streamFormat}&id=${streamId}&subjectId=${subjectId}&detailPath=${detailPath}`;
  const data = await makeRequest(capUrl);
  const inner = data?.data || {};
  const captions: CaptionEntry[] = Array.isArray(inner) ? inner : inner.captions || [];

  return { subject_id: subjectId, se, ep, count: captions.length, captions };
}
