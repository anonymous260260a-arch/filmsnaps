// lib/movieProviders/movieapi.ts
import type { ProviderSanitizer } from './types';
import { baseSanitize } from './common';

export const movieapiClub: ProviderSanitizer = {
  name: 'moviesapi',

  sanitize(html: string, url: string): string {
    return baseSanitize(html, url);
  },
};
