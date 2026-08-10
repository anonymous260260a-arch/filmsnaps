import { Metadata } from "next";
import { getImageUrl } from "@/lib/tmdb";
import { tmdbMovieMeta } from "@/lib/tmdb.server";
import { Header } from "@/components/Header";

export async function generateMetadata({
  params,
}: {
  params: any;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const movie = await tmdbMovieMeta(id);
    const title = `${movie.title} - FilmSnaps`;
    const description =
      movie.overview ||
      `Watch ${movie.title} on FilmSnaps - Your favorite movie streaming platform`;
    // 16:9 backdrop (1280×720) for social sharing — social cards crop to
    // landscape, so the w500 poster (2:3) gets letterboxed. Backdrop first,
    // poster as a fallback when a backdrop isn't available.
    const image = movie.backdrop_path
      ? getImageUrl(movie.backdrop_path, "w1280")
      : movie.poster_path
        ? getImageUrl(movie.poster_path, "w500")
        : null;
    const url = `https://filmsnap-pro.netlify.app/movie/${id}`;

    return {
      title,
      description,
      keywords: [
        movie.title,
        "movie",
        "film",
        "streaming",
        "watch",
        ...(movie.genres?.map((g: { name: string }) => g.name) || []),
      ].join(", "),
      authors: [{ name: "FilmSnaps" }],
      creator: "FilmSnaps",
      publisher: "FilmSnaps",
      openGraph: {
        title,
        description,
        url,
        siteName: "FilmSnaps",
        images: image
          ? [
              {
                url: image,
                width: movie.backdrop_path ? 1280 : 500,
                height: movie.backdrop_path ? 720 : 750,
                alt: movie.title,
              },
            ]
          : [],
        locale: "en_US",
        type: "video.movie",
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: image ? [image] : [],
        creator: "@filmsnaps",
      },
      alternates: {
        canonical: url,
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
    };
  } catch (error) {
    return {
      title: "Movie Not Found - FilmSnaps",
      description: "The requested movie could not be found.",
    };
  }
}

export default function MovieLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Header />

      {children}
    </>
  );
}
