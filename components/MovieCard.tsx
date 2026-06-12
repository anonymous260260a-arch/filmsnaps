'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Play, Star, X } from 'lucide-react';
import { getImageUrl, tmdbApi } from '@/lib/tmdb';
import { SaveButton } from '@/components/SaveButton';
import { GlassButton } from '@/components/ui/glass-button';
import { Movie } from '@/types';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from './ui/button';
import { useRouter } from 'next/navigation';

interface MovieCardProps {
  item: Movie;
  mediaType?: string;
  className?: string;
  variant?: 'default' | 'saved';
  onRemove?: (id: number, title: string) => void;
}

export function MovieCard({
  item,
  mediaType,
  className = '',
  variant = 'default',
  onRemove,
}: MovieCardProps) {
  const router = useRouter();
  const type = mediaType || item.media_type || 'movie';
  const title = item.title || item.name;
  const posterPath = item.poster_path || item.poster;
  const rating = item.vote_average?.toFixed(1);
  const releaseDate = item.release_date || item.first_air_date;
  const year = releaseDate ? new Date(releaseDate).getFullYear() : '';
  const queryClient = useQueryClient();

  const prefetchMovie = () => {
    queryClient.prefetchQuery({
      queryKey: ['movie', item.id],
      queryFn: () => tmdbApi.getMovieDetails(item.id),
      staleTime: 10 * 60 * 1000,
    });
  };

  return (
    <div className={`group relative ${className}`}>
      {/* Poster */}
      <Link
        prefetch
        href={`/${type}/${item.id}`}
        className="block"
        onMouseEnter={prefetchMovie}
      >
        <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-secondary shadow-lg transition-all duration-500 group-hover:shadow-2xl group-hover:shadow-primary/5">
          {posterPath ? (
            <Image
              src={getImageUrl(posterPath, 'w500') || ''}
              alt={title ?? 'Movie poster'}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, (max-width: 1280px) 20vw, 16vw"
              loading="lazy"
              quality={85}
              className="object-cover transition-all duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No Image
            </div>
          )}

          {/* Hover overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

          {/* Hover actions */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0">
            <Button
              onClick={(e) => {
                e.preventDefault();
                router.push(`/watch/${type}/${item.id}`);
              }}
              className="gap-2 px-5 py-2 h-auto rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white text-sm font-medium hover:bg-white/20 transition-all"
            >
              <Play className="w-4 h-4 fill-current" />
              Watch Now
            </Button>
            <SaveButton
              movie={item}
              size="sm"
              className="bg-white/5 backdrop-blur-sm border border-white/10 text-white/80 hover:bg-white/15"
            />
          </div>

          {/* Rating badge — always visible */}
          {rating && variant === 'default' && (
            <div className="absolute top-2.5 right-2.5 flex items-center gap-1 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-lg border border-white/[0.06]">
              <Star className="h-3 w-3 text-amber-accent fill-amber-accent" />
              <span className="text-xs font-semibold text-white">{rating}</span>
            </div>
          )}

          {/* Saved remove button */}
          {variant === 'saved' && (
            <div className="absolute top-2.5 left-2.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <GlassButton
                size="icon"
                variant="destructive"
                className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm border border-white/[0.1]"
                aria-label="Remove from watchlist"
                onClick={(e) => {
                  e.preventDefault();
                  onRemove?.(item.id, title || 'Movie');
                }}
              >
                <X className="h-4 w-4" />
              </GlassButton>
            </div>
          )}
        </div>
      </Link>

      {/* Info below card */}
      <Link href={`/${type}/${item.id}`} className="block mt-2.5 space-y-0.5 px-0.5">
        <h3 className="text-sm font-semibold text-foreground/90 line-clamp-1 group-hover:text-primary transition-colors duration-200">
          {title}
        </h3>
        {year && (
          <p className="text-xs text-muted-foreground/70">{year}</p>
        )}
      </Link>
    </div>
  );
}
