import "./globals.css";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import { Providers } from "@/lib/providers";
import { Toaster } from "@/components/ui/toaster";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { UpdateNotifier } from "@/components/UpdateNotifier";
import { DesktopAppShell } from "@/components/desktop/DesktopAppShell";
import { DesktopLegalGate } from "@/components/legal/DesktopLegalGate";
import { JsonLd } from "@/components/JsonLd";
import { Metadata } from "next";

// ── Site-wide Organization + WebSite structured data ──
// Rendered once in the root body; gives search engines a stable entity and
// eligibility for the sitelinks searchbox (targets the /search?q= page).
const SITE = "https://filmsnap-pro.netlify.app";

const siteSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE}/#organization`,
      name: "FilmSnaps",
      url: SITE,
      logo: {
        "@type": "ImageObject",
        url: `${SITE}/icon.png`,
      },
      sameAs: ["https://github.com/anonymous260260a-arch/filmsnaps"],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE}/#website`,
      url: SITE,
      name: "FilmSnaps",
      publisher: { "@id": `${SITE}/#organization` },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${SITE}/search?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
  ],
};

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  preload: true,
  variable: "--font-body",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  preload: true,
  variable: "--font-mono",
});

// NOTE (readability fix, expert verdict 08-22): only ONE next/font `.className`
// may sit on <body>. Each .className sets font-family with equal specificity;
// stacking them let Playfair's later-emitted rule win and the whole app
// rendered as a display serif. Headings get the serif via the h1–h4 rule in
// globals.css; body/UI is Geist; tabular data opts into mono via .font-mono.
const playfair = Playfair_Display({
  subsets: ["latin"],
  display: "swap",
  preload: true,
  variable: "--font-display",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://filmsnap-pro.netlify.app"),
  title: {
    default: "FilmSnaps - Discover Movies & TV Shows",
    template: "%s | FilmSnaps",
  },
  description:
    "Discover and explore your favorite movies and TV shows on FilmSnaps. Browse trending content, search for titles, and build your personal watchlist.",
  keywords: [
    "movies",
    "TV shows",
    "streaming",
    "films",
    "series",
    "watchlist",
    "entertainment",
  ],
  authors: [{ name: "FilmSnaps" }],
  creator: "FilmSnaps",
  publisher: "FilmSnaps",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://filmsnap-pro.netlify.app",
    siteName: "FilmSnaps",
    title: "FilmSnaps - Discover Movies & TV Shows",
    description:
      "Discover and explore your favorite movies and TV shows on FilmSnaps.",
    images: [
      {
        url: "/og-image.png",
        width: 1212,
        height: 640,
        alt: "FilmSnaps - Discover Movies & TV Shows",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "FilmSnaps - Discover Movies & TV Shows",
    description:
      "Discover and explore your favorite movies and TV shows on FilmSnaps.",
    creator: "@filmsnaps",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: "81CnFVUPG59Vs_JhwcTbqn_XLJgnjuyXv3_s6c7Ad-o",
    // Add other verification codes here when available (e.g. yandex, bing)
  },

  // ── PWA / Installable App ──
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
  other: {
    "theme-color": "#070708",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "FilmSnaps",
    "msapplication-TileColor": "#070708",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Pre-warm the TMDB image origin so card posters/backdrops and the
            watch-page hero resolve DNS + TLS before first use. API data is
            same-origin (/api/tmdb) — no preconnect needed for it. */}
        <link rel="preconnect" href="https://image.tmdb.org" crossOrigin="" />
        <link rel="dns-prefetch" href="https://image.tmdb.org" />
      </head>
      <body
        className={`${geist.className} ${geist.variable} ${playfair.variable} ${geistMono.variable}`}
        suppressHydrationWarning
      >
        {/* Site-wide Organization + WebSite structured data */}
        <JsonLd data={siteSchema} />
        <ErrorBoundary>
          <Providers>
            <DesktopAppShell>{children}</DesktopAppShell>
            <Toaster />
            <UpdateNotifier />
            {/* First-run Legal & DMCA gate — desktop only (web gates on the
                watch page via WebLegalGate). Rendered after the shell so the
                overlay stacks above the top bar and immersive fullscreen. */}
            <DesktopLegalGate />
          </Providers>
        </ErrorBoundary>
      </body>
    </html>
  );
}
