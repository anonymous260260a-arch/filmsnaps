import { Metadata } from "next";
import { getImageUrl } from "@/lib/tmdb";
import { tmdb } from "@/lib/tmdb.server";
import PersonClient from "./PersonClient";
import { JsonLd } from "@/components/JsonLd";

const SITE = "https://filmsnap-pro.netlify.app";

/** Trim a biography to a clean ~160-char meta description. */
function bioDescription(biography?: string): string {
  if (!biography)
    return `FilmSnaps — profile for this actor, director, and crew member.`;
  const clean = biography.replace(/\s+/g, " ").trim();
  return clean.length > 160 ? `${clean.slice(0, 157).trimEnd()}…` : clean;
}

export async function generateMetadata({
  params,
}: {
  params: any;
}): Promise<Metadata> {
  const { id } = await params;
  const person = await tmdb(`/person/${id}`);
  if (!person || !person.id) {
    return {
      title: "Person Not Found - FilmSnaps",
      description: "The requested person could not be found.",
    };
  }

  const url = `https://filmsnap-pro.netlify.app/person/${id}`;
  const image = getImageUrl(person.profile_path, "w500");
  const description = bioDescription(person.biography);

  return {
    title: `${person.name} - FilmSnaps`,
    description,
    keywords: [
      person.name,
      "actor",
      "actress",
      "director",
      "filmography",
      "movies",
      "TV shows",
    ].join(", "),
    authors: [{ name: "FilmSnaps" }],
    creator: "FilmSnaps",
    publisher: "FilmSnaps",
    openGraph: {
      title: `${person.name} - FilmSnaps`,
      description,
      url,
      siteName: "FilmSnaps",
      images:
        image && image !== "/placeholder.jpg"
          ? [{ url: image, width: 500, height: 750, alt: person.name }]
          : [],
      locale: "en_US",
      type: "profile",
    },
    twitter: {
      card: "summary_large_image",
      title: `${person.name} - FilmSnaps`,
      description,
      images: image && image !== "/placeholder.jpg" ? [image] : [],
      creator: "@filmsnaps",
    },
    alternates: { canonical: url },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
  };
}

/** Build Person + BreadcrumbList JSON-LD for the person page. */
function personSchema(person: any) {
  const url = `${SITE}/person/${person.id}`;
  const image = getImageUrl(person.profile_path, "w500");

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Person",
        "@id": `${url}#person`,
        name: person.name,
        url,
        image: image !== "/placeholder.jpg" ? image : undefined,
        ...(person.birthday ? { birthDate: person.birthday } : {}),
        ...(person.deathday ? { deathDate: person.deathday } : {}),
        ...(person.place_of_birth ? { birthPlace: person.place_of_birth } : {}),
        ...(person.known_for_department
          ? { jobTitle: person.known_for_department }
          : {}),
        description: bioDescription(person.biography),
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: SITE },
          { "@type": "ListItem", position: 2, name: person.name, item: url },
        ],
      },
    ],
  };
}

export default async function PersonPage({ params }: { params: any }) {
  const { id } = await params;

  const [person, credits] = await Promise.all([
    tmdb(`/person/${id}`),
    tmdb(`/person/${id}/combined_credits`),
  ]);

  // tmdb() returns { results: [] } on fetch failure (never throws); guard on
  // a real id so the not-found block and schema never run on garbage.
  if (!person || !person.id) {
    return (
      <div className="min-h-screen bg-[#070708] flex items-center justify-center flex-col gap-4 px-6">
        <div className="w-16 h-16 rounded-full bg-[#16161A] flex items-center justify-center">
          <span className="text-faint text-2xl font-bold">?</span>
        </div>
        <p className="text-foreground text-lg font-semibold">
          Person not found
        </p>
        <a
          href="/"
          className="bg-[#D4A237] rounded-xl py-3 px-8 text-[#070708] font-bold text-sm"
        >
          Go Home
        </a>
      </div>
    );
  }

  return (
    <>
      <JsonLd data={personSchema(person)} />
      <PersonClient person={person} credits={credits?.cast ?? []} />
    </>
  );
}
