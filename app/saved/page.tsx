'use client';

import { useEffect, useState } from 'react';
import { useWatchlist } from '@/hooks/useWatchlist';
import { Header } from '@/components/Header';
import { MovieCard } from '@/components/MovieCard';
import { Bookmark, Film, BookOpen } from 'lucide-react';
import Link from 'next/link';
import { GlassButton } from '@/components/ui/glass-button';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/AuthProvider';

export default function SavedPage() {
  const { savedMovies, loading, removeMovie } = useWatchlist();
  const { user } = useAuth();
  const { toast } = useToast();
  const [showGuestNotice, setShowGuestNotice] = useState(false);

  useEffect(() => {
    if (!user && !localStorage.getItem('filmsnaps_hide_guest_notice')) {
      setShowGuestNotice(true);
    }
  }, [user]);

  const handleRemove = async (id: number, title: string) => {
    const success = await removeMovie(id);
    if (success) {
      toast({
        title: 'Removed from watchlist',
        description: `${title} was removed`,
      });
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="pt-24 px-4 sm:px-6 md:px-12 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight">Your Watchlist</h1>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Movies and shows you&apos;ve saved
            </p>
          </div>
          {savedMovies.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-semibold">
              <Bookmark className="h-4 w-4 fill-current" />
              <span>{savedMovies.length}</span>
            </div>
          )}
        </div>

        {/* Guest notice */}
        {showGuestNotice && (
          <div className="mb-8 rounded-xl border border-white/[0.06] glass-light p-5 text-sm text-muted-foreground flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BookOpen className="h-4 w-4 text-primary" />
              <span>
                Saved movies are stored locally.{' '}
                <Link href="/auth" className="text-primary hover:underline font-medium">
                  Sign in
                </Link>{' '}
                to save permanently.
              </span>
            </div>
            <button
              onClick={() => {
                setShowGuestNotice(false);
                localStorage.setItem('filmsnaps_hide_guest_notice', 'true');
              }}
              className="text-muted-foreground/50 hover:text-foreground transition-colors ml-4"
              aria-label="Dismiss"
            >
              <span className="text-lg leading-none">&times;</span>
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] rounded-xl bg-secondary/30 animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && savedMovies.length === 0 && (
          <div className="py-24 text-center">
            <div className="w-20 h-20 rounded-full bg-secondary/30 flex items-center justify-center mx-auto mb-6">
              <Bookmark className="h-9 w-9 text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              Your collection awaits
            </h2>
            <p className="text-muted-foreground mb-8 max-w-sm mx-auto">
              Start saving movies and TV shows to build your personal watchlist.
            </p>
            <Link href="/movie">
              <GlassButton className="gap-2 px-6 py-3 h-auto text-sm font-bold">
                <Film className="h-4 w-4" />
                Browse Movies
              </GlassButton>
            </Link>
          </div>
        )}

        {/* Saved grid */}
        {!loading && savedMovies.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-5 lg:gap-6">
            {savedMovies.map((movie) => (
              <MovieCard
                key={movie.id}
                item={movie}
                variant="saved"
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
