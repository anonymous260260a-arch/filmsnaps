import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Versions & Release Notes",
  description:
    "Release notes and version history for FilmSnaps — see what changed in each update of the desktop and mobile apps.",
  keywords:
    "filmsnaps releases, changelog, version history, update notes, app changelog",
  openGraph: {
    title: "Versions & Release Notes - FilmSnaps",
    description: "Release notes and version history for FilmSnaps.",
    url: "https://filmsnap-pro.netlify.app/versions",
    siteName: "FilmSnaps",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Versions & Release Notes - FilmSnaps",
    description: "Release notes and version history for FilmSnaps.",
    creator: "@filmsnaps",
  },
  alternates: {
    canonical: "https://filmsnap-pro.netlify.app/versions",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function VersionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
