/**
 * ContinueWatchingWrapper — client component that reads watch history
 * and renders the ContinueWatching rail.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { createLocalStorageAdapter } from '@filmsnaps/shared';
import { useWatchHistory } from '@filmsnaps/shared';
import { ContinueWatching } from '@/components/ContinueWatching';
import type { WatchProgress } from '@filmsnaps/shared';

const storage = createLocalStorageAdapter();

export function ContinueWatchingWrapper() {
  const { entries, loading } = useWatchHistory(storage);
  const [inProgress, setInProgress] = useState<WatchProgress[]>([]);

  useEffect(() => {
    // Only show items that aren't fully watched and have meaningful progress
    const filtered = entries.filter(
      (e) => !e.completed && e.currentTime > 10,
    );
    setInProgress(filtered);
  }, [entries]);

  if (loading || inProgress.length === 0) return null;

  return <ContinueWatching entries={inProgress} />;
}
