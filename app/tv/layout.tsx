import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'TV Shows - Browse All TV Series',
  description: 'Browse and discover TV shows on FilmSnaps. Filter by genre, year, rating, and more. Find your next favorite series.',
  keywords: 'TV shows, series, browse TV shows, TV database, television shows',
  openGraph: {
    title: 'TV Shows - Browse All TV Series | FilmSnaps',
    description: 'Browse and discover TV shows on FilmSnaps.',
    url: 'https://filmsnaps.com/tv',
    siteName: 'FilmSnaps',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'TV Shows - Browse All TV Series | FilmSnaps',
    description: 'Browse and discover TV shows on FilmSnaps.',
    creator: '@filmsnaps',
  },
  alternates: {
    canonical: 'https://filmsnaps.com/tv',
  },
};

export default function TVLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}