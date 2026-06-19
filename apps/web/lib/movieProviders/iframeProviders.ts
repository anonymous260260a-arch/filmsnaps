// lib/providers.ts
// Provider configuration with network-level blocking (uBlock-style)

export const iframeProviders: Record<string, string> = {
  /**
   * VidKing - Primary provider
   * Uses network-level blocking via /api/player/vidking
   */
  vidking: 'https://www.vidking.net',
  
  /**
   * VidSrc family - Multiple endpoints
   */
  vidsrc: 'https://vidsrc.wtf',
  vidsrc2: 'https://vidsrc.wtf',
  vidsrc3: 'https://vidsrc.wtf',
  vidsrc4: 'https://vidsrc.wtf',
  vidsrc5: 'https://vidsrc.su',
  vidsrc6: 'https://vidsrc-embed.ru',
  
  /**
   * Other providers
   */
  vidsrc7: 'https://vidlink.pro',
  vidnest: 'https://vidnest.fun',
  primesrc: 'https://primesrc.me',
  vidpro: 'https://vidlink.pro',
  vixsrc: 'https://vixsrc.to',
  vidfast: 'https://vidfast.pro',
  moviesapi: 'https://moviesapi.club',
  vidup: 'https://vidup.to',
  indraembed: 'https://indraembed.netlify.app',
  
};

/**
 * Provider configuration type for future expansion
 */
export interface ProviderConfig {
  baseUrl: string;
  embedPath: {
    movie: (id: string) => string;
    tv: (id: string, season: number, episode: number) => string;
  };
  disabled?: boolean;
  note?: string;
}

export const providerConfigs: Record<string, ProviderConfig> = {
  vidking: {
    baseUrl: 'https://www.vidking.net',
    embedPath: {
      movie: (id: string) => `/embed/movie/${id}?color=ff0000`,
      tv: (id: string, season: number, episode: number) => `/embed/tv/${id}/${season}/${episode}?color=ff0000`,
    },
  },
  vidsrc: {
    baseUrl: 'https://vidsrc.wtf',
    embedPath: {
      movie: (id: string) => `/api/1/movie/?id=${id}&color=e01621`,
      tv: (id: string, season: number, episode: number) => `/api/1/tv/?id=${id}&season=${season}&episode=${episode}&color=e01621`,
    },
  },
  vidsrc2: {
    baseUrl: 'https://vidsrc.wtf',
    embedPath: {
      movie: (id: string) => `/api/2/movie/?id=${id}&color=e01621`,
      tv: (id: string, season: number, episode: number) => `/api/2/tv/?id=${id}&season=${season}&episode=${episode}&color=e01621`,
    },
  },
  vidsrc3: {
    baseUrl: 'https://vidsrc.wtf',
    embedPath: {
      movie: (id: string) => `/api/3/movie/?id=${id}&color=e01621`,
      tv: (id: string, season: number, episode: number) => `/api/3/tv/?id=${id}&season=${season}&episode=${episode}&color=e01621`,
    },
  },
  vidsrc4: {
    baseUrl: 'https://vidsrc.wtf',
    embedPath: {
      movie: (id: string) => `/api/4/movie/?id=${id}&color=e01621`,
      tv: (id: string, season: number, episode: number) => `/api/4/tv/?id=${id}&season=${season}&episode=${episode}&color=e01621`,
    },
  },
  vidsrc5: {
    baseUrl: 'https://vidsrc.su',
    embedPath: {
      movie: (id: string) => `/movie/${id}&colour=00ff9d`,
      tv: (id: string, season: number, episode: number) => `/tv/${id}/${season}/${episode}&colour=00ff9d`,
    },
  },
  vidsrc6: {
    baseUrl: 'https://vidsrc-embed.ru',
    embedPath: {
      movie: (id: string) => `/embed/movie/${id}`,
      tv: (id: string, season: number, episode: number) => `/embed/tv/${id}/${season}/${episode}`,
    },
  },
  vidnest: {
    baseUrl: 'https://vidnest.fun',
    embedPath: {
      movie: (id: string) => `/movie/${id}`,
      tv: (id: string, season: number, episode: number) => `/tv/${id}/${season}/${episode}`,
    },
  },
  primesrc: {
    baseUrl: 'https://primesrc.me',
    embedPath: {
      movie: (id: string) => `/embed/movie?tmdb=${id}`,
      tv: (id: string, season: number, episode: number) => `/embed/tv?tmdb=${id}&season=${season}&episode=${episode}`,
    },
  },
  vidpro: {
    baseUrl: 'https://vidlink.pro',
    embedPath: {
      movie: (id: string) => `/movie/${id}`,
      tv: (id: string, season: number, episode: number) => `/tv/${id}/${season}/${episode}`,
    },
  },
  vixsrc: {
    baseUrl: 'https://vixsrc.to',
    embedPath: {
      movie: (id: string) => `/movie/${id}`,
      tv: (id: string, season: number, episode: number) => `/tv/${id}/${season}/${episode}`,
    },
  },
  vidfast: {
    baseUrl: 'https://vidfast.pro',
    embedPath: {
      movie: (id: string) => `/movie/${id}`,
      tv: (id: string, season: number, episode: number) => `/tv/${id}/${season}/${episode}`,
    },
  },
  moviesapi: {
    baseUrl: 'https://moviesapi.club',
    embedPath: {
      movie: (id: string) => `/movie/${id}`,
      tv: (id: string, season: number, episode: number) => `/tv/${id}/${season}/${episode}`,
    },
  },
  vidup: {
    baseUrl: 'https://vidup.to',
    embedPath: {
      movie: (id: string) => `/movie/${id}?autoPlay=true`,
      tv: (id: string, season: number, episode: number) => `/tv/${id}/${season}/${episode}?autoPlay=true`,
    },
  },
};
