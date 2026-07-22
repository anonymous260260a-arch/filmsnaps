# CinePro Core Architecture Analysis

**Date:** 2026-07-22
**Context:** Evaluating whether server-side video source extraction can replace our WebView + adblock approach for streaming providers.

---

## What Is CinePro Core?

CinePro Core is a Node.js/TypeScript streaming backend that reverse-engineers streaming provider APIs to extract direct video URLs (`.m3u8`, `.mp4`, etc.) — **no WebView, no browser, no ads**. It runs as an HTTP server with Redis caching, CORS, Stremio addon support, and MCP for AI agents.

It is built on the `@omss/framework` (Open Media Streaming Standard) which provides:
- `BaseProvider` — abstract class with `createProxyUrl()`, `cleanThirdPartyProxy()`, helpers
- `ProviderRegistry` — auto-discovers providers from a directory via filesystem scanning
- Proxy system — wraps video URLs through its own proxy for header/caching control

**GitHub:** `https://github.com/cinepro-org/core`
**License:** PolyForm Noncommercial 1.0.0

---

## Full Provider List (16 Found)

### Enabled (11)

| Provider ID | Display Name | Source Type(s) | Key Technique |
|---|---|---|---|
| cinesu | CineSu | HLS (.m3u8) | Direct manifest URL construction |
| fsharetv | FshareTV | MP4, HLS | HTML scraping → API call |
| icefy | Icefy | HLS | Simple JSON API → `{ stream: "..." }` |
| peachify | Peachify | HLS, MP4 | Fan-out to 6 sub-servers + AES-GCM decryption |
| popr | Popr | HLS, MP4 | Fan-out to 10 servers + stream validation |
| tulnex | Tulnex | HLS, MP4 | 14 server fan-out + 4-layer decryption (xor → binary → AES-CBC → HMAC) |
| vidapi | VidApi | HLS, MP4 | URL-based API with TMDB params |
| videasy | Videasy | HLS, MP4 | 6 server fan-out + external decrypt API for hex blobs |
| vidnest | VidNest | HLS, MP4, DASH, MKV, WEBM | 10 server fan-out + custom-base64 encoded responses |
| vidrock | VidRock | HLS, MP4 | AES-CBC encrypted item IDs + recursive CDN fetch |
| vidsrc | VidSrc | HLS | 3-level iframe scraping chain → regex extraction |
| vidzee | VidZee | HLS | 14 server fan-out + AES-CBC per-URL decryption |
| vixsrc | VixSrc | HLS | JSON API → HTML → token/expires/playlist → HLS master |

### Disabled (3)

| Provider ID | Reason Disabled |
|---|---|
| 02moviedownloader | Cloudflare Turnstile (CAPTCHA) |
| anyembed | Unstable API (403s, 500s) |
| fmovies4u | "Currently broken" |

---

## Architecture

```
Client → CinePro API (/v1/proxy?data=...) → Provider Registry → Per-Provider Extractor → Direct video URL → Proxied response
```

The `createProxyUrl()` method wraps the extracted URL into a JSON blob `{ url, headers }`, base64-encodes it, and returns it as a path on CinePro's proxy endpoint. The proxy then fetches the actual video with the correct headers and streams it back.

### Provider Auto-Discovery

```typescript
const registry = server.getRegistry();
await registry.discoverProviders(path.join(__dirname, './providers/'));
```

The registry scans the providers directory recursively, imports every `.js`/`.ts` file, checks if the exported class extends `BaseProvider.prototype`, and instantiates it.

---

## 4 Source Extraction Patterns

### Pattern 1: Direct API Fetch (Simplest)

Used by: **Icefy**, **CineSu**, **VidApi**

```typescript
// icefy -- just a JSON endpoint
GET https://streams.icefy.top/movie/{tmdbId}
→ { stream: "https://...master.m3u8" }

// cinesu -- direct URL construction
`${BASE_URL}/v1/stream/master/movie/${tmdbId}.m3u8`
```

No encryption, no obfuscation. Returns the HLS URL directly.

### Pattern 2: Fan-out to Sub-Servers with Decryption

Used by: **Peachify**, **VidNest**, **Tulnex**, **Videasy**, **Popr**, **VidZee**

Hit multiple backend API endpoints in parallel via `Promise.allSettled()`, decrypt responses, merge results:

