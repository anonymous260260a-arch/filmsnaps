import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Download - FilmSnaps",
  description:
    "Download FilmSnaps for Android, Windows, macOS, and Linux. Free, open-source, privacy-first movie and TV show streaming app.",
  keywords:
    "download filmsnaps, film apps, streaming app download, android apk, windows app, mac app, linux app, ad-free streaming",
  openGraph: {
    title: "Download FilmSnaps",
    description:
      "Download FilmSnaps for Android, Windows, macOS, and Linux. Free and open-source.",
    url: "https://filmsnap-pro.netlify.app/download",
    siteName: "FilmSnaps",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Download FilmSnaps",
    description:
      "Download FilmSnaps for Android, Windows, macOS, and Linux. Free and open-source.",
    creator: "@filmsnaps",
  },
  alternates: {
    canonical: "https://filmsnap-pro.netlify.app/download",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function DownloadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
