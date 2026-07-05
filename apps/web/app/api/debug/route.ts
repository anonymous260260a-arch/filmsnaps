import { NextResponse } from 'next/server';

export async function GET() {
  const hasKey = !!process.env.TMDB_API_KEY;
  const keyPrefix = process.env.TMDB_API_KEY
    ? process.env.TMDB_API_KEY.substring(0, 4) + '...'
    : 'NOT SET';

  return NextResponse.json({
    tmdb_key_set: hasKey,
    tmdb_key_prefix: keyPrefix,
    node_env: process.env.NODE_ENV,
    next_runtime: process.env.NEXT_RUNTIME,
    has_cf_account: !!process.env.CF_ACCOUNT_ID,
  });
}
