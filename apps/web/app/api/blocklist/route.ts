/**
 * Blocklist API — serves the remote blocklist config for the mobile app.
 *
 * GET /api/blocklist
 *
 * Reads from the root blocklist.json which is the single source of truth.
 * The Android app's BlocklistConfigLoader fetches this on every launch.
 *
 * Update flow: edit blocklist.json in the repo → deploy → app picks up
 * new config on next restart (cached for 6 hours).
 *
 * To force an immediate update on all clients, bump the `version` field.
 */

import { NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Read the root blocklist.json — single source of truth
    const blocklistPath = join(process.cwd(), '..', '..', 'blocklist.json');
    const raw = readFileSync(blocklistPath, 'utf-8');
    const data = JSON.parse(raw);

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        'Content-Type': 'application/json',
      },
    });
  } catch (e) {
    // Fallback: return a minimal V2 config if the file can't be read
    return NextResponse.json({
      version: 2,
      allowedCdnHosts: [
        'akamai.net', 'akamaiedge.net', 'cloudfront.net',
        'fastly.net', 'fastlylb.net',
        'fonts.googleapis.com', 'fonts.gstatic.com',
        'image.tmdb.org', 'api.themoviedb.org',
        'gstatic.com',
      ],
      blockedDomains: [],
      providerProfiles: {},
      providerRootHosts: [],
      rules: {
        videoDetection: {
          extensions: ['m3u8', 'mpd', 'ts', 'm4s', 'mp4', 'webm', 'key'],
          pathPatterns: [
            '^/(embed|movie|tv|watch|player)/\\d+/.*(\\.(m3u8|mpd|mp4))',
          ],
          enableSessionTrust: true,
        },
      },
      providers: [],
    }, { headers: { 'Content-Type': 'application/json' } });
  }
}
