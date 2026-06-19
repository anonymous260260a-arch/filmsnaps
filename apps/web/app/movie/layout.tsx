import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Movies - Browse All Movies',
  description: 'Browse and discover movies on FilmSnaps. Filter by genre, year, rating, and more. Find your next favorite film.',
  keywords: 'movies, films, browse movies, movie database, film collection',
  openGraph: {
    title: 'Movies - Browse All Movies | FilmSnaps',
    description: 'Browse and discover movies on FilmSnaps.',
    url: 'https://filmsnaps.com/movie',
    siteName: 'FilmSnaps',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Movies - Browse All Movies | FilmSnaps',
    description: 'Browse and discover movies on FilmSnaps.',
    creator: '@filmsnaps',
  },
  alternates: {
    canonical: 'https://filmsnaps.com/movie',
  },
};

export default function MovieLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}