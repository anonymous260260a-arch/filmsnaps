import { Metadata } from "next";

// Watch history is user-specific, device-local data — never index it.
export const metadata: Metadata = {
  title: "Watch History - FilmSnaps",
  description:
    "Your recently watched movies and TV shows on FilmSnaps, with progress bars and resume buttons.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function HistoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
