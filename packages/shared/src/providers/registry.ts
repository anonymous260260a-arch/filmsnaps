import type { ProviderDefinition } from '../types/provider';

/**
 * All providers registered in one place.
 * To add a new provider: append an entry to this array.
 * To remove: set `enabled: false` or delete the entry.
 * To reorder: adjust `order` (lower = higher in list, defaults to 999).
 * To hide the real provider name: set `displayName` (shown in UI instead of `name').
 *
 * Enabled servers in order: 1, 2, 3, 4, 6, 14, 18, 19, StreamGuide
 */
export const PROVIDERS: ProviderDefinition[] = [
  // ── Server 1 ────────────────────────────────────────────────
  {
    id: 'nxsha',
    name: 'Nxsha',
    displayName: 'Server 1 [Multi lang, Fast]',
    baseUrl: 'https://web.nxsha.app',
    embed: {
      movie: (id) => `/embed/movie/${id}?disable_dl_button=true&disable_app_ad=true&lang=hi`,
      tv: (id, season, episode) => `/embed/tv/${id}/${season}/${episode}?disable_dl_button=true&disable_app_ad=true&lang=hi`,
    },
  },
  // ── Server 2 ────────────────────────────────────────────────
  {
    id: 'peachify',
    name: 'peachify',
    displayName: 'Server 2 [Multi audio]',
    baseUrl: 'https://peachify.top/embed',
    embed: {
      movie: (id) => `/movie/${id}`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}`,
    },
  },
  // ── Server 3 ────────────────────────────────────────────────
  {
    id: 'screenscape',
    name: 'ScreenScape',
    displayName: 'Server 3 [Multi lang, Fast]',
    baseUrl: 'https://screenscape.me/embed',
    embed: {
      movie: (id) => `?tmdb=${id}&type=movie`,
      tv: (id, season, episode) => `?tmdb=${id}&type=tv&s=${season}&e=${episode}`,
    },
  },
  // ── Server 4 ──────────────────────────────────────────────────
  {
    id: 'nhdapi',
    name: 'NHD Api',
    displayName: 'Server 4 [Multi lang, Fast]',
    baseUrl: 'https://nhdapi.com',
    embed: {
      movie: (id) => `/embed/movie/${id}?lang=Hindi&autoplay=true&autonext=true&title=false&download=false&episodelist=false&hideautonext=true&hidetitle=true&hidechromecast=true&hidepip=true&hideepisodelist=true&hideupscaler=true&hidesecondarycolor=true&hideiconcolor=true&hideprimarycolor=true&appearance=off&primarycolor=6C63FF&secondarycolor=9F9BFF&iconcolor=FFFFFF`,
      tv: (id, season, episode) => `/embed/tv/${id}/${season}/${episode}?lang=Hindi&autoplay=true&autonext=true&title=false&download=false&episodelist=false&hideautonext=true&hidetitle=true&hidechromecast=true&hidepip=true&hideepisodelist=true&hideupscaler=true&hidesecondarycolor=true&hideiconcolor=true&hideprimarycolor=true&appearance=off&primarycolor=6C63FF&secondarycolor=9F9BFF&iconcolor=FFFFFF`,
    },
  },
  // ── Server 5 (disabled — was Server 4) ────────────────────────
  {
    id: 'multiembed',
    name: 'MultiEmbed',
    displayName: 'Server 5',
    enabled: false,
    baseUrl: 'https://multiembed.mov',
    embed: {
      movie: (id) => `/?video_id=${id}&tmdb=1`,
      tv: (id, season, episode) => `/?video_id=${id}&tmdb=1&s=${season}&e=${episode}`,
    },
  },
  // ── Server 21 (disabled — was Server 5) ────────────────────────
  {
    id: 'vidbinge',
    name: 'VidBinge',
    displayName: 'Server 21',
    enabled: false,
    baseUrl: 'https://vidbinge.to',
    embed: {
      movie: (id) => `/movie/${id}`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}`,
    },
  },
  // ── Server 6 ────────────────────────────────────────────────
  {
    id: 'vidking',
    name: 'VidKing',
    displayName: 'Server 6',
    baseUrl: 'https://www.vidking.net',
    embed: {
      movie: (id) => `/embed/movie/${id}?color=ff0000`,
      tv: (id, season, episode) => `/embed/tv/${id}/${season}/${episode}?color=ff0000`,
    },
  },
  // ── Server 7 (disabled) ─────────────────────────────────────
  {
    id: 'vidfast',
    name: 'VidFast',
    displayName: 'Server 7',
    enabled: false,
    baseUrl: 'https://vidfast.pro',
    embed: {
      movie: (id) => `/movie/${id}`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}`,
    },
  },
  // ── VidSrc family (disabled) ────────────────────────────────
  {
    id: 'vidsrc',
    name: 'VidSrc 1',
    displayName: 'Server 8',
    enabled: false,
    baseUrl: 'https://vidsrc.wtf',
    embed: {
      movie: (id) => `/api/1/movie/?id=${id}&color=e01621`,
      tv: (id, season, episode) => `/api/1/tv/?id=${id}&season=${season}&episode=${episode}&color=e01621`,
    },
  },
  {
    id: 'vidsrc2',
    name: 'VidSrc 2',
    displayName: 'Server 9',
    enabled: false,
    baseUrl: 'https://vidsrc.wtf',
    embed: {
      movie: (id) => `/api/2/movie/?id=${id}&color=e01621`,
      tv: (id, season, episode) => `/api/2/tv/?id=${id}&season=${season}&episode=${episode}&color=e01621`,
    },
  },
  {
    id: 'vidsrc3',
    name: 'VidSrc 3',
    displayName: 'Server 10',
    enabled: false,
    baseUrl: 'https://vidsrc.wtf',
    embed: {
      movie: (id) => `/api/3/movie/?id=${id}&color=e01621`,
      tv: (id, season, episode) => `/api/3/tv/?id=${id}&season=${season}&episode=${episode}&color=e01621`,
    },
  },
  {
    id: 'vidsrc4',
    name: 'VidSrc 4',
    displayName: 'Server 11',
    enabled: false,
    baseUrl: 'https://vidsrc.wtf',
    embed: {
      movie: (id) => `/api/4/movie/?id=${id}&color=e01621`,
      tv: (id, season, episode) => `/api/4/tv/?id=${id}&season=${season}&episode=${episode}&color=e01621`,
    },
  },
  {
    id: 'vidsrc5',
    name: 'VidSrc 5',
    displayName: 'Server 12',
    enabled: false,
    baseUrl: 'https://vidsrc.su',
    embed: {
      movie: (id) => `/movie/${id}&colour=00ff9d`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}&colour=00ff9d`,
    },
  },
  {
    id: 'vidsrc6',
    name: 'VidSrc 6',
    displayName: 'Server 13',
    enabled: false,
    baseUrl: 'https://vidsrc-embed.ru',
    embed: {
      movie: (id) => `/embed/movie/${id}`,
      tv: (id, season, episode) => `/embed/tv/${id}/${season}/${episode}`,
    },
  },
  // ── Server 14 ───────────────────────────────────────────────
  {
    id: 'vidnest',
    name: 'Vidnest',
    displayName: 'Server 14',
    baseUrl: 'https://vidnest.fun',
    embed: {
      movie: (id, startAt) => `/movie/${id}${startAt ? `?startAt=${Math.floor(startAt)}` : ''}`,
      tv: (id, season, episode, startAt) => `/tv/${id}/${season}/${episode}${startAt ? `?startAt=${Math.floor(startAt)}` : ''}`,
    },
  },
  // ── Server 15 (disabled) ────────────────────────────────────
  {
    id: 'vidpro',
    name: 'VidPro',
    displayName: 'Server 15',
    enabled: false,
    baseUrl: 'https://vidlink.pro',
    embed: {
      movie: (id) => `/movie/${id}`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}`,
    },
  },
  // ── Server 16 (disabled — always returns HTTP 403) ─────────
  {
    id: 'vixsrc',
    name: 'Vixsrc',
    displayName: 'Server 16',
    enabled: false,
    baseUrl: 'https://vixsrc.to',
    embed: {
      movie: (id, startAt) => `/movie/${id}${startAt ? `?startAt=${Math.floor(startAt)}` : ''}`,
      tv: (id, season, episode, startAt) => `/tv/${id}/${season}/${episode}${startAt ? `?startAt=${Math.floor(startAt)}` : ''}`,
    },
  },
  // ── Server 17 (disabled) ────────────────────────────────────
  {
    id: 'vidup',
    name: 'VidUp',
    displayName: 'Server 17',
    enabled: false,
    baseUrl: 'https://vidup.to',
    embed: {
      movie: (id) => `/movie/${id}?autoPlay=true`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}?autoPlay=true`,
    },
  },
  {
    id: 'vidvault',
    name: 'VidVault',
    displayName: 'VidVault',
    enabled: false,
    baseUrl: 'https://vidvault.ru',
    embed: {
      movie: (id) => `/movie/${id}`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}`,
    },
  },
  // ── Server 20 (disabled) ────────────────────────────────────
  {
    id: 'videasy',
    name: 'videasy',
    displayName: 'Server 20',
    enabled: false,
    baseUrl: 'https://player.videasy.net',
    embed: {
      movie: (id) => `/movies/${id}`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}`,
    },
  },
  // ── Server 18 ───────────────────────────────────────────────
  {
    id: 'chillflix',
    name: 'ChillFlix',
    displayName: 'Server 18 [Slow]',
    baseUrl: 'https://www.chillflix.lol/embed',
    embed: {
      movie: (id) => `/movie/${id}?autoplay=true&watchparty=false&title=false&parent_origin=${encodeURIComponent('https://www.chillflix.lol')}`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}?autoplay=true&watchparty=false&title=false&parent_origin=${encodeURIComponent('https://www.chillflix.lol')}`,
    },
  },
  // ── Server 19 ───────────────────────────────────────────────
  {
    id: 'toustream',
    name: 'TouStream',
    displayName: 'Server 19',
    baseUrl: 'https://toustream.xyz',
    embed: {
      movie: (id) => `/tou/movies/${id}`,
      tv: (id, season, episode) => `/tou/tv/${id}/${season}/${episode}`,
    },
  },
  // ── StreamGuide ─────────────────────────────────────────────
  {
    id: 'streamguide',
    name: 'StreamGuide',
    displayName: 'StreamGuide',
    baseUrl: 'https://streamguide.cfd',
    embed: {
      movie: (id) => `/embed/?type=m&id=m-api-${id}&ep=m-api-${id}`,
      tv: (id, season, episode) => `/embed/?type=t&id=t-api-${id}&ep=t-api-${id}-s${season}e${episode}`,
    },
  },
];

/**
 * Look up a provider by its id
 */
export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((p) => p.id === id.toLowerCase() && p.enabled !== false);
}

/**
 * Get only enabled providers (for UI dropdown, sorted by priority)
 */
export function getEnabledProviders(): ProviderDefinition[] {
  return PROVIDERS.filter((p) => p.enabled !== false).sort(
    (a, b) => (a.order ?? 999) - (b.order ?? 999),
  );
}

/**
 * Check whether protection is enabled for a given provider
 */
export function isProtectionEnabled(provider: ProviderDefinition): boolean {
  return provider.protection?.enabled ?? true;
}
