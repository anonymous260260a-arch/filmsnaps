import { cn } from '@/lib/utils';

export function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-secondary/30">
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
      </div>
      <div className="mt-2.5 space-y-2 px-0.5">
        <div className="h-4 bg-secondary/30 rounded w-3/4"></div>
        <div className="h-3 bg-secondary/30 rounded w-1/2"></div>
      </div>
    </div>
  );
}

export function SkeletonHero() {
  return (
    <div className="relative w-full h-[90vh] min-h-[600px] overflow-hidden animate-pulse">
      <div className="absolute inset-0 bg-secondary/20"></div>
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
      <div className="absolute inset-0 gradient-hero-text" />

      <div className="absolute inset-0 flex items-center">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-7 w-16 bg-secondary/30 rounded-full"></div>
              <div className="h-5 w-12 bg-secondary/20 rounded"></div>
              <div className="h-5 w-20 bg-secondary/20 rounded"></div>
            </div>
            <div className="h-16 bg-secondary/30 rounded w-3/4 mb-6"></div>
            <div className="space-y-3 mb-8">
              <div className="h-4 bg-secondary/30 rounded w-full"></div>
              <div className="h-4 bg-secondary/30 rounded w-5/6"></div>
              <div className="h-4 bg-secondary/30 rounded w-4/6"></div>
            </div>
            <div className="flex gap-3">
              <div className="h-12 w-36 bg-secondary/30 rounded-xl"></div>
              <div className="h-12 w-28 bg-secondary/20 rounded-xl"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 20 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="relative group">
      <div className="flex items-center justify-between px-5 sm:px-6 lg:px-8 mb-4">
        <h2 className="h-8 bg-secondary/30 rounded w-1/4 animate-pulse"></h2>
      </div>
      <div className="relative px-5 sm:px-6 lg:px-8">
        <div className="pb-10">
          <div className="grid grid-flow-col auto-cols-max gap-4 overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="w-[200px]">
                <SkeletonCard />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
