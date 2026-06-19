// lib/movieProviders/vixsrc.ts
import type { ProviderSanitizer } from './types';
import { baseSanitize } from './common';

export const vixsrcTo: ProviderSanitizer = {
  name: 'vixsrc',

  sanitize(html: string, url: string): string {
    return baseSanitize(html, url);
  },
};
