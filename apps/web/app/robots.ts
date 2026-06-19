import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/auth', '/saved', '/auth/callback', '/reset-password'],
      },
    ],
    sitemap: 'https://filmsnaps.com/sitemap.xml',
  };
}