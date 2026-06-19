import { JSDOM } from 'jsdom';

export interface VideoSource {
  url: string;
  type: 'mp4' | 'hls' | 'dash' | 'webm' | 'unknown';
  quality?: string;
}

/**
 * Extract video source from HTML content
 * Works with: JW Player, Video.js, Plyr, Flowplayer, HTML5 video, and custom players
 * Recursively follows iframes to find the actual player
 */
export async function extractVideoSource(
  html: string,
  baseUrl: string,
  depth: number = 0
): Promise<VideoSource | null> {
  if (depth > 3) return null;

  try {
    const virtualConsole = new (await import('jsdom')).VirtualConsole();
    virtualConsole.on('error', () => {});

    const dom = new JSDOM(html, { url: baseUrl, virtualConsole });
    const doc = dom.window.document;

    // Strategy 1: Direct HTML5 video element
    const videoElement = doc.querySelector('video');
    if (videoElement) {
      const src =
        videoElement.getAttribute('src') ||
        Array.from(videoElement.querySelectorAll('source')).find(s => s.getAttribute('src'))?.getAttribute('src');
      if (src && !src.startsWith('blob:')) {
        return normalizeVideoSource(src, baseUrl);
      }
    }

    // Strategy 2: Parse JavaScript content for video URLs
    const scriptsArray = Array.from(doc.querySelectorAll('script'));
    for (const script of scriptsArray) {
      const content = script.textContent || '';

      // Look for base64 encoded URLs (common in obfuscated players)
      const base64Matches = content.match(/["']([A-Za-z0-9+/]{40,})["']/g);
      if (base64Matches) {
        for (let match of base64Matches) {
          try {
            const decoded = Buffer.from(match.slice(1, -1), 'base64').toString('utf8');
            if (decoded.includes('http') && /\.(m3u8|mp4|mpd)/.test(decoded)) {
              const source = normalizeVideoSource(decoded, baseUrl);
              if (source) return source;
            }
          } catch (e) {}
        }
      }

      // Scan for direct video URLs in script content
      const source = scanScriptContent(content, baseUrl);
      if (source) return source;

      // Fetch and scan external player scripts
      const src = script.getAttribute('src');
      if (src && (src.includes('player') || src.includes('vid') || src.includes('stream') || src.includes('embed') || src.includes('main') || src.includes('app'))) {
        try {
          const absoluteSrc = new URL(src, baseUrl).toString();
          console.log(`[Video Extract] Fetching external script: ${absoluteSrc}`);
          const response = await fetch(absoluteSrc, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
              'Referer': baseUrl
            }
          });
          if (response.ok) {
            const jsContent = await response.text();
            const source = scanScriptContent(jsContent, baseUrl);
            if (source) return source;
          }
        } catch (e) {}
      }
    }

    // Strategy 3: Check data attributes on elements
    const dataAttrSource = extractFromDataAttributes(doc, baseUrl);
    if (dataAttrSource) return dataAttrSource;

    // Strategy 4: Follow iframes recursively
    const iframesArray = Array.from(doc.querySelectorAll('iframe'));
    for (const iframe of iframesArray) {
      const src = iframe.getAttribute('src');
      if (!src || src.startsWith('javascript:')) continue;

      try {
        const absoluteSrc = new URL(src, baseUrl).toString();

        // Direct stream links in iframe src
        if (/\.(mp4|m3u8|webm|mpd)($|\?)/i.test(absoluteSrc)) {
          return normalizeVideoSource(absoluteSrc, baseUrl);
        }

        // Skip known non-video iframes
        if (absoluteSrc.includes('google') || absoluteSrc.includes('doubleclick') || absoluteSrc.includes('analytics') || absoluteSrc.includes('facebook') || absoluteSrc.includes('twitter') || absoluteSrc.includes('umami')) {
          continue;
        }

        console.log(`[Video Extract] Following iframe (depth ${depth}): ${absoluteSrc}`);
        try {
          const response = await fetch(absoluteSrc, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
              'Referer': baseUrl
            }
          });
          if (response.ok) {
            const iframeHtml = await response.text();
            const nestedSource = await extractVideoSource(iframeHtml, absoluteSrc, depth + 1);
            if (nestedSource) return nestedSource;
          }
        } catch (e) {}
      } catch (e) {}
    }

  } catch (err) {
    console.error(`[Video Extract] Error at depth ${depth}:`, err);
  }

  return null;
}

