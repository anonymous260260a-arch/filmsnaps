// components/MediaCarouselClient.tsx
'use client';

import dynamic from 'next/dynamic';
import { SkeletonRow } from './SkeletonLoader';

export const MediaCarouselClient = dynamic(
  () =>
    import('./MediaCarousel').then((mod) => ({ default: mod.MediaCarousel })),
  { ssr: false, loading: () => <SkeletonRow /> }
);
