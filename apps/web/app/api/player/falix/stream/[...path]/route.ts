import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders, handleOptions } from "@/lib/cors";
import { desktopSkip } from "../../../../desktop-skip";

const FALIX_BASE = "https://dl.falixmovies.com";

// Catch-all routes need generateStaticParams for output: 'export'.
// Desktop never calls this route — return one dummy segment so it compiles.
export function generateStaticParams() {
  return [{ path: ["dl", "_placeholder", "_placeholder.mkv"] }];
}

export async function OPTIONS(request: Request) {
  return handleOptions(request);
}

/**
 * Streaming proxy for Falix /dl video files.
 *
 * Some mobile ISPs intermittently block dl.falixmovies.com outright
 * (connection-level, metadata API and /dl/ streams share the host). The
 * mobile app detects that during the metadata lookup and, when it happens,
 * reads the metadata AND streams the files through this worker route instead
 * — the same Cloudflare channel that already serves the TMDB pass-through.
 *
 * Mirrors /dl/{fileId}/{fileName} 1:1 with Range forwarding so the player
 * can seek; only that shape is proxied (not an open proxy).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const skip = desktopSkip();
  if (skip) return skip;
  const { path } = await params;
  const origin = request.headers.get("origin");

  if (path.length < 3 || path[0] !== "dl") {
    return NextResponse.json(
      { error: "Expected /api/player/falix/stream/dl/{fileId}/{fileName}" },
      { status: 400, headers: getCorsHeaders(origin) },
    );
  }

  const upstreamUrl = `${FALIX_BASE}/dl/${path
    .slice(1)
    .map(encodeURIComponent)
    .join("/")}`;

  const range = request.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: range ? { Range: range } : undefined,
      // No request timeout — this pipes a full video; the client aborts on
      // close and the stream ends with it.
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: `Falix upstream unreachable: ${error?.message ?? error}` },
      { status: 502, headers: getCorsHeaders(origin) },
    );
  }

  const headers = new Headers(getCorsHeaders(origin));
  headers.set("Cache-Control", "no-store");
  for (const h of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
  ]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
