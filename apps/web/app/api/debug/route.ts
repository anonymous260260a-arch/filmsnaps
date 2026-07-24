import { NextResponse } from 'next/server';

export async function GET() {
  // Only expose debug info in development
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  const hasKey = !!process.env.TMDB_API_KEY;

  return NextResponse.json({
    tmdb_key_set: hasKey,
    node_env: process.env.NODE_ENV,
    next_runtime: process.env.NEXT_RUNTIME,
    has_cf_account: !!process.env.CF_ACCOUNT_ID,
  });
}
