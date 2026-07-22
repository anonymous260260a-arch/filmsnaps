# Nuvio Providers Architecture Analysis

**Date:** 2026-07-22
**Context:** Evaluating whether nuvio-providers' approach to extracting video sources can be useful for FilmSnaps.

---

## What Is Nuvio Providers?

**Nuvio** is a streaming app (like FilmSnaps). **nuvio-providers** is a plugin system — each provider is a JavaScript module that runs **inside the mobile app** (React Native / Hermes engine) and extracts direct video URLs by calling provider APIs or scraping HTML. No server needed.

**GitHub:** `https://github.com/tapframe/nuvio-providers`
**License:** GPL-3.0

## Key Difference vs CinePro

| Dimension | CinePro | Nuvio Providers |
|---|---|---|
| **Where it runs** | Server (Node.js) | Mobile app (Hermes engine) |
| **Video delivery** | Proxied through CinePro's server | Direct URL → app plays natively |
| **Deployment** | Deploy & maintain a server | No server, runs locally on device |
| **Fragility** | High — server-side requests blocked by CF | Medium — uses device-level fetch |
| **Setup per provider** | Same: reverse-engineer API | Same: reverse-engineer API |

This is **more relevant to us** because we could run these providers inside our app directly, like Nuvio does — no server, no proxy.

---

## How It Works

### Provider Interface

Every provider exports a single function:

```javascript
function getStreams(tmdbId, mediaType, season, episode) {
    // ... call provider APIs, scrape HTML, decrypt responses ...
    return [
        {
            name: "ProviderName",
            title: "1080p Stream",
            url: "https://...master.m3u8",    // ← Direct video URL
            quality: "1080p",
            headers: { "Referer": "https://..." },  // ← Required for playback
            subtitles: [{ url: "...", language: "en", name: "English" }]
        }
    ];
}
module.exports = { getStreams };
```

### Provider Registry

`manifest.json` lists all providers and their metadata:

```json
{
  "id": "vidnest",
  "name": "Vidnest",
  "filename": "providers/vidnest.js",
  "supportedTypes": ["movie", "tv"],
  "enabled": true,
  "formats": ["mp4", "m3u8"],
  "contentLanguage": ["en"]
}
```

### Build System

Source files in `src/{provider}/` are bundled with **esbuild** into `providers/{provider}.js`. This allows multi-file development and transpiles `async/await` into Promises for Hermes compatibility.

---

## All 34 Providers

### By Source Type

| Provider | Type | Technique | Language |
|---|---|---|---|
| **4khdhub** | Direct link | Scrapes 4khdhub for MKV links | en |
| **allmovieland** | M3U8 | Search site → scrape embed → CSRF request → playlist endpoint | en, hi, ta, te |
| **animekai** | M3U8 | Anime API scraping | en |
| **animepahe** | M3U8 | AnimePahe site scraping | en |
| **anizone** | M3U8 | Anime API → multi-audio | en |
| **castle** | MP4/M3U8 | Multi-lang provider | en, hi, ta, te, ml, kn |
| **cinemacity** | MP4 | Multi-language streaming | en, hi, ta, te, id, pl, ar |
| **cinevibe** | MP4/M3U8 | Simple API | en |
| **dahmermovies** | MKV | Scrapes for direct MKV links | en |
| **dooflix** | M3U8 | API → fetch redirect → get Location header as stream URL | en, hi |
| **dvdplay** | MKV | HubCloud extraction | mal, tam, hin |
| **hdhub4u** | MKV/MP4 | Scrapes HDHub4u site | en, hin |
| **hianime** | M3U8 | HiAnime multi-server anime streaming | en |
| **kurage** | MP4 | tRPC API → proxy | en |
| **mallumv** | MKV/MP4 | Scrapes MalluMV | ta, te, hi, ml, kn |
| **movieblast** | MP4/MKV | API → direct links | te, hi, en |
| **moviebox** | MP4/MPD | API → search → match → play-info → stream URLs | en, hin, tam, tel |
| **moviesdrive** | MKV/MP4 | HubCloud/GDrive extraction | en, hin |
| **moviesmod** | MKV | Scrapes MoviesMod | en |
| **mycima** | MP4/M3U8 | Arabic provider | ar |
| **myflixer-extractor** | M3U8 | MyFlixer site scraping | en |
| **netmirror** | MKV | NetMirror direct links | en |
| **reanime** | M3U8 | Anime provider | en |
| **showbox** | MP4/MKV | ShowBox with multiple quality options | en |
| **streamflix** | MKV | StreamFlix API | en, hin |
| **uhdmovies** | MKV | UHDMovies site → multi-res | en |
| **videasy** | M3U8/MP4/MKV | 6 servers, encrypted hex blob (disabled) | en, de, it, fr, ... |
| **vidlink** | M3U8/MP4 | `vidlink.pro/api/b` → encrypt/decrypt with `enc-dec.app` | en |
| **vidnest** | MP4/M3U8 | `first.vidnest.fun/{server}/...` → AES-GCM decrypt | en |
| **vidnest-anime** | M3U8 | 5 servers with TMDB→AniList mapping | en, hi, ja |
| **vidrock** | M3U8 | AES-CBC encrypted URL | en |
| **vixsrc** | M3U8 | `vixsrc.to/api` → HTML extract token → build playlist URL | en |
| **xprime** | M3U8 | XPrime API | en |
| **yflix** | M3U8/MP4 | YFlix API | en |

