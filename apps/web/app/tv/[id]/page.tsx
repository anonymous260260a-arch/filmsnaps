// app/tv/[id]/page.tsx
import { getImageUrl } from "@/lib/tmdb";
import { tmdbTvFull } from "@/lib/tmdb.server";
import TVClient from "./TVClient";
import { JsonLd } from "@/components/JsonLd";

const SITE = "https://filmsnap-pro.netlify.app";

/**
 * Build TVSeries + BreadcrumbList JSON-LD for a show detail page.
 * Only present when the show resolved (not the not-found fallback).
 */
function tvSchema(show: any) {
  const url = `${SITE}/tv/${show.id}`;
  const image =
    getImageUrl(show.backdrop_path, "w1280") ||
    getImageUrl(show.poster_path, "w500");

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TVSeries",
        "@id": `${url}#tvseries`,
        name: show.name,
        description: show.overview || undefined,
        url,
        image: image || undefined,
        datePublished: show.first_air_date || undefined,
        genre: show.genres?.map((g: any) => g.name),
        ...(show.vote_count > 0
          ? {
              aggregateRating: {
                "@type": "AggregateRating",
                ratingValue: show.vote_average,
                ratingCount: show.vote_count,
                bestRating: 10,
              },
            }
          : {}),
        ...(show.credits?.cast?.length
          ? {
              actor: show.credits.cast
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
            name: "TV Shows",
            item: `${SITE}/tv`,
          },
          { "@type": "ListItem", position: 3, name: show.name, item: url },
        ],
      },
    ],
  };
}

export default async function TVShowPage({ params }: { params: any }) {
  const { id } = await params;

  // tmdb() returns { results: [] } on fetch failure (never throws), so check
  // for a real show by the presence of an id rather than truthiness.
  const show = await tmdbTvFull(id);
  if (!show || !show.id) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-muted-foreground">TV show not found</div>
      </div>
    );
  }

  return (
    <>
      <JsonLd data={tvSchema(show)} />
      <TVClient show={show} />
    </>
  );
}
