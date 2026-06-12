import { Metadata } from 'next';
import { tmdbApi, getImageUrl } from '@/lib/tmdb';
import { tmdb, tmdbMovieMeta } from '@/lib/tmdb.server';
import { Header } from '@/components/Header';

export async function generateMetadata({
  params,
}: {
  params: any;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const movie = await tmdbMovieMeta(id);
    const title = `${movie.title} - FilmSnaps`;
    const description =
      movie.overview ||
      `Watch ${movie.title} on FilmSnaps - Your favorite movie streaming platform`;
    const image = movie.poster_path
      ? getImageUrl(movie.poster_path, 'w500')
      : null;
    const url = `https://filmsnaps.com/movie/${id}`;

    return {
      title,
      description,
      keywords: [
        movie.title,
        'movie',
        'film',
        'streaming',
        'watch',
        ...(movie.genres?.map((g: { name: string }) => g.name) || []),
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
                alt: movie.title,
              },
            ]
          : [],
        locale: 'en_US',
        type: 'video.movie',
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
      title: 'Movie Not Found - FilmSnaps',
      description: 'The requested movie could not be found.',
    };
  }
}

export default function MovieLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Header />

      {children}
    </>
  );
}