```typescript
// Peachify -- 6 servers, AES-GCM encrypted
const SERVERS = [
  'https://uwu.eat-peach.sbs/moviebox',
  'https://usa.eat-peach.sbs/holly',
  'https://usa.eat-peach.sbs/air',
  'https://usa.eat-peach.sbs/multi',
  'https://uwu.eat-peach.sbs/net',
  'https://uwu.eat-peach.sbs/bmb',
];
// Response: iv.ciphertext.authTag (dot-separated base64url)
// Key: base64 decoded from hex, imported as AES-GCM key
// Decrypted: { sources: [...], subtitles: [...] }

// VidNest -- 10 servers, custom-base64 encoded
const SERVERS = ['moviebox', 'allmovies', 'catflix', 'purstream', 'hollymoviehd',
                 'lamda', 'flixhq', 'vidlink', 'onehd', 'klikxxi'];
// Custom alphabet: RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/=
// Each server has its own response shape and field mappings
```

### Pattern 3: Multi-Hop Scraping

Used by: **VidSrc**, **VixSrc**

Chain of HTML/API requests:

```typescript
// vixsrc:
// 1. GET https://vixsrc.to/api/movie/{tmdbId}
//    → { src: "/some/path" }
// 2. GET https://vixsrc.to/some/path
//    → HTML containing: token, expires, url fields
// 3. Build: `${playlist}?token=${token}&expires=${expires}&h=1`
//    → HLS master playlist → parse variants + audio tracks
```

### Pattern 4: Encrypted Blob Responses

Used by: **Videasy**, **Tulnex**, **StreamMafia**

Provider returns an opaque encrypted blob. Requires external decrypt API or multi-layer crypto:

```typescript
// videasy:
// GET https://api.videasy.net/{server}/sources-with-title?tmdbId=...&...
// → hex blob (plain text)
// POST to https://enc-dec.app/api/dec-videasy
// → { sources: [...], subtitles: [...] }
```

---

## Encryption Methods Found

| Provider | Encryption | Details |
|---|---|---|
| Peachify | AES-256-GCM | Dot-separated base64url payload, key from hex→base64→raw bytes |
| VidNest | Custom base64 | Non-standard alphabet: `RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/=` |
| Tulnex | 4-layer | XOR → binary decode → AES-CBC (PBKDF2 key) → HMAC-SHA512 verify |
| VidZee | AES-CBC | Per-source URL encryption, key fetched from `/api-key` (itself AES-GCM encrypted) |
| StreamMafia | AES-256-GCM | `{ iv, tag, data }` base64, SHA-256 derived key |
| Fmovies4U | AES (CryptoJS) | Whole response ciphertext, fixed base64 key |
| VidRock | AES-CBC | Item ID encrypted with fixed passphrase, URL-safe base64 |
| Videasy | External API | Hex blob → `enc-dec.app` API (WASM/CryptoJS server-side) |
| 02MovieDownloader | AES-256-CBC | `{ encrypted: true, data: "iv:ciphertext" }`, SHA-256 token→key |

---

## Proxy Unwrapping System

`thirdPartyProxies.ts` detects and unwraps third-party proxy URLs to get direct video URLs:

```typescript
export const knownThirdPartyProxies: Record<string, RegExp[]> = {
  'https://hls1.vid1.site': [/\/proxy\/(.+)$/],
  'https://madplay.site': [/\/api\/[^/]+\/proxy\?url=(.+)$/],
  '*': [
    /workers\.dev\/((?:https?:\/\/).+)/,
    /\/proxy\/(.+)$/,
    /\/(?:m3u8|mp4)-proxy\?url=(.+?)(?:&|$)/,
    /\/api\/[^/]+\/proxy\?url=(.+)$/,
    /\/proxy\?.*url=([^&]+)/,
    /\/stream\/proxy\/(.+)$/,
  ]
};
```

Applies multi-level URI decoding (up to 5 passes) to handle nested encoding.

---

## Provider Overlap: FilmSnaps ↔ CinePro

| FilmSnaps Provider | CinePro Has It? | CinePro Status |
|---|---|---|
| **Server 1**: nxsha | ❌ No | — |
| **Server 2**: peachify | ✅ Yes | Likely broken (AES-GCM key may have rotated) |
| **Server 3**: screenscape | ❌ No | — |
| **Server 4**: nhdapi | ❌ No | — |
| **Server 5**: zxcstream | ❌ No | — |
| **Server 6**: cinemaos | ❌ No | — |
| **Server 14**: vidnest | ✅ Yes | ✅ **Working** — custom base64, stable API |
| **Server 16**: vixsrc | ✅ Yes | Likely broken (multi-hop, fragile) |
| **Server 18**: chillflix | ❌ No (vidapi unrelated) | — |
| **Server 19**: toustream | ❌ No | — |
| **Server 20**: videasy | ✅ Yes | Broken — external decrypt API may have changed |
| **Disabled**: vidsrc variants | ✅ Yes | Likely broken (iframes change frequently) |

