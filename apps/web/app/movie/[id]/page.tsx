import { getImageUrl } from "@/lib/tmdb";
import MovieClient from "./MovieClient";
import { tmdbMovieFull } from "@/lib/tmdb.server";
import { JsonLd } from "@/components/JsonLd";

const SITE = "https://filmsnap-pro.netlify.app";

/**
 * Build Movie + BreadcrumbList JSON-LD for a film detail page.
 * Only present when the movie resolved (not the not-found fallback).
 */
function movieSchema(movie: any) {
  const url = `${SITE}/movie/${movie.id}`;
  const image =
    getImageUrl(movie.backdrop_path, "w1280") ||
    getImageUrl(movie.poster_path, "w500");

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Movie",
        "@id": `${url}#movie`,
        name: movie.title,
        description: movie.overview || undefined,
        url,
        image: image || undefined,
        datePublished: movie.release_date || undefined,
        genre: movie.genres?.map((g: any) => g.name),
        ...(movie.vote_count > 0
          ? {
              aggregateRating: {
                "@type": "AggregateRating",
                ratingValue: movie.vote_average,
                ratingCount: movie.vote_count,
                bestRating: 10,
              },
            }
          : {}),
        ...(movie.credits?.crew?.some((c: any) => c.job === "Director")
          ? {
              director: movie.credits.crew
                .filter((c: any) => c.job === "Director")
                .slice(0, 3)
                .map((c: any) => ({ "@type": "Person", name: c.name })),
            }
          : {}),
        ...(movie.credits?.cast?.length
          ? {
              actor: movie.credits.cast
                .slice(0, 8)
                .map((c: any) => ({ "@type": "Person", name: c.name })),
            }
          : {}),
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: SITE },
          {
            "@type": "ListItem",
            position: 2,
            name: "Movies",
            item: `${SITE}/movie`,
          },
          { "@type": "ListItem", position: 3, name: movie.title, item: url },
        ],
      },
    ],
  };
}

export default async function MoviePage({ params }: { params: any }) {
  const { id } = await params;
  const movie = await tmdbMovieFull(id);
  // tmdb() returns { results: [] } on fetch failure (never throws), so check
  // for a real movie by the presence of an id rather than truthiness.
  if (!movie || !movie.id) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-muted-foreground">Movie not found</div>
      </div>
    );
  }

  return (
    <>
      <JsonLd data={movieSchema(movie)} />
      <MovieClient movie={movie} />
    </>
  );
}
