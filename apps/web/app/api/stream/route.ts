/**
 * Stream Proxy - Proxy video streams with proper headers
 * 
 * This proxy:
 * 1. Fetches video streams (m3u8, mp4, etc.)
 * 2. Handles range requests for seeking
 * 3. Returns proper CORS headers
 */

import { NextResponse } from 'next/server';
import { getCorsHeaders } from '@/lib/cors';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const urlParam = searchParams.get('url');
  
  if (!urlParam) {
    return new NextResponse('Missing url parameter', { status: 400 });
  }
  
  let videoUrl: string;
  try {
    videoUrl = decodeURIComponent(urlParam);
    new URL(videoUrl);
  } catch {
    return new NextResponse('Invalid URL', { status: 400 });
  }

  console.log(`[Stream Proxy] Fetching: ${videoUrl}`);

  try {
    // Get range header for seeking support
    const range = req.headers.get('range');
    
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Referer': new URL(videoUrl).origin + '/',
      'Origin': new URL(videoUrl).origin,
    };
    
    // Forward range header for seeking
    if (range) {
      headers['Range'] = range;
    }

    const response = await fetch(videoUrl, { headers });

    if (!response.ok) {
      console.error(`[Stream Proxy] Error: ${response.status}`);
      return new NextResponse(`Stream error: ${response.status}`, {
        status: response.status,
      });
    }

    // Build response headers
    const responseHeaders: Record<string, string> = {
      'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
      ...getCorsHeaders(req.headers.get('origin')),
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length',
    };

    // Forward important headers
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      responseHeaders['Content-Length'] = contentLength;
    }

    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      responseHeaders['Content-Range'] = contentRange;
      responseHeaders['Accept-Ranges'] = 'bytes';
    }

    const cacheControl = response.headers.get('cache-control');
    if (cacheControl) {
      responseHeaders['Cache-Control'] = cacheControl;
    }

    // Return stream
    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error('[Stream Proxy] Error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
