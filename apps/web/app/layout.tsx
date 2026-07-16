import './globals.css';
import { Inter, Playfair_Display } from 'next/font/google';
import { Providers } from '@/lib/providers';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/components/AuthProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { UpdateNotifier } from '@/components/UpdateNotifier';
import { Metadata } from 'next';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  preload: true,
  variable: '--font-body',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  display: 'swap',
  preload: true,
  variable: '--font-display',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://filmsnaps.com'),
  title: {
    default: 'FilmSnaps - Discover Movies & TV Shows',
    template: '%s | FilmSnaps',
  },
  description:
    'Discover and explore your favorite movies and TV shows on FilmSnaps. Browse trending content, search for titles, and build your personal watchlist.',
  keywords: [
    'movies',
    'TV shows',
    'streaming',
    'films',
    'series',
    'watchlist',
    'entertainment',
  ],
  authors: [{ name: 'FilmSnaps' }],
  creator: 'FilmSnaps',
  publisher: 'FilmSnaps',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://filmsnaps.com',
    siteName: 'FilmSnaps',
    title: 'FilmSnaps - Discover Movies & TV Shows',
    description:
      'Discover and explore your favorite movies and TV shows on FilmSnaps.',
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'FilmSnaps - Discover Movies & TV Shows',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FilmSnaps - Discover Movies & TV Shows',
    description:
      'Discover and explore your favorite movies and TV shows on FilmSnaps.',
    creator: '@filmsnaps',
    images: ['/og-image.jpg'],
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
  verification: {
    // Add your verification codes here when available
    // google: 'your-google-verification-code',
    // yandex: 'your-yandex-verification-code',
  },

  // ── PWA / Installable App ──
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
  other: {
    'theme-color': '#070708',
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
    'apple-mobile-web-app-title': 'FilmSnaps',
    'msapplication-TileColor': '#070708',
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.className} ${playfair.className} ${inter.variable} ${playfair.variable}`}
        suppressHydrationWarning
      >
        <ErrorBoundary>
          <Providers>
            <AuthProvider>
              {children}
              <Toaster />
              <UpdateNotifier />
            </AuthProvider>
          </Providers>
        </ErrorBoundary>
      </body>
    </html>
  );
}
