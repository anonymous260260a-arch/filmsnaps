import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/saved'],
      },
    ],
    sitemap: 'https://filmsnaps.com/sitemap.xml',
  };
}