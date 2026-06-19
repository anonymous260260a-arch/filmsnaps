'use client';

import { MovieCard } from '@/components/MovieCard';

export function MediaGrid({
  items,
  mediaType
}: {
  items: any[];
  mediaType: string;
}) {
  if (!items?.length) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-5 lg:gap-6 px-4 sm:px-6">
      {items.map((item) => (
        <MovieCard key={item.id} item={item} mediaType={mediaType} />
      ))}
    </div>
  );
}