---

## Extraction Techniques Used

### 1. Direct API Call (simplest)

Used by: **dooflix**, **cinevibe**, **streamflix**, **yflix**

```javascript
// DooFlix
GET https://api.dooflix.org/api/3/movie/{tmdbId}/links?api_key=...
→ { links: [{ url: "https://..." }] }
→ Follow redirect → Location header = stream URL
```

### 2. Site Search + Scraping (most complex)

Used by: **allmovieland**, **uhdmovies**, **hdhub4u**, **moviesmod**

```javascript
// AllMovieLand
1. Search provider site with movie title
2. Parse HTML with cheerio to find matching content
3. Scrape embed page for CSRF token + player domain
4. POST to playlist endpoint with CSRF token
5. Get m3u8 URL back
```

### 3. Encrypted API Response (vidnest, vidlink)

Used by: **vidnest**, **vidlink**, **vidrock**, **videasy**

```javascript
// VidNest
GET https://first.vidnest.fun/{server}/movie/{tmdbId}
Headers: exact browser headers (sec-ch-ua, origin, referer, etc.)
Response: encrypted → AES-GCM decrypt with passphrase → { sources: [...] }

// VidLink
GET https://vidlink.pro/api/b?tmdb={id}&type={type}&s={s}&e={e}
Response: encrypted → POST to enc-dec.app/api/decrypt → { streams: [...] }
```

### 4. Multi-Hop Token Extraction (vixsrc)

Used by: **vixsrc**

```javascript
1. GET https://vixsrc.to/api/movie/{tmdbId}
   → { src: "/embed/..." }
2. GET https://vixsrc.to/embed/{...}
   → HTML with token, expires, url fields
3. Build: playlist?token=...&expires=...&h=1
   → HLS master playlist
```

### 5. MovieBox-style Mobile API (sophisticated)

Used by: **moviebox**

```javascript
1. TMDB details → search MovieBox's API
2. Find best match by title + year scoring
3. Get subject details (dubs, versions)
4. Fetch play-info for each language version
5. Get stream URLs + signCookie + subtitles
6. Use Android-style User-Agent (app package name, build info)
```

---

## Provider Overlap: FilmSnaps ↔ Nuvio

