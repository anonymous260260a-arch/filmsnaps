/**
 * TLS-Fingerprinting HTTP Client
 *
 * Bypasses Cloudflare JS challenges by making HTTP requests that look
 * like a real browser (Chrome 131) at the TCP/TLS/HTTP layers, rather
 * than Node.js's native `fetch` (undici) which has a distinctive and
 * easily-blocked TLS fingerprint.
 *
 * ── Strategy ──────────────────────────────────────────────────────────
 *
 * 1. PRIMARY: Child process → curl-impersonate binary
 *    If `curl-impersonate` (or `curl_chrome131`) is on PATH, spawn it
 *    as a subprocess. This is the gold standard — it perfectly mimics
 *    Chrome's TLS stack, HTTP/2 frame ordering, and header order.
 *    Install: https://github.com/lwthiker/curl-impersonate
 *
 * 2. SECONDARY: node:https with Chrome-like TLS config
 *    Uses specific cipher suite ordering, TLS options, and comprehensive
 *    browser headers to approximate Chrome's fingerprint. Not as good
 *    as curl-impersonate but often sufficient.
 *
 * 3. FALLBACK: Native fetch() with enhanced browser headers
 *    Used on platforms where child_process isn't available (Cloudflare
 *    Workers, edge runtimes).
 *
 * ── Why not native fetch()? ──────────────────────────────────────────
 *
 * Node.js 18+'s global `fetch()` uses `undici`, which has a distinct
 * TLS fingerprint (JA3 = 51e3aaf9bbcf1afccad52c25e7a1e6b0). Cloudflare
 * detects this and serves a hybrid challenge page. By using a browser-
 * like TLS fingerprint, we get the clean HTML directly.
 *
 * ── iPad UA ──────────────────────────────────────────────────────────
 *
 * We use an iPad User-Agent by default. Per expert analysis, iPad UA
 * often bypasses both Cloudflare JS challenges AND site-specific mobile
 * ad logic, killing two birds with one request.
 */

import { get as httpsGet, type RequestOptions } from 'node:https';
import { get as httpGet } from 'node:http';
import { URL } from 'node:url';
import { spawn } from 'node:child_process';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';

// ── Chrome 131 TLS Cipher Suites ─────────────────────────────────────
// Order matters! This must match Chrome's actual cipher preference order.
const CHROME_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',        // TLS 1.3
  'TLS_AES_256_GCM_SHA384',        // TLS 1.3
  'TLS_CHACHA20_POLY1305_SHA256',  // TLS 1.3
  'ECDHE-ECDSA-AES128-GCM-SHA256', // TLS 1.2
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-ECDSA-AES128-SHA',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-ECDSA-AES256-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
  'DES-CBC3-SHA',
].join(':');

// ── Browser Headers (Chrome 131, iPad) ───────────────────────────────
// Order is important — browser-like header ordering is part of the
// fingerprint. These headers are sent by real Chrome on iPad.

export const BROWSER_HEADERS: Record<string, string> = {
  // iPad Safari (used when mobileUA: true) — bypasses both CF and mobile
  // ad logic per expert analysis
  'accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'accept-encoding': 'gzip, deflate, br',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'sec-ch-ua': '"Not A(Brand";v="99", "Chromium";v="131", "Google Chrome";v="131"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"iPad"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  'user-agent':
    'Mozilla/5.0 (iPad; CPU OS 17_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

/**
 * Desktop Chrome 131 headers — used when mobileUA=false.
 * Chrome's desktop UA and sec-ch-ua-platform is preferred for primary
 * proxy fetches (better chance of bypassing Cloudflare's bot detection).
 */
export const DESKTOP_HEADERS: Record<string, string> = {
  'accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'accept-encoding': 'gzip, deflate, br',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

/**
 * Resolve which headers to use based on mobileUA option.
 */
function resolveHeaders(options: TlsFetchOptions): Record<string, string> {
  const base = options.mobileUA !== false ? { ...BROWSER_HEADERS } : { ...DESKTOP_HEADERS };
  return { ...base, ...options.headers };
}

// ── Types ────────────────────────────────────────────────────────────

export interface TlsFetchResult {
  body: string;
  statusCode: number;
  headers: Record<string, string>;
  /** How the request was actually made */
  method: 'curl-impersonate' | 'node-https' | 'native-fetch';
}

export interface TlsFetchOptions {
  /** Default: uses iPad Safari UA. Set false to send desktop Chrome UA. */
  mobileUA?: boolean;
  /** Timeout in ms (default: 30000) */
  timeout?: number;
  /** Follow redirects (default: true) */
  followRedirects?: boolean;
  /** Max redirects (default: 5) */
  maxRedirects?: number;
  /** Extra headers to merge */
  headers?: Record<string, string>;
}

// ── curl-impersonate detection ──────────────────────────────────────

let _curlImpCheck: boolean | null = null;

/**
 * Check if curl-impersonate (curl_chrome131) is available on PATH.
 * Cached after first check.
 */
async function hasCurlImpersonate(): Promise<boolean> {
  if (_curlImpCheck !== null) return _curlImpCheck;

  try {
    // Check for the chrome-specific impersonate binary first,
    // then the generic curl-impersonate with --libcurl flag
    const names = ['curl_chrome131', 'curl-impersonate-chrome', 'curl-impersonate'];
    for (const name of names) {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(name, ['--version'], {
          stdio: 'ignore',
          timeout: 3000,
        });
        proc.on('exit', (code) => {
          if (code === 0) resolve();
          else reject();
        });
        proc.on('error', reject);
      });
      _curlImpCheck = true;
      return true;
    }
    _curlImpCheck = false;
    return false;
  } catch {
    _curlImpCheck = false;
    return false;
  }
}

