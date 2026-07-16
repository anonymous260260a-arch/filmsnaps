/**
 * CastCarousel — horizontal scroll of circular cast member avatars.
 * Clicking/tapping navigates to the person detail page.
 *
 * Feature parity with mobile — shows profile picture, name, and character.
 */

'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { getImageUrl } from '@/lib/tmdb';

interface CastMember {
  id: number;
  name: string;
  character?: string;
  profile_path: string | null;
}

interface CastCarouselProps {
  cast: CastMember[];
  /** Max number of cast members to show */
  limit?: number;
}

export function CastCarousel({ cast, limit = 12 }: CastCarouselProps) {
  if (!cast || cast.length === 0) return null;

  const displayCast = cast.slice(0, limit);

  return (
    <div className="space-y-4">
      <h2
        className="text-xl font-bold tracking-tight text-[#F4F4F5]"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Cast
      </h2>
      <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 -mx-4 px-4">
        {displayCast.map((member) => (
          <Link
            key={member.id}
            href={`/person/${member.id}`}
            className="flex-shrink-0 w-20 text-center group"
          >
            <div className="w-20 h-20 rounded-full overflow-hidden bg-[#222226] ring-1 ring-white/[0.06] mb-2 mx-auto transition-transform group-hover:scale-105">
              {member.profile_path ? (
                <Image
                  src={getImageUrl(member.profile_path, 'w185') ?? ''}
                  alt={member.name}
                  width={80}
                  height={80}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[#52525B] text-lg font-bold">
                  {member.name.charAt(0)}
                </div>
              )}
            </div>
            <p className="text-xs font-medium text-[#F4F4F5] truncate leading-tight">
              {member.name}
            </p>
            {member.character && (
              <p className="text-[10px] text-[#A1A1AA] truncate leading-tight mt-0.5">
                {member.character}
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
