import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Search Movies & TV Shows - FilmSnaps",
  description:
    "Search for your favorite movies and TV shows on FilmSnaps. Discover new content and explore a vast library of films and series.",
  keywords:
    "search movies, search TV shows, find movies, film search, TV series search, streaming",
  openGraph: {
    title: "Search Movies & TV Shows - FilmSnaps",
    description: "Search for your favorite movies and TV shows on FilmSnaps.",
    url: "https://filmsnap-pro.netlify.app/search",
    siteName: "FilmSnaps",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Search Movies & TV Shows - FilmSnaps",
    description: "Search for your favorite movies and TV shows on FilmSnaps.",
    creator: "@filmsnaps",
  },
  alternates: {
    canonical: "https://filmsnap-pro.netlify.app/search",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function SearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
