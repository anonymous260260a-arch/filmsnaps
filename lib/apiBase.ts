import { headers } from 'next/headers';

export async function getApiBaseUrl() {
  // Browser
  if (typeof window !== 'undefined') {
    return '';
  }

  // Server (SSR / RSC)
  const h = headers();
  const protocol = (await h).get('x-forwarded-proto') ?? 'http';
  const host = (await h).get('host');

  return `${protocol}://${host}`;
}
