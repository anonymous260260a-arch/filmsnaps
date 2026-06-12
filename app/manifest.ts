/**
 * PWA Manifest — generated at /manifest.webmanifest
 * Makes FilmSnaps installable on devices.
 */
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FilmSnaps — Discover Movies & TV Shows',
    short_name: 'FilmSnaps',
    description:
      'Discover and explore your favorite movies and TV shows. Browse trending content, search for titles, and build your personal watchlist.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: '#050505',
    theme_color: '#0f0f16',
    categories: ['entertainment', 'movies', 'tv', 'streaming'],
    id: '/',
    lang: 'en',
    dir: 'ltr',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'Search',
        short_name: 'Search',
        description: 'Search movies and TV shows',
        url: '/search',
        icons: [{ src: '/icon.svg', sizes: 'any' }],
      },
      {
        name: 'Saved',
        short_name: 'Saved',
        description: 'Your watchlist',
        url: '/saved',
        icons: [{ src: '/icon.svg', sizes: 'any' }],
      },
    ],
  };
}
