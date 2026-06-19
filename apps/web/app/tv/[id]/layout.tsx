import { Metadata } from 'next';
import { tmdbApi, getImageUrl } from '@/lib/tmdb';
import { tmdbTvMeta } from '@/lib/tmdb.server';
import { Header } from '@/components/Header';

export async function generateMetadata({
  params,
}: {
  params: any;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const show = await tmdbTvMeta(id);
    const title = `${show.name} - FilmSnaps`;
    const description =
      show.overview ||
      `Watch ${show.name} on FilmSnaps - Your favorite TV show streaming platform`;
    const image = show.poster_path
      ? getImageUrl(show.poster_path, 'w500')
      : null;
    const url = `https://filmsnaps.com/tv/${id}`;

    return {
      title,
      description,
      keywords: [
        show.name,
        'TV show',
        'series',
        'streaming',
        'watch',
        ...(show.genres?.map((g: { name: string }) => g.name) || []),
      ].join(', '),
      authors: [{ name: 'FilmSnaps' }],
      creator: 'FilmSnaps',
      publisher: 'FilmSnaps',
      openGraph: {
        title,
        description,
        url,
        siteName: 'FilmSnaps',
        images: image
          ? [
              {
                url: image,
                width: 500,
                height: 750,
                alt: show.name,
              },
            ]
          : [],
        locale: 'en_US',
        type: 'video.tv_show',
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: image ? [image] : [],
        creator: '@filmsnaps',
      },
      alternates: {
        canonical: url,
      },
      robots: {
        index: true,
        follow: true,
        googleBot: {
          index: true,
          follow: true,
          'max-video-preview': -1,
          'max-image-preview': 'large',
          'max-snippet': -1,
        },
      },
    };
  } catch (error) {
    return {
      title: 'TV Show Not Found - FilmSnaps',
      description: 'The requested TV show could not be found.',
    };
  }
}

export default function TVLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      {children}
    </>
  );
}