/**
 * Scan script content for video URLs
 */
function scanScriptContent(content: string, baseUrl: string): VideoSource | null {
  // Common player patterns
  const patterns = [
    /file:\s*["'](https?:\/\/[^"']*\.(?:mp4|m3u8|webm|mpd)[^"']*)["']/gi,
    /src:\s*["'](https?:\/\/[^"']*\.(?:mp4|m3u8|webm|mpd)[^"']*)["']/gi,
    /source:\s*["'](https?:\/\/[^"']*\.(?:mp4|m3u8|webm|mpd)[^"']*)["']/gi,
    /url:\s*["'](https?:\/\/[^"']*\.(?:mp4|m3u8|webm|mpd)[^"']*)["']/gi,
    /"file"\s*:\s*"([^"]*\.(?:mp4|m3u8|webm|mpd)[^"]*)"/gi,
    /"src"\s*:\s*"([^"]*\.(?:mp4|m3u8|webm|mpd)[^"]*)"/gi,
    /"url"\s*:\s*"([^"]*\.(?:mp4|m3u8|webm|mpd)[^"]*)"/gi,
    // Catch naked URLs in quotes (common in obfuscated players)
    /["'](https?:\/\/[^"']*\.(?:mp4|m3u8|webm|mpd)(?:\?[^"']*)?)["']/gi,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const url = match[1];
      if (url && !url.includes('logo') && !url.includes('poster') && !url.includes('thumbnail')) {
        const source = normalizeVideoSource(url, baseUrl);
        if (source) return source;
      }
    }
  }

  // Try parsing JSON objects
  try {
    const jsonMatches = content.match(/\{[^}]*["'](?:file|src|url|source)["']\s*:\s*["'][^"']*\.(?:mp4|m3u8|webm|mpd)[^"']*["'][^}]*\}/gi);
    if (jsonMatches) {
      for (const jsonStr of jsonMatches) {
        try {
          const cleaned = jsonStr.replace(/'/g, '"');
          const parsed = JSON.parse(cleaned);
          const url = parsed.file || parsed.src || parsed.url;
          if (url && typeof url === 'string' && /\.(mp4|m3u8|webm|mpd)/i.test(url)) {
            return normalizeVideoSource(url, baseUrl);
          }
        } catch {}
      }
    }
  } catch {}

  return null;
}

/**
 * Extract video URLs from data attributes
 */
function extractFromDataAttributes(doc: Document, baseUrl: string): VideoSource | null {
  const selectors = ['[data-video]', '[data-src]', '[data-file]', '[data-url]', '[data-stream]', '[data-source]', '[data-config]'];
  for (const selector of selectors) {
    const elements = Array.from(doc.querySelectorAll(selector));
    for (const el of elements) {
      const attrValue = el.getAttribute(selector.slice(1, -1));
      if (attrValue) {
        if (attrValue.startsWith('{')) {
          try {
            const parsed = JSON.parse(attrValue);
            const url = parsed.file || parsed.src || parsed.url;
            if (url) return normalizeVideoSource(url, baseUrl);
          } catch {}
        }
        if (/\.(mp4|m3u8|webm|mpd)/i.test(attrValue)) {
          return normalizeVideoSource(attrValue, baseUrl);
        }
      }
    }
  }
  return null;
}

/**
 * Normalize video source URL and determine type
 */
function normalizeVideoSource(url: string, baseUrl: string): VideoSource | null {
  try {
    const absoluteUrl = new URL(url, baseUrl).toString();
    let type: VideoSource['type'] = 'unknown';

    if (absoluteUrl.includes('.m3u8') || absoluteUrl.includes('m3u8')) type = 'hls';
    else if (absoluteUrl.includes('.mpd') || absoluteUrl.includes('dash')) type = 'dash';
    else if (absoluteUrl.includes('.mp4')) type = 'mp4';
    else if (absoluteUrl.includes('.webm')) type = 'webm';

    return { url: absoluteUrl, type };
  } catch {
    if (url.startsWith('http')) {
      let type: VideoSource['type'] = 'unknown';
      if (url.includes('.m3u8')) type = 'hls';
      else if (url.includes('.mpd')) type = 'dash';
      else if (url.includes('.mp4')) type = 'mp4';
      else if (url.includes('.webm')) type = 'webm';
      return { url, type };
    }
    return null;
  }
}
