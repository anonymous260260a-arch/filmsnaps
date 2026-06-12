/**
 * Video Extractor API - Extract video URLs from provider pages
 * 
 * This API:
 * 1. Fetches the provider embed page
 * 2. Extracts the video URL (m3u8, mp4, etc.)
 * 3. Returns the video URL for direct playback
 * 
 * NO iframe needed - plays video directly in custom player
 */

import { NextResponse } from 'next/server';
import { JSDOM } from 'jsdom';

// Tracker patterns (for logging, not blocking)
const TRACKER_PATTERNS = [
  'cdn-cgi/rum',
  'cloudflareinsights.com',
  'googletagmanager.com',
  'google-analytics.com',
  'doubleclick.net',
  'facebook.com/tr',
  'histats.com',
];

// Provider base URLs
const PROVIDERS: Record<string, string> = {
  vidking: 'https://www.vidking.net',
  vidsrc: 'https://vidsrc.wtf',
  vidsrc2: 'https://vidsrc.wtf',
  vidsrc3: 'https://vidsrc.wtf',
  vidsrc4: 'https://vidsrc.wtf',
  vidsrc5: 'https://vidsrc.su',
  vidsrc6: 'https://vidsrc-embed.ru',
  vidsrc7: 'https://vidlink.pro',
  vidnest: 'https://vidnest.fun',
  primesrc: 'https://primesrc.me',
  vidpro: 'https://vidlink.pro',
  vixsrc: 'https://vixsrc.to',
  vidfast: 'https://vidfast.pro',
  moviesapi: 'https://moviesapi.club',
  vidup: 'https://vidup.to',
  indraembed: 'https://indraembed.netlify.app',
};

/**
 * Extract video URL from HTML content
 */
function extractVideoUrl(html: string, baseUrl: string): string | null {
  try {
    const dom = new JSDOM(html, { url: baseUrl, runScripts: 'outside-only' });
    const doc = dom.window.document;

    // Strategy 1: Direct video element
    const video = doc.querySelector('video');
    if (video) {
      const src = video.getAttribute('src') || 
                  video.querySelector('source')?.getAttribute('src');
      if (src && !src.includes('logo') && !src.includes('poster')) {
        return new URL(src, baseUrl).toString();
      }
    }

    // Strategy 2: Script content - look for video URLs
    const scripts = Array.from(doc.querySelectorAll('script'));
    for (const script of scripts) {
      const content = script.textContent || '';
      
      // Common patterns for video URLs
      const patterns = [
        /file:\s*["'](https?:\/\/[^"']+?\.(?:m3u8|mp4|mpd|webm)[^"']*?)["']/gi,
        /src:\s*["'](https?:\/\/[^"']+?\.(?:m3u8|mp4|mpd|webm)[^"']*?)["']/gi,
        /url:\s*["'](https?:\/\/[^"']+?\.(?:m3u8|mp4|mpd|webm)[^"']*?)["']/gi,
        /"file"\s*:\s*"([^"]+\.(?:m3u8|mp4|mpd|webm)[^"]*)"/gi,
        /source\s*=\s*["'](https?:\/\/[^"']+?\.(?:m3u8|mp4|mpd|webm)[^"']*?)["']/gi,
        // Obfuscated patterns
        /["']([A-Za-z0-9+/]{50,}==?)["']/g, // Base64
      ];

      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(content)) !== null) {
          let url = match[1];
          
          // Decode base64 if needed
          if (url.match(/^[A-Za-z0-9+/]+={0,2}$/)) {
            try {
              url = Buffer.from(url, 'base64').toString('utf8');
            } catch {}
          }
          
          if (url && url.startsWith('http') && 
              !url.includes('logo') && 
              !url.includes('poster') &&
              !url.includes('thumbnail')) {
            return new URL(url, baseUrl).toString();
          }
        }
      }
    }

    // Strategy 3: Data attributes
    const dataElements = Array.from(doc.querySelectorAll('[data-video], [data-src], [data-file], [data-url]'));
    for (const el of dataElements) {
      const data = el.getAttribute('data-video') ||
                   el.getAttribute('data-src') ||
                   el.getAttribute('data-file') ||
                   el.getAttribute('data-url');
      if (data && (data.includes('.m3u8') || data.includes('.mp4') || data.includes('.mpd'))) {
        return new URL(data, baseUrl).toString();
      }
    }

    // Strategy 4: Iframe src (nested player)
    const iframe = doc.querySelector('iframe[src]');
    if (iframe) {
      const src = iframe.getAttribute('src') || '';
      if (src.includes('.m3u8') || src.includes('.mp4') || src.includes('.mpd')) {
        return new URL(src, baseUrl).toString();
      }
    }

  } catch (error) {
    console.error('[Extract Video] Error:', error);
  }

  return null;
}

/**
 * Fetch provider page with proper headers
 */
async function fetchProvider(url: string, provider: string): Promise<string> {
  const origin = PROVIDERS[provider] || new URL(url).origin;
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Referer': origin + '/',
      'Origin': origin,
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Provider error: ${response.status}`);
  }

  return response.text();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerKeyRaw } = await params;
  const providerKey = providerKeyRaw.toLowerCase();
  
  const { searchParams } = new URL(req.url);
  const urlParam = searchParams.get('url');
  
  if (!urlParam) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }
  
  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(urlParam);
    new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  console.log(`[Video Extractor] Fetching: ${targetUrl}`);

  try {
    // Fetch provider page
    const html = await fetchProvider(targetUrl, providerKey);
    
    // Extract video URL
    const videoUrl = extractVideoUrl(html, targetUrl);
    
    if (!videoUrl) {
      console.error('[Video Extractor] No video URL found');
      return NextResponse.json({ 
        error: 'No video URL found',
        debug: html.substring(0, 500) + '...'
      }, { status: 404 });
    }

    console.log(`[Video Extractor] Found video: ${videoUrl}`);

    // Return video URL with proxy info
    return NextResponse.json({
      success: true,
      videoUrl,
      proxyUrl: `/api/stream?url=${encodeURIComponent(videoUrl)}`,
      provider: providerKey,
    });

  } catch (error) {
    console.error('[Video Extractor] Error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
