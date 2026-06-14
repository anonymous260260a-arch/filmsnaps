/**
 * Player — direct redirect to the provider's embed page.
 *
 * The iframe loads from the provider's origin (cross-origin). We can't
 * intercept window.open from inside the iframe, but we CAN:
 *   1. Override top.open/parent.open from our parent page
 *   2. Detect popup focus loss and reclaim focus
 *   3. Add sandbox attribute to block popups at browser level
 *   4. Add navigation guard to revert top.location changes
 */
import { NextResponse } from 'next/server';
import { getProvider } from '@/lib/movieProviders/providers';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerKey } = await params;
  const provider = getProvider(providerKey);

  if (!provider) {
    return new NextResponse(`Unknown or disabled provider: ${providerKey}`, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const movieId = searchParams.get('id');
  const tvId = searchParams.get('tvId');
  const season = searchParams.get('season');
  const episode = searchParams.get('episode');

  if (!movieId && !tvId) {
    return new NextResponse('Missing id or tvId parameter', { status: 400 });
  }

  const embedPath = tvId && season && episode
    ? provider.embed.tv(tvId, Number(season), Number(episode))
    : provider.embed.movie(movieId!);

  const targetUrl = `${provider.baseUrl}${embedPath}`;
  console.log(`[Player] Redirect:`, targetUrl);

  return NextResponse.redirect(targetUrl, 302);
}
