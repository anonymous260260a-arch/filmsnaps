/**
 * ContinueWatching — horizontal scroll of in-progress media.
 *
 * Reads from localStorage-based watch history. Each card shows
 * a poster with a 3px blue progress bar at the bottom.
 */

'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Play } from 'lucide-react';
import { getImageUrl } from '@/lib/tmdb';
import type { WatchProgress } from '@filmsnaps/shared';

interface ContinueWatchingProps {
  entries: WatchProgress[];
}

export function ContinueWatching({ entries }: ContinueWatchingProps) {
  if (!entries || entries.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2
        className="text-xl font-bold tracking-tight text-[#F4F4F5]"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Continue Watching
      </h2>
      <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2 -mx-4 px-4">
        {entries.slice(0, 10).map((entry, i) => (
          <Link
            key={`${entry.tmdbId}-${entry.season ?? ''}-${entry.episode ?? ''}-${i}`}
            href={
              entry.mediaType === 'tv'
                ? `/watch/tv/${entry.tmdbId}?season=${entry.season ?? 1}&episode=${entry.episode ?? 1}`
                : `/watch/movie/${entry.tmdbId}`
            }
            className="flex-shrink-0 w-28 group"
          >
            <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-[#222226] shadow-lg ring-1 ring-white/[0.06] mb-2">
              {/* Poster would need TMDB data here — show placeholder */}
              <div className="w-full h-full bg-gradient-to-br from-[#16161A] to-[#0E0E11] flex items-center justify-center">
                <Play className="w-8 h-8 text-[#D4A237]/40" />
              </div>

              {/* Progress bar */}
              <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#222226]">
                <div
                  className="h-full bg-[#5B9CF6] transition-all"
                  style={{ width: `${Math.min(entry.percent * 100, 100)}%` }}
                />
              </div>

              {/* Hover overlay */}
              <div className="absolute inset-0 bg-[#D4A237]/0 group-hover:bg-[#D4A237]/10 transition-all" />
            </div>
            <p className="text-xs font-medium text-[#F4F4F5] truncate leading-tight">
              {entry.mediaType === 'tv'
                ? `S${entry.season ?? '?'} E${entry.episode ?? '?'}`
                : 'Movie'}
            </p>
            <p className="text-[10px] text-[#A1A1AA] truncate">
              {Math.round((entry.percent ?? 0) * 100)}%
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