**Verification from usage:** Only **icefy** and **vidnest** currently work in CinePro. All others are stale/broken.

---

## Why Most CinePro Providers Break

1. **API endpoint changes** — provider moves/renames their API, extractor uses old URL
2. **Encryption key rotation** — hardcoded decryption keys become invalid
3. **Anti-bot measures** — Cloudflare, Turnstile, bot detection block server-side requests
4. **Response structure changes** — new fields, removed fields, renamed aliases
5. **Server-level blocking** — provider blocks non-browser User-Agents or missing cookies
6. **Maintenance burden** — each provider requires ongoing attention, not a one-time implementation

---

## Comparison: WebView + Adblock vs Server-Side Extraction

| Dimension | WebView + Adblock (Our Current) | Server-Side Extraction (CinePro) |
|---|---|---|
| **Setup per provider** | Low — just load the embed URL | High — reverse-engineer API, decryption, response mapping |
| **Maintenance** | Low — embed rarely changes format | High — every API update breaks extraction |
| **Ad blocking** | Complex waterfall (R0-R8) | Not needed — no WebView |
| **Anti-adblock evasion** | Arms race, constant updates | Not relevant |
| **Video quality** | As-is from provider | Can select best variant from HLS manifest |
| **Playback** | WebView-based (limited) | Native player (full control) |
| **Cloudflare** | Chromium handles it automatically | Blocks server-side fetch |
| **HEVC support** | WebView limited | Native player better |
| **Battery/performance** | WebView overhead | Minimal |
| **Subtitle extraction** | Embedded in WebView | Can extract from API |
| **Multi-audio** | Provider-determined | Can parse from HLS manifest |

---

## Practical Path Forward

### Providers with Simple, Stable APIs (vidnest, icefy)

Server-side extraction is proven to work. We can build extractors and offer native playback as an alternative path:

| Provider | Endpoint | Encryption | Status |
|---|---|---|---|
| VidNest | `https://new.vidnest.fun/{server}/movie/{tmdbId}` | Custom base64 | ✅ Working in CinePro |
| Icefy | `https://streams.icefy.top/movie/{tmdbId}` | None | ✅ Working in CinePro |

### Providers We'd Need to Reverse-Engineer (screenscape, cinemaos)

Open the embed in DevTools → network tab → trace the video URL source → identify the API endpoint → understand any encryption → build extractor.

### Recommended Strategy: Hybrid

1. **Default:** WebView + adblock (works for most providers, low maintenance)
2. **For specific providers:** Offer native playback when extraction is simple and stable
3. **Adblock:** Keep the native engine for WebView-based providers; it's still the right tool for that context

This gives us the best UX where possible and the broadest coverage where not.

---

## Files Referenced

All paths under `core-main/src/`:

| File | Purpose |
|---|---|
| `server.ts` | Server bootstrap, provider auto-discovery |
| `streamPatterns.ts` | Regex patterns for direct-streamable URLs |
| `thirdPartyProxies.ts` | Third-party proxy unwrapping patterns |
| `providers/peachify/peachify.ts` | Peachify extractor (6 servers, AES-GCM) |
| `providers/peachify/decrypt.ts` | AES-256-GCM decryption implementation |
| `providers/vidnest/vidnest.ts` | VidNest extractor (10 servers, custom-base64) |
| `providers/vidnest/decrypt.ts` | Custom base64 decoder |
| `providers/vixsrc/vixsrc.ts` | VixSrc extractor (3-hop scraping) |
| `providers/videasy/videasy.ts` | Videasy extractor (6 servers, external decrypt) |
| `providers/icefy/icefy.ts` | Icefy extractor (simple JSON API) |
| `providers/vidapi/vidapi.ts` | VidApi extractor (URL-based params) |
| `utils/jsunpack.ts` | JavaScript "p.a.c.k.e.r" unpacker |
| `utils/ua.ts` | Random User-Agent generator |

Notable providers in CinePro we don't have: icefy, cinesu, popr, tulnex, vidzee, vidrock, streammafia, fshare, fmovies4u.