// ── curl-impersonate fetcher ─────────────────────────────────────────

async function fetchWithCurlImpersonate(
  url: string,
  options: TlsFetchOptions,
): Promise<TlsFetchResult> {
  return new Promise((resolve, reject) => {
    const args = [
      '--compressed',
      '--location',          // follow redirects
      options.followRedirects !== false ? `--max-redirs=${options.maxRedirects ?? 5}` : '--max-redirs=0',
      `--connect-timeout=${Math.ceil((options.timeout ?? 30000) / 1000)}`,
      `--max-time=${Math.ceil((options.timeout ?? 30000) / 1000)}`,
      // Impersonate Chrome 131
      '--libcurl',
      url,
    ];

    // Build headers
    const headers = resolveHeaders(options);
    for (const [key, value] of Object.entries(headers)) {
      args.push('-H', `${key}: ${value}`);
    }

    const proc = spawn('curl_chrome131', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: (options.timeout ?? 30000) + 5000,
    });

    let body = '';
    let error = '';

    proc.stdout!.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      error += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && body) {
        resolve({
          body,
          statusCode: 200,
          headers: {},
          method: 'curl-impersonate',
        });
      } else {
        reject(new Error(`curl-impersonate exited ${code}: ${error.slice(0, 200)}`));
      }
    });

    proc.on('error', reject);
  });
}

// ── Node.js https fetcher (Chrome-like TLS) ─────────────────────────

/**
 * Fetch using Node's native `https` module with Chrome-like TLS config.
 * Not a perfect fingerprint match (Node uses OpenSSL, not Chrome's BoringSSL)
 * but significantly better than undici's default fingerprint.
 */
