/**
 * History page — list of recently watched items with progress bars and resume buttons.
 */

'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Play, Trash2, ArrowLeft } from 'lucide-react';
import { Header } from '@/components/Header';
import { createLocalStorageAdapter } from '@filmsnaps/shared';
import { useWatchHistory } from '@filmsnaps/shared';
import type { WatchProgress } from '@filmsnaps/shared';

const storage = createLocalStorageAdapter();

function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export default function HistoryPage() {
  const { entries, loading, clearAll, removeEntry, refresh } = useWatchHistory(storage);
  const [grouped, setGrouped] = useState<WatchProgress[]>([]);

  // Group TV entries by TMDB id + season (only show latest episode per group)
  useEffect(() => {
    const seen = new Set<string>();
    const result: WatchProgress[] = [];
    for (const entry of entries) {
      const key = entry.mediaType === 'tv'
        ? `${entry.tmdbId}-s${entry.season}`
        : `movie-${entry.tmdbId}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(entry);
      }
    }
    setGrouped(result);
  }, [entries]);

  return (
    <div className="min-h-screen bg-[#070708] text-[#F4F4F5]">
      <Header />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 pt-24 pb-16">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1
              className="text-2xl sm:text-3xl font-bold tracking-tight"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Watch History
            </h1>
            <p className="text-sm text-[#A1A1AA] mt-1">
              {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
            </p>
          </div>
          {entries.length > 0 && (
            <button
              onClick={clearAll}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#E05252]/10 text-[#E05252] hover:bg-[#E05252]/20 text-sm font-medium transition-all"
            >
              <Trash2 size={14} />
              Clear All
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-center py-16 text-[#A1A1AA]">Loading...</div>
        ) : grouped.length === 0 ? (
          <div className="text-center py-16">
            <Play className="w-12 h-12 mx-auto mb-4 text-[#52525B]" />
            <p className="text-lg font-medium text-[#A1A1AA]">No watch history yet</p>
            <p className="text-sm text-[#52525B] mt-1">
              Start watching something to see it here
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 rounded-xl bg-[#D4A237] text-[#070708] text-sm font-semibold hover:bg-[#B88B2A] transition-all"
            >
              Browse Movies
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {grouped.map((entry, i) => (
              <div
                key={`${entry.tmdbId}-${i}`}
                className="flex items-center gap-4 p-4 rounded-xl bg-[#0E0E11] border border-[#222226] hover:border-[#D4A237]/20 transition-all group"
              >
                {/* Poster placeholder */}
                <div className="w-14 h-20 rounded-lg bg-gradient-to-br from-[#16161A] to-[#0E0E11] flex-shrink-0 overflow-hidden ring-1 ring-white/[0.06]">
                  <div className="w-full h-full bg-[#222226]" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#F4F4F5] truncate">
                    {entry.mediaType === 'tv'
                      ? `TV Show ${entry.season ? `S${entry.season}` : ''} ${entry.episode ? `E${entry.episode}` : ''}`
                      : 'Movie'}
                  </p>
                  <p className="text-xs text-[#A1A1AA] mt-0.5">
                    {entry.percent > 0
                      ? `${Math.round(entry.percent * 100)}% • ${formatTime(entry.currentTime)} of ${formatTime(entry.duration)}`
                      : 'Not started'}
                  </p>
                  <p className="text-[10px] text-[#52525B] mt-0.5">
                    {new Date(entry.updatedAt).toLocaleDateString()}
                  </p>
                  {/* Progress bar */}
                  <div className="mt-1.5 h-[3px] bg-[#222226] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#5B9CF6] rounded-full"
                      style={{ width: `${Math.min(entry.percent * 100, 100)}%` }}
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <Link
                    href={
                      entry.mediaType === 'tv'
                        ? `/watch/tv/${entry.tmdbId}?season=${entry.season ?? 1}&episode=${entry.episode ?? 1}`
                        : `/watch/movie/${entry.tmdbId}`
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D4A237]/10 text-[#D4A237] hover:bg-[#D4A237]/20 text-xs font-semibold transition-all"
                  >
                    <Play size={12} />
                    Resume
                  </Link>
                  <button
                    onClick={() => removeEntry(entry.tmdbId, entry.mediaType, entry.season, entry.episode)}
                    className="p-1.5 rounded-lg text-[#52525B] hover:text-[#E05252] hover:bg-[#E05252]/10 transition-all"
                    aria-label="Remove entry"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
