import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In - FilmSnaps',
  description: 'Sign in to your FilmSnaps account to save your favorite movies and TV shows, access your watchlist, and personalize your experience.',
  keywords: 'sign in, login, account, FilmSnaps',
  openGraph: {
    title: 'Sign In - FilmSnaps',
    description: 'Sign in to your FilmSnaps account.',
    url: 'https://filmsnaps.com/auth',
    siteName: 'FilmSnaps',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Sign In - FilmSnaps',
    description: 'Sign in to your FilmSnaps account.',
    creator: '@filmsnaps',
  },
  alternates: {
    canonical: 'https://filmsnaps.com/auth',
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}