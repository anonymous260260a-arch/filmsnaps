/**
 * Player — redirects to the provider's embed URL.
 *
 * Providers load directly on their own domain — no proxy, no
 * HTML rewriting, no sandbox, no service worker.
 *
 * Protection relies on:
 *   1. Browser cross-origin isolation (iframe can't access parent DOM)
 *   2. referrerPolicy="no-referrer" on the iframe
 */

import { redirect } from 'next/navigation';
import { getProvider } from '@/lib/movieProviders/providers';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerKey } = await params;
  const provider = getProvider(providerKey);

  if (!provider) {
    return new Response(`Unknown or disabled provider: ${providerKey}`, {
      status: 404,
    });
  }

  const { searchParams } = new URL(req.url);
  const movieId = searchParams.get('id');
  const tvId = searchParams.get('tvId');
  const season = searchParams.get('season');
  const episode = searchParams.get('episode');

  if (!movieId && !tvId) {
    return new Response('Missing id or tvId parameter', { status: 400 });
  }

  const embedPath =
    tvId && season && episode
      ? provider.embed.tv(tvId, Number(season), Number(episode))
      : provider.embed.movie(movieId!);

  const targetUrl = `${provider.baseUrl}${embedPath}`;

  console.log(`[Player] Redirect ${providerKey} → ${targetUrl}`);
  return Response.redirect(targetUrl, 302);
}
