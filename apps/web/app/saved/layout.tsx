import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Watchlist - FilmSnaps',
  description: 'Your saved movies and TV shows watchlist. Access your favorite content anytime on FilmSnaps.',
  keywords: 'watchlist, saved movies, saved TV shows, my list, favorites',
  openGraph: {
    title: 'My Watchlist - FilmSnaps',
    description: 'Your saved movies and TV shows watchlist on FilmSnaps.',
    url: 'https://filmsnaps.com/saved',
    siteName: 'FilmSnaps',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'My Watchlist - FilmSnaps',
    description: 'Your saved movies and TV shows watchlist on FilmSnaps.',
    creator: '@filmsnaps',
  },
  alternates: {
    canonical: 'https://filmsnaps.com/saved',
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function SavedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}