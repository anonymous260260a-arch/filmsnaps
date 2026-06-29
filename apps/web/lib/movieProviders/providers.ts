// lib/movieProviders/providers.ts
// SINGLE source of truth for all streaming providers
// Every route and component imports from here — no duplicates.

import type { ProviderDefinition } from './types';

/**
 * All providers registered in one place.
 * To add a new provider: append an entry to this array.
 * To remove: set `enabled: false` or delete the entry.
 * To reorder: adjust `order` (lower = higher in list, defaults to 999).
 * To hide the real provider name: set `displayName` (shown in UI instead of `name`).
 */
export const PROVIDERS: ProviderDefinition[] = [
{
    id: 'peachify',
    name: 'peachify',
    displayName: 'Server 1 [Multi audio]',
    baseUrl: 'https://peachify.top/embed',
    embed: {
      movie: (id) => `/movie/${id}`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}`,
    },
  },
  // best quality
  {
    id: 'toustream',
    name: 'TouStream',
    displayName: 'Server 2',
    baseUrl: 'https://toustream.xyz',
    embed: {
      movie: (id) => `/tou/movies/${id}`,
      tv: (id, season, episode) => `/tou/tv/${id}/${season}/${episode}`,
    },
  },
  {
    id: 'videasy',
    name: 'videasy',
    displayName: 'Server 3',
    baseUrl: 'https://player.videasy.net',
    embed: {
      movie: (id) => `/movies/${id}`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}`,
    },
  },


  {
    id: 'multiembed',
    name: 'MultiEmbed',
    displayName: 'Server 4',
    baseUrl: 'https://multiembed.mov',
    embed: {
      movie: (id) => `/?video_id=${id}&tmdb=1`,
      tv: (id, season, episode) => `/?video_id=${id}&tmdb=1&s=${season}&e=${episode}`,
    },
  },
  {
    id: 'vidbinge',
    name: 'VidBinge',
    displayName: 'Server 5',
    baseUrl: 'https://vidbinge.to',
    embed: {
      movie: (id) => `/movie/${id}`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}`,
    },
  },
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
  {
    id: 'vidfast',
    name: 'VidFast',
    displayName: 'Server 7',
    baseUrl: 'https://vidfast.pro',
    embed: {
      movie: (id) => `/movie/${id}`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}`,
    },
  },

  // ── VidSrc family ──────────────────────────────────────────
  {
    id: 'vidsrc',
    name: 'VidSrc 1',
    displayName: 'Server 8',
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
    baseUrl: 'https://vidsrc-embed.ru',
    embed: {
      movie: (id) => `/embed/movie/${id}`,
      tv: (id, season, episode) => `/embed/tv/${id}/${season}/${episode}`,
    },
  },

  // ── Primary providers ─────────────────────────────────────

  {
    id: 'vidnest',
    name: 'Vidnest',
    displayName: 'Server 14',
    baseUrl: 'https://vidnest.fun',
    embed: {
      movie: (id) => `/movie/${id}`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}`,
    },
  },
  //  {
  //    id: 'primesrc',
  //    name: 'PrimeSrc',
  //    displayName: 'Server 18',
  //    baseUrl: 'https://primesrc.me',
  //    embed: {
  //      movie: (id) => `/embed/movie?tmdb=${id}`,
  //      tv: (id, season, episode) => `/embed/tv?tmdb=${id}&season=${season}&episode=${episode}`,
  //    },
  //  },
  {
    id: 'vidpro',
    name: 'VidPro',
    displayName: 'Server 15',
    baseUrl: 'https://vidlink.pro',
    embed: {
      movie: (id) => `/movie/${id}`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}`,
    },
  },
  {
    id: 'vixsrc',
    name: 'Vixsrc',
    displayName: 'Server 16',
    baseUrl: 'https://vixsrc.to',
    embed: {
      movie: (id) => `/movie/${id}`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}`,
    },
  },

  // {
  //   id: 'moviesapi',
  //   name: 'MoviesAPI',
  //   displayName: 'Server 13',
  //   baseUrl: 'https://moviesapi.to',
  //   embed: {
  //     movie: (id) => `/movie/${id}`,
  //     tv: (id, season, episode) => `/tv/${id}/${season}/${episode}`,
  //   },
  // },
  {
    id: 'vidup',
    name: 'VidUp',
    displayName: 'Server 17',
    baseUrl: 'https://vidup.to',
    embed: {
      movie: (id) => `/movie/${id}?autoPlay=true`,
      tv: (id, season, episode) => `/tv/${id}/${season}/${episode}?autoPlay=true`,
    },
  },

  {
    id: 'nxsha',
    name: 'Nxsha',
    displayName: 'Server 19',
    baseUrl: 'https://web.nxsha.app',
    embed: {
      movie: (id) => `/embed/movie/${id}`,
      tv: (id, season, episode) => `/embed/tv/${id}/${season}/${episode}`,
    },
  },

  // ── TouStream ────────────────────────────────────────────


];

/**
 * Helper: look up a provider by its id
 */
export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((p) => p.id === id.toLowerCase() && p.enabled !== false);
}

/**
 * Helper: get only enabled providers (for UI dropdown, sorted by priority)
 */
export function getEnabledProviders(): ProviderDefinition[] {
  return PROVIDERS
    .filter((p) => p.enabled !== false)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

/**
 * Helper: check whether protection is enabled for a given provider
 */
export function isProtectionEnabled(provider: ProviderDefinition): boolean {
  return provider.protection?.enabled ?? true;
}
