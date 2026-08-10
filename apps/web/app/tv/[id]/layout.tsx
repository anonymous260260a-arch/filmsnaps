import { Metadata } from "next";
import { getImageUrl } from "@/lib/tmdb";
import { tmdbTvMeta } from "@/lib/tmdb.server";
import { Header } from "@/components/Header";

export async function generateMetadata({
  params,
}: {
  params: any;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const show = await tmdbTvMeta(id);
    const title = `${show.name} - FilmSnaps`;
    const description =
      show.overview ||
      `Watch ${show.name} on FilmSnaps - Your favorite TV show streaming platform`;
    // 16:9 backdrop (1280×720) for social sharing — social cards crop to
    // landscape, so the w500 poster (2:3) gets letterboxed. Backdrop first,
    // poster as a fallback when a backdrop isn't available.
    const image = show.backdrop_path
      ? getImageUrl(show.backdrop_path, "w1280")
      : show.poster_path
        ? getImageUrl(show.poster_path, "w500")
        : null;
    const url = `https://filmsnap-pro.netlify.app/tv/${id}`;

    return {
      title,
      description,
      keywords: [
        show.name,
        "TV show",
        "series",
        "streaming",
        "watch",
        ...(show.genres?.map((g: { name: string }) => g.name) || []),
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
                width: show.backdrop_path ? 1280 : 500,
                height: show.backdrop_path ? 720 : 750,
                alt: show.name,
              },
            ]
          : [],
        locale: "en_US",
        type: "video.tv_show",
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
      title: "TV Show Not Found - FilmSnaps",
      description: "The requested TV show could not be found.",
    };
  }
}

export default function TVLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      {children}
    </>
  );
}
