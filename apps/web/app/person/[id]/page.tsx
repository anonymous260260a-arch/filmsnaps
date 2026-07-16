'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, Calendar, MapPin, Film, Star } from 'lucide-react';
import { getImageUrl } from '@/lib/tmdb';

export default function PersonPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [person, setPerson] = React.useState<any>(null);
  const [credits, setCredits] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    async function load() {
      try {
        const [personRes, creditsRes] = await Promise.all([
          fetch(`/api/tmdb/person/${id}`),
          fetch(`/api/tmdb/person/${id}/combined_credits`),
        ]);
        const personData = await personRes.json();
        const creditsData = await creditsRes.json();
        setPerson(personData);
        setCredits(creditsData.cast ?? []);
      } catch (e) {
        console.error('Failed to load person', e);
      }
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070708] flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-[#D4A237] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!person) {
    return (
      <div className="min-h-screen bg-[#070708] flex items-center justify-center flex-col gap-4 px-6">
        <div className="w-16 h-16 rounded-full bg-[#16161A] flex items-center justify-center">
          <Film className="w-8 h-8 text-[#52525B]" />
        </div>
        <p className="text-[#F4F4F5] text-lg font-semibold">Person not found</p>
        <Link href="/" className="bg-[#D4A237] rounded-xl py-3 px-8 text-[#070708] font-bold text-sm">
          Go Home
        </Link>
      </div>
    );
  }

  const movieCredits = credits
    .filter((c: any) => c.media_type === 'movie')
    .sort((a: any, b: any) => ((b.release_date || '') > (a.release_date || '') ? 1 : -1));

  const tvCredits = credits
    .filter((c: any) => c.media_type === 'tv')
    .sort((a: any, b: any) => ((b.first_air_date || '') > (a.first_air_date || '') ? 1 : -1));

  function CreditCard({ credit, type }: { credit: any; type: 'movie' | 'tv' }) {
    const href = type === 'movie' ? `/movie/${credit.id}` : `/tv/${credit.id}`;
    return (
      <Link href={href} className="flex-shrink-0 w-24 group">
        <div className="aspect-[2/3] rounded-lg overflow-hidden bg-[#16161A] mb-1.5 shadow-md ring-1 ring-white/[0.06]">
          {credit.poster_path ? (
            <Image
              src={getImageUrl(credit.poster_path, 'w185') ?? ''}
              alt={credit.title || credit.name || ''}
              width={96}
              height={144}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Film className="w-5 h-5 text-[#52525B]" />
            </div>
          )}
        </div>
        <p className="text-[#F4F4F5] text-[11px] font-medium truncate leading-tight">
          {credit.title || credit.name}
        </p>
        {credit.vote_average != null && (
          <div className="flex items-center gap-0.5 mt-0.5">
            <Star className="w-2.5 h-2.5 fill-[#D4A237] text-[#D4A237]" />
            <span className="text-[10px] text-[#D4A237] font-semibold">
              {credit.vote_average.toFixed(1)}
            </span>
          </div>
        )}
      </Link>
    );
  }

  return (
    <div className="min-h-screen bg-[#070708]">
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Back button */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-[#A1A1AA] hover:text-[#F4F4F5] transition-colors mb-6 text-sm font-medium"
          aria-label="Go back"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {/* Profile */}
        <div className="flex flex-col items-center mb-8">
          {person.profile_path ? (
            <div className="w-28 h-28 rounded-full overflow-hidden mb-4 ring-2 ring-white/[0.06] shadow-lg">
              <Image
                src={getImageUrl(person.profile_path, 'w185') ?? ''}
                alt={person.name}
                width={112}
                height={112}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="w-28 h-28 rounded-full bg-[#16161A] flex items-center justify-center mb-4">
              <span className="text-[#52525B] text-3xl font-bold">{person.name?.charAt(0)}</span>
            </div>
          )}
          <h1
            className="text-2xl font-bold text-[#F4F4F5] text-center"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {person.name}
          </h1>
          {person.known_for_department && (
            <p className="text-[#52525B] text-sm mt-1">{person.known_for_department}</p>
          )}
          {person.birthday && (
            <div className="flex items-center gap-1.5 mt-2 text-[#A1A1AA] text-xs">
              <Calendar className="w-3.5 h-3.5" />
              <span>{person.birthday}{person.deathday ? ` — ${person.deathday}` : ''}</span>
            </div>
          )}
          {person.place_of_birth && (
            <div className="flex items-center gap-1.5 mt-1 text-[#A1A1AA] text-xs">
              <MapPin className="w-3.5 h-3.5" />
              <span>{person.place_of_birth}</span>
            </div>
          )}
        </div>

        {/* Biography */}
        {person.biography && (
          <div className="mb-8">
            <h2
              className="text-lg font-bold text-[#F4F4F5] mb-3"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Biography
            </h2>
            <p className="text-[#A1A1AA] text-sm leading-relaxed whitespace-pre-line">
              {person.biography}
            </p>
          </div>
        )}

        {/* Movie Credits */}
        {movieCredits.length > 0 && (
          <div className="mb-8">
            <h2
              className="text-lg font-bold text-[#F4F4F5] mb-4"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Movies
            </h2>
            <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2 -mx-4 px-4">
              {movieCredits.slice(0, 20).map((credit: any) => (
                <CreditCard key={`m-${credit.id}`} credit={credit} type="movie" />
              ))}
            </div>
          </div>
        )}

        {/* TV Credits */}
        {tvCredits.length > 0 && (
          <div className="mb-8">
            <h2
              className="text-lg font-bold text-[#F4F4F5] mb-4"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              TV Shows
            </h2>
            <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2 -mx-4 px-4">
              {tvCredits.slice(0, 20).map((credit: any) => (
                <CreditCard key={`t-${credit.id}`} credit={credit} type="tv" />
              ))}
            </div>
          </div>
        )}

        <div className="h-12" />
      </div>
    </div>
  );
}