function fetchWithNodeHttps(
  urlStr: string,
  options: TlsFetchOptions,
  redirectCount = 0,
): Promise<TlsFetchResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const maxRedirects = options.followRedirects !== false ? (options.maxRedirects ?? 5) : 0;

    const headers: Record<string, string> = resolveHeaders(options);
    // Remove HTTP/2 pseudo-headers — they're handled by the protocol layer
    delete (headers as any)[':authority'];
    delete (headers as any)[':method'];
    delete (headers as any)[':path'];
    delete (headers as any)[':scheme'];

    if (urlStr.includes('?')) {
      headers['accept'] = headers['accept'] || 'text/html,*/*';
    }

    const isHttps = url.protocol === 'https:';

    const requestOptions: RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers,
      rejectUnauthorized: true,
      timeout: options.timeout ?? 30000,
    };

    // Apply Chrome-like TLS config only for HTTPS
    if (isHttps) {
      (requestOptions as any).ciphers = CHROME_CIPHERS;
      (requestOptions as any).honorCipherOrder = true;
      // Prefer TLS 1.3, allow 1.2 (Chrome's range)
      (requestOptions as any).secureOptions =
        // SSL_OP_NO_SSLv3 | SSL_OP_NO_TLSv1 | SSL_OP_NO_TLSv1_1
        0x02000000 | 0x04000000 | 0x10000000;
      // Chrome uses X25519 and prime256v1 for ECDHE
      (requestOptions as any).ecdhCurve = 'X25519:prime256v1:secp384r1';
    }

    const fetcher = isHttps ? httpsGet : httpGet;

    const req = fetcher(requestOptions, (res) => {
      const statusCode = res.statusCode ?? 502;
      const location = res.headers['location'] as string | undefined;

      // Handle redirects
      if (location && redirectCount < maxRedirects && statusCode >= 301 && statusCode <= 308) {
        const redirectUrl = location.startsWith('http')
          ? location
          : `${url.origin}${location}`;
        req.destroy();
        resolve(fetchWithNodeHttps(redirectUrl, options, redirectCount + 1));
        return;
      }

      // Collect response (with decompression support)
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        let body: string;
        const raw = Buffer.concat(chunks);
        const contentEncoding = (res.headers['content-encoding'] as string) ?? '';

        try {
          if (contentEncoding.includes('br')) {
            body = brotliDecompressSync(raw).toString('utf-8');
          } else if (contentEncoding.includes('gzip')) {
            body = gunzipSync(raw).toString('utf-8');
          } else if (contentEncoding.includes('deflate')) {
            body = inflateSync(raw).toString('utf-8');
          } else {
            body = raw.toString('utf-8');
          }
        } catch {
          body = raw.toString('utf-8');
        }

        const responseHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          responseHeaders[k] = Array.isArray(v) ? v.join(', ') : (v ?? '');
        }

        resolve({
          body,
          statusCode,
          headers: responseHeaders,
          method: 'node-https',
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${options.timeout ?? 30000}ms`));
    });

    req.on('error', reject);
    req.end();
  });
}

// ── Native fetch fallback (Cloudflare Workers, edge runtimes) ────────

async function fetchWithNativeFetch(
  urlStr: string,
  options: TlsFetchOptions,
): Promise<TlsFetchResult> {
  const headers: Record<string, string> = resolveHeaders(options);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout ?? 30000);

  try {
    const response = await fetch(urlStr, {
      headers,
      redirect: options.followRedirects !== false ? 'follow' : 'manual',
      signal: controller.signal,
    });

    const body = await response.text();
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      responseHeaders[k] = v;
    });

    return {
      body,
      statusCode: response.status,
      headers: responseHeaders,
      method: 'native-fetch',
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Fetch a URL using TLS fingerprinting to bypass Cloudflare JS challenges.
 *
 * Tries strategies in order:
 *   1. curl-impersonate binary (if on PATH) — perfect Chrome fingerprint
 *   2. node:https with Chrome-like TLS config — good approximation
 *   3. Native fetch() with browser headers — fallback
 *
 * @param url - The URL to fetch
 * @param options - Fetch options
 * @returns TlsFetchResult with body, status, and method used
 */
export async function tlsFetch(
  url: string,
  options: TlsFetchOptions = {},
): Promise<TlsFetchResult> {
  // Strategy 1: curl-impersonate (gold standard)
  try {
    const hasCurl = await hasCurlImpersonate();
    if (hasCurl) {
      console.log('[TlsFetch] Using curl-impersonate');
      const result = await fetchWithCurlImpersonate(url, options);
      return result;
    }
  } catch (err) {
    console.warn('[TlsFetch] curl-impersonate failed, falling back:', (err as Error).message);
  }

  // Strategy 2: Node.js https with Chrome-like TLS
  // Only use this in Node.js environment (not edge/worker)
  try {
    if (typeof process !== 'undefined' && process.versions?.node) {
      console.log('[TlsFetch] Using node:https with Chrome TLS config');
      const result = await fetchWithNodeHttps(url, options);
      return result;
    }
  } catch (err) {
    console.warn('[TlsFetch] node:https failed, falling back to native fetch:', (err as Error).message);
  }

  // Strategy 3: Native fetch (edge runtimes, Cloudflare Workers)
  console.log('[TlsFetch] Using native fetch with browser headers');
  const result = await fetchWithNativeFetch(url, options);
  return result;
}

/**
 * Check whether TLS-fingerprinting fetch is available vs basic fetch.
 * Useful for logging/debugging which mode is active.
 */
export async function getTlsFetchMode(): Promise<'curl-impersonate' | 'node-https' | 'native-fetch'> {
  if (await hasCurlImpersonate()) return 'curl-impersonate';
  if (typeof process !== 'undefined' && process.versions?.node) return 'node-https';
  return 'native-fetch';
}
