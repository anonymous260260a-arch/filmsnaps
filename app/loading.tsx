// app/loading.tsx
import { SkeletonHero, SkeletonRow } from '@/components/SkeletonLoader';

export default function Loading() {
  return (
    <div className="min-h-screen bg-background">
      <SkeletonHero />
      <div className="space-y-16 py-14">
        <SkeletonRow />
        <div className="mx-auto w-3/4 h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
        <SkeletonRow />
      </div>
    </div>
  );
}
