'use client';

import { useState } from 'react';
import { Bookmark } from 'lucide-react';
import { GlassButton } from '@/components/ui/glass-button';
import { useWatchlist } from '@/hooks/useWatchlist';
import { Movie } from '@filmsnaps/shared';
import { useToast } from '@/hooks/use-toast';

interface SaveButtonProps {
  movie: Movie;
  variant?: 'default' | 'secondary' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
  showLabel?: boolean;
}

export function SaveButton({
  movie,
  variant = 'secondary',
  size = 'default',
  className = '',
  showLabel = true
}: SaveButtonProps) {
  const { isMovieSaved, toggleSaveMovie } = useWatchlist();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const isSaved = isMovieSaved(movie.id);

  const handleClick = async () => {
    setIsLoading(true);
    try {
      const success = await toggleSaveMovie(movie);
      if (success) {
        toast({
          title: isSaved ? 'Removed from watchlist' : 'Added to watchlist',
          description: isSaved
            ? `${movie.title} has been removed from your watchlist`
            : `${movie.title} has been added to your watchlist`,
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update watchlist',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <GlassButton
      variant={isSaved ? 'default' : variant}
      size={size}
      className={`gap-2 transition-all duration-300 ${className} ${
        isSaved ? 'shadow-lg shadow-primary/10' : ''
      }`}
      onClick={handleClick}
      disabled={isLoading}
      aria-label={
        isSaved
          ? `Remove ${movie.title} from watchlist`
          : `Add ${movie.title} to watchlist`
      }
    >
      <Bookmark
        className={`h-4 w-4 transition-all duration-300 ${
          isSaved ? 'fill-current scale-110 drop-shadow-[0_0_6px_hsl(var(--primary)/0.5)]' : ''
        }`}
      />
      {showLabel && (isSaved ? 'Saved' : 'Save')}
    </GlassButton>
  );
}
