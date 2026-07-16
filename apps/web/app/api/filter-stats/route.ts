/**
 * Filter Stats API — diagnostic endpoint to check filter engine state.
 *
 * GET /api/filter-stats
 *
 * Returns engine load status, filter counts, and block/match stats.
 * Useful for verifying the ad-blocking system is working.
 *
 * GET /api/filter-stats?debug=1
 * Also shows path resolution info for debugging.
 */

import { NextResponse } from 'next/server';
import { isFilterEngineLoaded, getFilterEngine, getFilterStats } from '@/lib/movieProviders/filterService';

export async function GET() {
  const loaded = isFilterEngineLoaded();
  const stats = getFilterStats();
  let filterCounts = null;

  if (loaded) {
    const engine = getFilterEngine();
    if (engine) {
      const filters = engine.getFilters();
      filterCounts = {
        network: filters.networkFilters.length,
        cosmetic: filters.cosmeticFilters.length,
        total: filters.networkFilters.length + filters.cosmeticFilters.length,
      };
    }
  }

  return NextResponse.json({
    status: loaded ? 'active' : 'inactive',
    engine: {
      loaded,
      engineVersion: 'cliqz-adblocker-1.34',
    },
    filters: filterCounts,
    runtime: stats,
  });
}
