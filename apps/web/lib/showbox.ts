/**
 * ShowBox API Client — server-side proxy for sbfunapi.cc
 *
 * This is the original MovieBox/ShowBox backend API.
 * Main data source is a ZIP file at sbfunapi.cc/data/data_en.zip
 * containing movies_lite.json, tv_lite.json, and cats.json.
 *
 * Individual detail endpoints provide full metadata and potentially
 * video/stream URLs.
 */

// ── Constants ────────────────────────────────────────────────────────

const BASE = 'http://sbfunapi.cc';
const LIST_URL = `${BASE}/data/data_en.zip`;
const MOVIE_DETAIL_URL = `${BASE}/api/serials/movie_details/`;
const TV_DETAIL_URL = `${BASE}/api/serials/es/`;
const TRAILERS_LIST_URL = `${BASE}/api/serials/trailers_movies/?feed=popular`;
const TRAILER_DETAIL_URL = `${BASE}/api/serials/trailers/`;

const HEADERS = {
  'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 6.0; Nexus 5 Build/MPA44G)',
  'Accept-Encoding': 'gzip',
};

const HEADERS_SHOWBOX = {
  'User-Agent': 'Show Box',
  'Accept-Encoding': 'gzip',
  Host: 'sbfunapi.cc',
  Connection: 'Keep-Alive',
};

// ── ZIP Parsing (using Node.js built-in zlib) ────────────────────────

import zlib from 'node:zlib';
import { promisify } from 'node:util';
const inflateRaw = promisify(zlib.inflateRaw);

/**
 * Extract a named file from a ZIP buffer.
 * Uses the ZIP local file header format to find and decompress entries.
 */
async function extractFromZip(
  buffer: Buffer,
  targetName: string,
): Promise<Buffer | null> {
  let offset = 0;

  while (offset < buffer.length - 30) {
    // Read local file header signature
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break; // Not a local file header

    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraFieldLength = buffer.readUInt16LE(offset + 28);

    const fileName = buffer.toString('utf8', offset + 30, offset + 30 + fileNameLength);

    if (fileName === targetName) {
      const dataStart = offset + 30 + fileNameLength + extraFieldLength;
      const data = buffer.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) {
        // Stored (no compression)
        return data;
      } else if (compressionMethod === 8) {
        // DEFLATE
        try {
          return await inflateRaw(data);
        } catch {
          return null;
        }
      }
      return null;
    }

    // Skip to next entry
    offset += 30 + fileNameLength + extraFieldLength + compressedSize;
  }

  return null;
}

// ── Types ────────────────────────────────────────────────────────────

export interface ShowBoxMovie {
  id: number;
  title: string;
  imdb_id: string;
  rating: number;
  year: string;
  cats: string;
  active: string; // '1' = active, '0' = deleted
}

export interface ShowBoxTV {
  id: number;
  title: string;
  poster: string;
  banner: string;
  banner_mini: string;
  rating: string;
  imdb_id: string;
  seasons: string;
  cats: string;
  active: string;
}

export interface ShowBoxMovieDetail {
  id: number;
  title: string;
  description: string;
  year: string;
  poster: string;
  rating: string;
  imdb_id: string;
  imdb_rating: string;
  play_time?: string;
  release_time?: string;
  recommend?: number[];
  // Might contain video URLs
  sources?: Array<{ url: string; quality: string }>;
  videos?: Array<{ url: string; label: string }>;
}

export interface ShowBoxSeasonDetail {
  banner: string;
  description: string;
  thumbs: Record<string, string>; // episode seq -> thumbnail URL
  titles: Record<string, string>; // episode seq -> title
}

// ── API Methods ──────────────────────────────────────────────────────

// Cache the parsed list data (refreshed on each request in dev mode)
let listCache: { movies: ShowBoxMovie[]; tv: ShowBoxTV[]; cats: Record<string, string> } | null = null;

async function fetchList(): Promise<{
  movies: ShowBoxMovie[];
  tv: ShowBoxTV[];
  cats: Record<string, string>;
}> {
  if (listCache) return listCache;

  const cacheBuster = Math.random().toString(36).slice(2, 8);
  const resp = await fetch(`${LIST_URL}?q=${cacheBuster}`, {
    headers: HEADERS,
    cache: 'no-store',
  } as RequestInit);

  const arrayBuf = await resp.arrayBuffer();
  const buf = Buffer.from(arrayBuf);

  const [moviesRaw, tvRaw, catsRaw] = await Promise.all([
    extractFromZip(buf, 'movies_lite.json'),
    extractFromZip(buf, 'tv_lite.json'),
    extractFromZip(buf, 'cats.json'),
  ]);

  const movies: ShowBoxMovie[] = moviesRaw ? JSON.parse(moviesRaw.toString('utf8')) : [];
  const tv: ShowBoxTV[] = tvRaw ? JSON.parse(tvRaw.toString('utf8')) : [];
  const cats: Record<string, string> = catsRaw ? JSON.parse(catsRaw.toString('utf8')) : {};

  listCache = { movies, tv, cats };
  return listCache;
}

export async function getMovies(): Promise<ShowBoxMovie[]> {
  const data = await fetchList();
  return data.movies;
}

export async function getTVShows(): Promise<ShowBoxTV[]> {
  const data = await fetchList();
  return data.tv;
}

export async function getCategories(): Promise<Record<string, string>> {
  const data = await fetchList();
  return data.cats;
}

export async function getMovieDetail(id: string | number): Promise<any> {
  const resp = await fetch(`${MOVIE_DETAIL_URL}?id=${id}`, {
    headers: HEADERS_SHOWBOX,
    cache: 'no-store',
  } as RequestInit);

  if (!resp.ok) throw new Error(`Movie detail error: ${resp.status}`);
  return resp.json();
}

export async function getTVSeason(
  id: string | number,
  season: string | number,
): Promise<any> {
  const resp = await fetch(`${TV_DETAIL_URL}?season=${season}&id=${id}`, {
    headers: HEADERS_SHOWBOX,
    cache: 'no-store',
  } as RequestInit);

  if (!resp.ok) throw new Error(`TV season error: ${resp.status}`);
  return resp.json();
}

export async function getTrailers(): Promise<any[]> {
  const resp = await fetch(TRAILERS_LIST_URL, {
    headers: HEADERS,
    cache: 'no-store',
  } as RequestInit);

  if (!resp.ok) throw new Error(`Trailers error: ${resp.status}`);
  return resp.json();
}

export async function getTrailerDetail(id: string | number): Promise<any> {
  const resp = await fetch(`${TRAILER_DETAIL_URL}?id=${id}`, {
    headers: HEADERS,
    cache: 'no-store',
  } as RequestInit);

  if (!resp.ok) throw new Error(`Trailer detail error: ${resp.status}`);
  return resp.json();
}