| FilmSnaps Provider | Nuvio Has It? | Nuvio's Approach |
|---|---|---|
| **Server 1**: nxsha | ❌ No | — |
| **Server 2**: peachify | ❌ No | — |
| **Server 3**: screenscape | ❌ No | — |
| **Server 4**: nhdapi | ❌ No | — |
| **Server 5**: zxcstream | ❌ No | — |
| **Server 6**: cinemaos | ❌ No | — |
| **Server 14**: vidnest | ✅ Yes | AES-GCM API, runs in Hermes, uses `first.vidnest.fun` (different base) |
| **Server 15**: vidlink (disabled) | ✅ Yes | `vidlink.pro/api/b` → enc-dec.app → stream URL |
| **Server 16**: vixsrc (disabled) | ✅ Yes | Same multi-hop pattern as CinePro |
| **Server 20**: videasy (disabled) | ✅ Yes (disabled here too) | Same encrypted hex blob approach |
| **Disabled**: vidsrc variants | ❌ No | — |
| **New**: icefy | ❌ No | — |

### Interesting New Providers Nuvio Has That We Don't

These are worth evaluating as potential additions:

| Provider | What It Offers |
|---|---|
| **moviebox** | Mobile API with multi-lang (hin, tam, tel), DASH + MP4, Android-style auth headers |
| **allmovieland** | Multi-lang (hi, ta, te), M3U8, complex but real extraction |
| **dooflix** | Simple API, fast, multi-lang (en, hi) |
| **cinemacity** | 7 languages (en, hi, ta, te, id, pl, ar) |
| **castle** | 6 Indian languages (en, hi, ta, te, ml, kn) |
| **streamflix** | Hindi + English, MKV direct links |

---

## How to Run It (to verify providers)

The repo has a simple HTTP server:

```bash
cd nuvio-providers-main
npm install
npm run serve
# → http://localhost:3000/manifest.json
# Serves static files, lets you test providers
```

But to actually test a provider's extraction, you'd need to:

```javascript
// Create a test file
const { getStreams } = require('./providers/vidnest.js');
getStreams('872585', 'movie')  // Oppenheimer
  .then(streams => console.log(streams));
```

Or more practically: create a simple test runner that imports each provider and logs what it returns.

---

## Is This Useful for Us?

### Yes, for three reasons:

**1. Proven extraction implementations for overlapping providers**

The vidnest, vixsrc, and videasy implementations here are an alternative reference to CinePro's. Notably, Nuvio's vidnest uses:
- Different base URL: `first.vidnest.fun` (not `new.vidnest.fun`)
- Exact browser headers copied from Chrome on Android (sec-ch-ua, etc.)
- Different passphrase

This suggests Nuvio's extractors may be more up-to-date than CinePro's.

**2. Runnable inside our app (no server needed)**

Unlike CinePro which requires a server, Nuvio providers run on-device in Hermes. We could adopt the same pattern: bundle a provider script, call `getStreams()`, get back direct video URLs, play them natively. This eliminates the WebView entirely for that provider.

**3. Providers we don't have**

MovieBox, allmovieland, dooflix, and cinemacity are new sources we could add. They support Hindi, Tamil, Telugu, and other Indian languages directly.

### Cautions

**Same fragility as CinePro:** These are reverse-engineered APIs. Provider changes break extraction. The Nuvio project has the same maintenance burden.

**Hermes compatibility:** The code is transpiled for Hermes (no `async/await` in providers, no Buffer, no Node.js modules). If we want to run these in our app, we'd need similar transpilation.

**Headers matter a lot:** The working providers use exact browser headers (sec-ch-ua, origin, referer, etc.). Simply calling `fetch()` without proper headers will fail.

---

## Comparison: All Three Approaches

| | WebView + Adblock (Current) | Server Extraction (CinePro) | In-App Extraction (Nuvio) |
|---|---|---|---|
| **Server needed** | No | Yes | No |
| **Native playback** | No (WebView) | Yes (video proxied) | Yes (direct URL) |
| **Adblock needed** | Yes (complex) | No | No |
| **Battery/performance** | Poor (WebView) | Good | Good |
| **Setup per provider** | Low (embed URL) | High (reverse-engineer API) | High (reverse-engineer API) |
| **Maintenance** | Low | High | High |
| **Cloudflare** | Handled by WebView | Blocks requests | Blocks requests |
| **Works offline** | No | No | No |
| **Multi-source** | Per provider | Per extractor | Per provider script |
