# Filmsnaps Adblock Architecture — Expert Consultation

**Document type:** Explanation / Architecture Consultation
**Audience:** External technical expert (streaming, adblock, Android WebView security)
**Prepared by:** Filmsnaps engineering
**Date:** 2026-07-21

---

## 1. Executive Summary

Filmsnaps is a streaming aggregation app (Android + Web) that loads video content from third-party streaming providers inside WebViews. We use a multi-layer adblock system to keep the experience clean. **The core problem:** our adblock engine is too aggressive — it routinely blocks legitimate HLS video CDN requests (e.g., `proxy.itsnitrox.tech`, `oo.itsnitrox.tech`), resulting in black video with audio, `MEDIA_ERR_NETWORK` errors, and a broken experience for users.

We need the expert's advice on:

1. **Smart video URL detection** — how to recognize video content (HLS manifests, MP4 streams, media segments) at the interception layer and never block them, regardless of domain
2. **Single source of truth** — consolidate our 5+ scattered adblock configuration points into one GitHub-hosted `blocklist.json` that drives all blocking decisions
3. **Extensible rule system** — how to add/remove/update providers, CDN domains, and blocking rules by editing one file, without code changes
4. **Dynamic config updates** — app fetches new rules on restart (or mid-session) and hot-reloads them

---

## 2. Problem Statement

### 2.1 What Breaks

The Android app shows a black video player with audio only, and logs show:

```
BLOCK | ADBLOCK_ENGINE | proxy.itsnitrox.tech
```

The blocked URL is a genuine HLS video manifest:

```
https://proxy.itsnitrox.tech/nitro/ZXlKaGJHY2lPaUpJVXpJMU5pSXNJbWxoZENpNk1DNHhNREF3TURBeE5EQXdNREF3TURBeE5DNDFOellpTENK.../master.m3u8
```

Or a video-on-demand path:

```
https://oo.itsnitrox.tech/hs/tv/94997/1/1/master.m3u8
```

These are **not ads**. They are HLS master manifests delivering the actual movie/TV show content from the nxsha provider's video CDN (`web.nxsha.app`). The adblock engine catches them because EasyList contains patterns that match substrings in these URLs, or because the hostname `proxy.itsnitrox.tech` is not in the allowlist.

### 2.2 Impact

- Users see a black screen with audio (HEVC + H.264 players both fail because the manifest is blocked)
- `MEDIA_ERR_NETWORK` fires in the video.js player
- The provider is marked as "broken" by users, reducing the pool of working servers
- Every new provider integration requires repeated allowlist updates as new video CDN domains are discovered

### 2.3 Why Adding to the Allowlist Didn't Fix It

We added `proxy.itsnitrox.tech` and `oo.itsnitrox.tech` to `blocklist.json`'s `allowedCdnHosts` and republished. The app continued blocking because:

1. **Stale config:** The Android app caches `blocklist.json` at startup. Republishing the file on GitHub doesn't trigger a re-fetch mid-session — the user would need to force-quit and reopen the app.
2. **Rule ordering:** The adblock waterfall (see §4.3) checks the AdblockEngine (R4) before the CDN allowlist in some code paths. By the time we reach the domain-level allowlist, the AdblockEngine has already decided to block.
3. **Multiple config sources:** Hardcoded Kotlin `allowedCdnHosts` + `blocklist.json` `allowedCdnHosts` + filter-compiler overrides + AdblockEngine patterns — not all sources agree or are consulted in the right order.

---

## 3. Provider Ecosystem & URL Anatomy

### 3.1 The Provider Model

Filmsnaps aggregates content from ~10 active streaming providers. Each provider runs in its own WebView iframe. The provider loads an embed page, which in turn loads video from one or more CDN domains. The video is served as HLS (`.m3u8` + `.ts` segments), MP4, or similar streaming formats.

| # | Provider ID | Embed Domain | Video CDN Domains | Platform |
|---|---|---|---|---|
| 1 | nxsha | web.nxsha.app | nxcdn.app, cdn.nxsha.app, proxy.itsnitrox.tech, oo.itsnitrox.tech | web+mobile |
| 2 | peachify | peachify.top | eat-peach.sbs, workers.dev, cloudfront.net | web+mobile |
| 3 | screenscape | screenscape.me | (inline video) | web only |
| 4 | nhdapi | nhdapi.com | nhdcdn.com, nhd.video | web only |
| 5 | zxcstream | zxcstream.xyz | test.zxcstream.xyz, cloudfront.net | web only |
| 6 | cinemaos | cinemaos.live | (inline video) | web only |
| — | falix | falix-backend.hf.space | (direct download API) | mobile only |
| 14 | vidnest | vidnest.fun | workers.dev, vidnees, wyzie.io, vdrk.site, cloudfront.net | web+mobile |
| 18 | chillflix | www.chillflix.lol | vidapi.cloud, cloudfront.net | web only |
| 19 | toustream | toustream.xyz | (TBD) | web+mobile |
| 20 | vidking | www.vidking.net | (self-hosted) | web+mobile |
| — | streamguide | streamguide.cfd | (self-hosted) | web+mobile |

### 3.2 Video URL Patterns

Each provider serves video via different URL patterns. **The critical insight: these URLs look structurally different from ad/tracker URLs** — they follow consistent media-serving patterns.

#### 3.2.1 HLS Streaming Manifests

These are the most commonly blocked because they arrive with `Sec-Fetch-Dest: empty` (not `video` or `audio`), which means our media-layer heuristic in R1 (see §4.3) misses them.

```
# Nitro HLS Proxy (nxsha provider)
proxy.itsnitrox.tech/nitro/{base64-encoded-session}/master.m3u8

# Generic HLS / DASH manifests
{ncdn}.com/hls/{content-id}/master.m3u8
{ncdn}.com/{format}/{type}/{id}/{season}/{episode}/master.m3u8
{ncdn}.vod/v1/{hash}/manifest.mpd
{ncdn}.com/{random-path}/index.m3u8
```

#### 3.2.2 Media Segment URLs

Once an HLS manifest is loaded, the player fetches `.ts` (MPEG-TS) or `.m4s` (segmented MP4) segments. These are always blocked or allowed in lockstep with the manifest:

```
proxy.itsnitrox.tech/nitro/{base64}/segment-001.ts
proxy.itsnitrox.tech/nitro/{base64}/segment-002.ts
{cdn}.com/{path}/seq-{n}-{quality}.ts
```

#### 3.2.3 Direct Video URLs (MP4 / WebM)

Some providers serve direct MP4 files:

```
{provider}.com/{resource}/{quality}/{filename}.mp4
{cdn}.com/media/{uuid}/video.mp4
```

#### 3.2.4 Provider Embed URLs

These are the embed pages loaded into the WebView. They load the player page, which then discovers and requests video URLs:

```
# nxsha movie
web.nxsha.app/embed/movie/{tmdb-id}?disable_dl_button=true&lang=hi

# nxsha TV
web.nxsha.app/embed/tv/{tmdb-id}/{season}/{episode}?disable_dl_button=true&lang=hi

# peachify
peachify.top/embed/movie/{tmdb-id}
peachify.top/embed/tv/{tmdb-id}/{season}/{episode}

# zxcstream
zxcstream.xyz/player/movie/{tmdb-id}?dubLang=hi

# cinemaos
cinemaos.live/movie/watch/{tmdb-id}
cinemaos.live/tv/watch/{tmdb-id}?season={n}&episode={n}

# chillflix
chillflix.lol/embed/movie/{tmdb-id}
chillflix.lol/embed/tv/{tmdb-id}/{season}/{episode}

# vidnest
vidnest.fun/movie/{tmdb-id}
vidnest.fun/tv/{tmdb-id}/{season}/{episode}
```

### 3.3 Ad & Tracker URL Patterns (for contrast)

These are the URLs we DO want to block. They look fundamentally different from video URLs:

```
*.doubleclick.net/*              — Google ad server
*.googleadservices.com/*         — Google ads
*.googlesyndication.com/*        — Google ad syndication
*.adnxs.com/*                    — AppNexus
*.rubiconproject.com/*           — Rubicon
*.criteo.com/*                   — Criteo retargeting
*.outbrain.com/*                 — Outbrain widgets
*.taboola.com/*                  — Taboola widgets
*.popads.net/*                   — Popunder ads
*.popcash.net/*                  — Popunder network
*.adsterra.com/*                 — Ad network
*.propellerads.com/*             — Popunder network
*.exoclick.com/*                 — Adult ad network
*.juicyads.com/*                 — Adult ad network
*.plugrush.com/*                 — Adult ad network
*.trafficjunky.com/*             — Adult ad network
*.clickadu.com/*                 — Popunder network
{any}/pop.js                     — Common popunder script
{any}/popunder.js                — Common popunder script
{any}/track.php                  — Tracker
{any}/ad.php                     — Ad server script
{any}/banner.*                   — Banner ad
```

Video URLs typically have: media file extensions (.m3u8, .ts, .mp4, .m4s, .webm), structured paths with IDs (/tv/{n}/{n}/{n}/, /movie/{n}/), and content identifiers (TMDB IDs like 94997, base64 session tokens). Ad URLs typically have: ad/tracker-related path segments, third-party cookie domains, and script injection endpoints.

---

## 4. Current Adblock Architecture

The adblock system has **six distinct layers**, spanning compile-time (filter generation), compile-time (per-provider overrides), runtime (Kotlin engine), runtime (WebView interception), runtime (in-browser JS guard), and runtime (remote config). This multiplicity is the source of both power and confusion.

### 4.1 Layer 0 — Remote Blocklist Config (`blocklist.json`)

**File:** [`blocklist.json`](blocklist.json) (project root)

```json
{
  "version": 1,
  "allowedCdnHosts": [
    "akamai.net", "cloudfront.net", "fastly.net",
    "proxy.itsnitrox.tech", "oo.itsnitrox.tech",
    "vidapi.cloud", "vidnees", "eat-peach.sbs",
    ...
  ],
  "blockedDomains": [
    "fj.topperanlases.com", "google-analytics.com", ...
  ],
  "providerProfiles": {
    "web.nxsha.app": ["web.nxsha.app", "workers.dev", "cloudfront.net"],
    "peachify.top": ["peachify.top", "eat-peach.sbs", "workers.dev", ...],
    ...
  },
  "providerRootHosts": [
    "web.nxsha.app", "peachify.top", "screenscape.me", ...
  ]
}
```

This file is **not yet hosted on GitHub** but we plan to. The Android app uses `BlocklistConfigLoader` to fetch it on startup. If unreachable, it falls back to a cached copy.

**Limitations:** 
- Only consulted by Kotlin layer (R2 in the waterfall). Not used by the filter-compiler or JS guard.
- No support for glob/regex patterns (only exact host matching).
- `providerProfiles` are referenced by embed domain, not by provider ID — no cross-reference.

### 4.2 Layer 1 — Compile-Time Filter Generation

**Package:** [`packages/filter-compiler`](packages/filter-compiler/)

#### 4.2.1 Sources

At build time, `compile.ts` fetches these blocklists from the network:

| Source | URL | Approx. size |
|--------|-----|-------------|
| EasyList | `easylist.to/easylist/easylist.txt` | ~80K rules |
| EasyPrivacy | `easylist.to/easylist/easyprivacy.txt` | ~30K rules |
| AdGuard Base | `filters.adtidy.org/extension/.../base/filter.txt` | ~30K rules |
| uBO Unbreak | `raw.githubusercontent.com/uBlockOrigin/.../unbreak.txt` | ~500 rules |
| uBO Badware | `raw.githubusercontent.com/.../badware.txt` | ~100 rules |
| Per-provider overrides | Local `overrides/index.ts` | ~15 domains |
| Legacy AD_PATTERNS | Local hardcoded list | ~50 domains |

#### 4.2.2 Compilation Pipeline

```
EasyList + EasyPrivacy + AdGuard + uBO lists
  → @cliqz/adblocker FiltersEngine (deserialized in browser/Node)
  → serialized to compiled-engine.bin    (for web server-side matching)
  → export-android.ts
    → android-adblock-patterns.json      (for Kotlin AdblockEngine)

Overrides (per-provider allowlists)
  → EasyList syntax:
    @@||domain^$document
    @@||domain^$xmlhttprequest
    @@||domain^$media
  → Merged into FiltersEngine at compile time
```

#### 4.2.3 Exported Android Patterns

[`export-android.ts`](packages/filter-compiler/src/export-android.ts) extracts from the compiled engine:

```
android-adblock-patterns.json:
  blockedDomains: string[]          — exact domains to block
  blockedUrlSubstrings: string[]    — substrings to match in URLs
  allowedDomains: string[]          — exact domains to allow
  allowedUrlPrefixes: string[]      — URL prefixes to allow
  regexTriggers: string[]           — regex patterns for edge cases
  cosmeticSelectors: string[]       — CSS selectors to hide
```

The android patterns JSON is bundled into the app as `assets/adblock-patterns.json`.

**Limitations:**
- The filter-compiler does NOT read `blocklist.json` — so `allowedCdnHosts` and `providerProfiles` from blocklist.json are not compiled into the adblock patterns.
- Overrides are hand-maintained in TypeScript (`overrides/index.ts`) — adding a new provider requires a code change and recompile.
- The compiled engine is static until the next build; you cannot push a hotfix for a false-positive block without an app update.

### 4.3 Layer 2 — Kotlin AdblockEngine (`AdblockEngine.kt`)

**File:** [`AdblockEngine.kt`](apps/mobile/modules/player-webview/android/src/main/java/expo/modules/playerwebview/AdblockEngine.kt) (~439 lines)

#### 4.3.1 Data Structure — Aho-Corasick Automaton

The engine uses the [Aho-Corasick algorithm](https://en.wikipedia.org/wiki/Aho%E2%80%93Corasick_algorithm) for O(L) multi-pattern matching (L = URL length). Patterns from `android-adblock-patterns.json` are loaded into a trie with failure links and output links.

- Add pattern: O(pattern length)
- Match URL: O(URL length) regardless of number of patterns
- ~50,000+ patterns compiled from EasyList → trie

#### 4.3.2 Matching Flow

The `shouldBlock(url: String, host: String): Boolean` method implements a 4-step waterfall:

```
shouldBlock(url, host):
  1. DOMAIN ALLOWLIST CHECK
     if host in allowedDomains → return ALLOW (immediately)

  2. PATH-ANCHORED EXCEPTIONS
     for each allowedUrlPrefix:
       if url starts with prefix → return ALLOW

  3. DOMAIN BLOCKLIST CHECK
     if host in blockedDomains → return BLOCK (immediately)

  4. UNIFIED MATCHING (Aho-Corasick)
     match url against blockedUrlSubstrings + regexTriggers
     if any match found (or regex triggered) → return BLOCK
     else → return ALLOW
```

**Key insight for our problem:** Step 1 (domain allowlist) is the first check. If `proxy.itsnitrox.tech` were in `allowedDomains`, it would be allowed before any pattern matching. However, the exported `allowedDomains` comes from the filter compiler, NOT from `blocklist.json` — so our `blocklist.json` edit doesn't populate this list.

Also note: the Aho-Corasick pattern set is loaded at app startup and is immutable until the app restarts. There is no hot-reload mechanism.

### 4.4 Layer 3 — WebView Request Interception (`PlayerWebViewOverlayView.kt`)

**File:** [`PlayerWebViewOverlayView.kt`](apps/mobile/modules/player-webview/android/src/main/java/expo/modules/playerwebview/PlayerWebViewOverlayView.kt) (~2233 lines)

This is the central interception point. Every request made by the WebView passes through `shouldInterceptRequest()`. The method implements an **8-rule waterfall** (R1–R8):

```
shouldInterceptRequest(view, request):
  url = request.url.toString()
  host = extractHost(url)
  
  // ── LOGGING ──
  logRequest(method, url, headers, ...)
  
  // ════════════════════════════════════════
  // R1: MEDIA / RANGE → ALLOW
  // ════════════════════════════════════════
  if (request has Range header ||
      secFetchDest == "video" || secFetchDest == "audio"  ||
      url matches videoExtensions (.mp4, .m3u8, .ts, .webm))
    → ALLOW (return null)
  
  // ════════════════════════════════════════
  // R1b: Workers.dev strict partitioning
  // ════════════════════════════════════════
  if (host == "workers.dev" && url does NOT end with media extension)
    → BLOCK
  
  // ════════════════════════════════════════
  // R2: CDN ALLOWLIST
  // ════════════════════════════════════════
  // Checks effectiveAllowedCdnHosts (merged from:
  //   hardcoded Kotlin Set + BlocklistConfigLoader + provider session lock)
  if (host matches effectiveAllowedCdnHosts)
    → ALLOW
  
  // ════════════════════════════════════════
  // R3: CURRENT PROVIDER DOMAIN
  // ════════════════════════════════════════
  // Any requests to the provider's own domain are allowed
  if (url starts with currentProviderBaseUrl)
    → ALLOW
  
  // ════════════════════════════════════════
  // R4: ADBLOCK ENGINE
  // ════════════════════════════════════════
  // Calls AdblockEngine.shouldBlock(url, host)
  if (AdblockEngine says BLOCK)
    → BLOCK
  
  // ════════════════════════════════════════
  // R5: HEURISTIC BLOCKING
  // ════════════════════════════════════════
  // Blocks iframes, scripts, images from unknown domains
  if (resourceType is iframe/script/image && host is NOT in any known set)
    → BLOCK
  
  // ════════════════════════════════════════
  // R6: PER-PROVIDER PROFILE BLOCKING
  // ════════════════════════════════════════
  // Checks providerProfiles for domain allowlist + hardcoded block patterns
  if (host not in current provider's profile && resource is risky)
    → BLOCK
  
  // ════════════════════════════════════════
  // R7: DOMAIN BLOCKLIST
  // ════════════════════════════════════════
  // Checks the adDomains Set (populated from compiled patterns)
  if (host matches adDomains)
    → BLOCK
  
  // ════════════════════════════════════════
  // R8: PATH BLOCKLIST
  // ════════════════════════════════════════
  // Checks adPathPatterns against URL path
  if (path matches adPathPatterns)
    → BLOCK
  
  // DEFAULT: ALLOW
  return null
```

#### 4.4.1 Hardcoded Allowed CDN Hosts (Kotlin)

The Kotlin code also has a hardcoded set that predates remote config:

```kotlin
private val allowedCdnHosts = setOf(
    "akamai.net", "akamaiedge.net", "cloudfront.net",
    "fastly.net", "fastlylb.net",
    "vidapi.cloud", "vidnees", ...
)
```

This is **separate** from `blocklist.json`'s `allowedCdnHosts`. Both are merged at runtime into `effectiveAllowedCdnHosts`.

#### 4.4.2 Video Extension Detection

The hardcoded `videoExtensions` set in Kotlin:

```kotlin
private val videoExtensions = setOf(
    ".m3u8", ".ts", ".mp4", ".webm", ".mkv",
    ".m4s", ".mpd", ".m4v", ".3gp"
)
```

This is checked in R1 but only for URL suffix matching — not path pattern matching.

### 4.5 Layer 4 — In-Browser JS Guard (`playerGuard.ts`)

**File:** [`packages/shared/src/security/playerGuard.ts`](packages/shared/src/security/playerGuard.ts) (~619 lines)

A JavaScript snippet injected into every provider WebView page. It implements 15 defensive layers:

| Layer | What it blocks |
|-------|---------------|
| 1 | `fetch()` / `XMLHttpRequest` → AD_PATTERNS domain matching |
| 2 | DOM mutation sweeper — removes ad elements every 100ms |
| 3 | `window.open()` override — blocks popups |
| 4 | `window.location` override — blocks redirects |
| 5 | `document.write` override — blocks injected scripts |
| 6 | `eval()` override — blocks dynamic code execution |
| 7 | `setTimeout` interception — filters ad code in delayed execution |
| 8 | Hardcoded `AD_NETWORKS` list (~100+ ad network domains) |
| 9 | Base64-encoded ad URL detection |
| 10 | Known ad class/id CSS selector removal |
| 11 | IntersectionObserver for late-loading ads |
| 12 | RequestAnimationFrame callback interception |
| 13 | `Worker()` constructor override |
| 14 | `importScripts()` override |
| 15 | Periodic re-injection (in case the page clears our overrides) |

The JS guard's `AD_PATTERNS` list is a hardcoded array in TypeScript — it's **not** generated from `blocklist.json` or the filter compiler. This is a significant maintainability gap.

### 4.6 Layer 5 — Per-Provider Overrides

**File:** [`packages/filter-compiler/src/overrides/index.ts`](packages/filter-compiler/src/overrides/index.ts)

Each provider gets an entry specifying:
- `allowPatterns`: domain patterns that should never be blocked (written as `@@||domain^$document`, `@@||domain^$xmlhttprequest`, `@@||domain^$media`)
- `blockPatterns`: extra ad/tracker domains specific to this provider

Example for Nxsha:

```typescript
{
  providerId: 'nxsha',
  displayName: 'Nxsha / Server 1',
  allowPatterns: [
    'nxsha.app', 'web.nxsha.app', 'nxcdn.app',
    'nxcdn.video', 'nxs-ha.com',
    'proxy.itsnitrox.tech', 'oo.itsnitrox.tech',
  ],
  blockPatterns: [],
}
```

These overrides are compiled into the FiltersEngine (Layer 1) as EasyList exception/block rules. They are **not** consulted by the Kotlin AdblockEngine or the JS guard directly.

---

## 5. The Blocking Gap — Root Cause Analysis

### 5.1 Tracing a master.m3u8 Request

Let's trace what happens when the nxsha provider's video player requests:

```
https://proxy.itsnitrox.tech/nitro/ZXlKaGJHY2lPaUpJVXpJMU5pSXNJbWxoZENpNk1DNHhNREF3TURBeE5EQXdNREF3TURBeE5DNDFOellpTENK.../master.m3u8
```

| Layer | Check | Result | Why |
|-------|-------|--------|-----|
| **R1** | Range header? | No | HLS manifests are fetched without Range |
| **R1** | Sec-Fetch-Dest: video/audio? | No | HLS manifest is fetched as `Sec-Fetch-Dest: empty` or `document` |
| **R1** | Video extension suffix? | Yes — `.m3u8` | ✅ SHOULD match... but if R1 check is strict about Sec-Fetch-Dest first, or if the `.m3u8` check is ordered after the header checks, it may fall through |
| **R2** | CDN allowlist? | Depends | `proxy.itsnitrox.tech` IS in blocklist.json, but **only after the latest edit** — and only if the app re-fetched the config |
| **R3** | Current provider domain? | No | `proxy.itsnitrox.tech` ≠ `web.nxsha.app` |
| **R4** | AdblockEngine? | ⛔ **BLOCK** | EasyList or Aho-Corasick matches some substring in `proxy.itsnitrox.tech` or the full URL |
| **R5** | Heuristic? | Reached but moot | Already blocked by R4 |
| **DEFAULT** | — | — | Never reached |

### 5.2 Why It Passes R1 Despite Having .m3u8

The actual R1 logic in the Kotlin code:

```kotlin
// Simplified from PlayerWebViewOverlayView.kt
val hasRange = request.requestHeaders?.get("Range") != null
val secFetchDest = request.requestHeaders?.get("Sec-Fetch-Dest")
val isVideoDest = secFetchDest == "video" || secFetchDest == "audio"

// Check video extensions
val path = URI(url).path?.lowercase() ?: ""
val hasVideoExt = videoExtensions.any { path.endsWith(it) }

if (hasRange || isVideoDest || hasVideoExt) {
    return null // ALLOW
}
```

**The .m3u8 suffix check DOES match** — so in theory R1 should allow it. The reported blocking suggests one of:
1. The `effectiveAllowedCdnHosts` was stale (didn't include `proxy.itsnitrox.tech`), **and** the .m3u8 check is ordered after the header checks and may short-circuit on Sec-Fetch-Dest logic
2. Some requests from the provider use a path without `.m3u8` (e.g., JSON API that returns manifest URLs)
3. The blocking is happening at a LATER layer (JS guard Layer 4) rather than the Kotlin waterfall

### 5.3 The Multi-Config Drift Problem

Here's the core architectural weakness: **six different places where adblock rules live, each with different formats and update mechanisms:**

| Source | Format | Update mechanism | Used by |
|--------|--------|-----------------|---------|
| `blocklist.json` | JSON | GitHub push + app re-fetch | Kotlin R2 |
| Hardcoded Kotlin sets | Kotlin code | App build + release | Kotlin R1, R2, R7, R8 |
| `android-adblock-patterns.json` | JSON | Build pipeline | Kotlin AdblockEngine (R4) |
| `overrides/index.ts` | TypeScript | Build pipeline | Filter compiler → R4 |
| `playerGuard.ts` `AD_PATTERNS` | TypeScript | Build + release | In-browser JS (Layer 4) |
| `compile.ts` sources | URL fetches | Build pipeline | Filter compiler |

A domain added to `blocklist.json` does NOT automatically appear in:
- The hardcoded Kotlin sets
- The exported `android-adblock-patterns.json`'s `allowedDomains`
- The `playerGuard.ts` `AD_PATTERNS`
- The filter-compiler's `overrides/index.ts`

This means a block/allow decision may succeed in one layer and be overruled by another.

---

## 6. Critical Architecture Questions for the Expert

### Q1 — Smart Video URL Detection (Highest Priority)

We need a system that **never blocks genuine video content**, regardless of what EasyList or other pattern matchers say. We're asking for specific techniques.

#### 6.1.1 URL Path Pattern Analysis

Video-serving URLs follow distinct structural patterns that ad URLs do not. Can we build a matcher that recognizes:

```
# Structured media paths
/{type}/{content-id}/{season}/{episode}/{filename}.{ext}
  e.g., /tv/94997/1/1/master.m3u8
  e.g., /movie/1431071/video.mp4

# Base64-path manifests
/{base64-session}/{filename}.{ext}
  e.g., /nitro/ZXlKaGJHY2lPaUpJVXpJMU5pSXNJbWxoZENpNk1DNHh.../master.m3u8

# CDN-relative paths
/hls/{uuid}/master.m3u8
/vod/{hash}/manifest.mpd

# Direct content-hash paths
/{hash}/{quality}/{filename}.ts
```

**Questions:**
- What regex or glob patterns would reliably match video URLs without false positives?
- Should we match on path depth (≥3 segments before filename), numeric segments, base64 segments, or content hashes?
- Are there known ad URLs that happen to follow `/tv/\d+/\d+/\d+/` or similar patterns?

#### 6.1.2 MIME Type Sniffing

Instead of (or in addition to) URL pattern matching, can we inspect the response?

- HLS manifests (.m3u8) return `Content-Type: application/vnd.apple.mpegurl`
- MP4 returns `Content-Type: video/mp4`
- MPEG-TS returns `Content-Type: video/MP2T`

**Questions:**
- Can `shouldInterceptRequest` or a `WebViewClient` hook inspect response headers before delivering the response to WebView?
- Can we issue a lightweight HEAD request to check Content-Type before deciding to block?
- What's the performance cost of this for a high-frequency request stream?

#### 6.1.3 Self-Learning Allowlist Tied to Provider

When a user loads a provider's embed page, the provider makes a series of requests. The first few may be API calls, then a manifest request, then segments. Can we build a state machine:

```
Phase 1 (Embed loaded):    Allow requests to provider domain + CDN allowlist
Phase 2 (API calls):       Allow API-style requests (JSON, XHR)
Phase 3 (Manifest):        First master.m3u8 → mark this CDN as "video source"
Phase 4 (Streaming):       Allow all future requests to that CDN
```

**Questions:**
- Is this per-provider session state feasible in a WebView context?
- How long should the "video source" trust last? Session lifetime? Provider switch?

#### 6.1.4 Required-Scope Specific Recommendations

1. What is the BEST place in the 8-rule waterfall to insert a "video URL → ALLOW" rule? Before R4? Before all rules?

2. Should video detection be:
   - **Option A:** Strict whitelist — only allow video from known `allowedCdnHosts` + known provider embed domains
   - **Option B:** Pattern-based — use regex/glob on URL paths + extensions to detect video
   - **Option C:** Content-type — allow based on response `Content-Type` header
   - **Option D:** Hybrid — combine all three with different priorities

3. What additional URL patterns should we detect beyond `.m3u8`, `.ts`, `.mp4`, `.m4s`, `.webm`, `.mkv`?

4. Given that WebView requests pass through `shouldInterceptRequest` as a callback (not a synchronous proxy), what's the most reliable hook to inspect both request AND response?

5. Should we differentiate between:
   - First-party video (same domain as the embed) — always allow
   - Third-party video (different CDN than the embed) — pattern/header check
   - Unknown domain video — most restrictive, but never block if it looks like media

### Q2 — Single Source of Truth Architecture

We want to consolidate all adblock rules into **one file** (`blocklist.json` on GitHub) that drives every layer. We're not there yet.

#### 6.2.1 Current vs. Desired

| Aspect | Current | Desired |
|--------|---------|---------|
| Config locations | 6+ files/sources | 1 file: `blocklist.json` |
| Update mechanism | Code change + build + release | GitHub push → app fetches on restart |
| Rule format | EasyList + JSON + TypeScript regex | Single JSON schema |
| Platform coverage | Android only (Web not updated) | Android + Web share same config |
| Provider management | Spread across overrides + registry + profiles | One provider entry in blocklist.json |

#### 6.2.2 Proposed blocklist.json Schema (Expanded)

```json
{
  "$schema": "https://filmsnaps.app/blocklist-schema-v2.json",
  "version": 2,
  "meta": {
    "updatedAt": "2026-07-21T12:00:00Z",
    "minAppVersion": "2.1.0",
    "forceUpdate": false
  },
  "rules": {
    "alwaysAllow": {
      "domains": ["*.m3u8", "*.ts", "*.mp4", "*.webm"],
      "pathPatterns": ["/tv/\\d+/\\d+/\\d+/", "/movie/\\d+/"],
      "cdnHosts": [
        "cloudfront.net", "akamai.net", "fastly.net",
        "vidapi.cloud"
      ]
    },
    "alwaysBlock": {
      "domains": [
        "doubleclick.net", "googleadservices.com",
        "popads.net", "adsterra.com"
      ],
      "pathPatterns": ["/pop.js", "/popunder.js", "/ad.php"]
    },
    "videoDetection": {
      "extensions": [".m3u8", ".ts", ".mp4", ".m4s", ".webm", ".mkv"],
      "pathDepthThreshold": 3,
      "contentTypeAllowlist": [
        "application/vnd.apple.mpegurl",
        "video/mp4",
        "video/MP2T",
        "video/webm"
      ]
    }
  },
  "providers": [
    {
      "id": "nxsha",
      "embedDomains": ["web.nxsha.app"],
      "cdnDomains": [
        "nxcdn.app", "cdn.nxsha.app",
        "proxy.itsnitrox.tech", "oo.itsnitrox.tech"
      ],
      "videoPathPatterns": ["/embed/movie/*", "/embed/tv/*"],
      "enabled": true
    }
  ],
  "android": {
    "allowedCdnHosts": [...],
    "blockedDomains": [...]
  },
  "web": {
    "jsGuardPatterns": [...]
  }
}
```

**Questions:**
1. Is this schema a good foundation? What's missing?
2. Should the single source of truth be a flat JSON file, or should we use a specialized format like EasyList-compatible text that gets compiled into JSON at build time?
3. How do we handle the `playerGuard.ts` (in-browser JS) — should the app inject the allow/block patterns from blocklist.json into the WebView JS context at page load?
4. Should the blocklist.json be versioned with a semantic version that the app compares, so we know if it needs to recompile patterns?

### Q3 — Dynamic Update Architecture

#### 6.3.1 Fetch Strategy

**Questions:**
- **Pull on restart:** App fetches `blocklist.json` from GitHub on every cold start. If unreachable, use cached copy. Is this sufficient, or do we need mid-session updates?
- **Background polling:** If a user session lasts hours, should we poll for updates every N minutes? What interval?
- **Cache invalidation:** How does the app know the cached config is stale? Compare `ETag` / `Last-Modified` headers? Version field in the JSON?

#### 6.3.2 Hot-Reload Without Restart

**Questions:**
- Can the Aho-Corasick trie in `AdblockEngine.kt` be rebuilt from new patterns without restarting the app?
- For `PlayerWebViewOverlayView.kt`'s `effectiveAllowedCdnHosts` — can this be a `volatile` / `AtomicReference` that gets swapped atomically?
- Can the in-browser JS guard (`playerGuard.ts`) be updated without reloading the WebView? (Probably not — but could the new config be injected via `evaluateJavascript`?)

#### 6.3.3 Stale Config Handling

**Questions:**
- If GitHub is unreachable on app launch, should we:
  - (a) Use the cached config (might include now-broken rules)?
  - (b) Disable all blocking (user sees ads but app works)?
  - (c) Fall back to a minimal built-in config?
- If the user has been offline for weeks, and we published a critical fix (e.g., a new CDN that was being blocked), how do they get it?

### Q4 — Rule Extensibility & Provider Onboarding

#### 6.4.1 Adding a New Provider

Currently, adding a new streaming provider requires editing:
1. `packages/shared/src/providers/registry.ts` — embed URL templates, display name, order
2. `packages/filter-compiler/src/overrides/index.ts` — CDN allow/block patterns
3. `blocklist.json` — `providerProfiles`, `allowedCdnHosts`, `providerRootHosts`
4. Hardcoded Kotlin `allowedCdnHosts` in `PlayerWebViewOverlayView.kt`
5. Possibly `playerGuard.ts` `AD_PATTERNS`

**Question:**
- How can we make provider-specific CDN allowlisting drive ALL other layers from a single declaration?
- Should the provider's CDN domains be declared in blocklist.json and also in the provider registry? Or should blocklist.json BE the provider registry?

#### 6.4.2 Rule Format

**Questions:**
- What's the right rule format for the single source of truth?
  - **Glob patterns:** `*.m3u8`, `*/tv/*/*/*/*`
  - **Regex:** `/tv/\d+/\d+/\d+/`
  - **EasyList syntax** (already proven via @cliqz/adblocker)
  - **A hybrid:** Glob for simple cases, regex for complex patterns
- Should we support negative patterns (allow everything EXCEPT)?
  - Example: Allow `*.itsnitrox.tech` but block `*.itsnitrox.tech/ads/*`

### Q5 — Platform Parity

**Questions:**
- The web version (Next.js) has its own adblock via `@cliqz/adblocker` server-side. Should it also fetch `blocklist.json` from GitHub instead of using the compiled engine?
- The JS guard (`playerGuard.ts`) runs in both web and mobile WebViews. Should its patterns come from the blocklist.json API instead of being compiled into the bundle?
- Should there be a single `@filmsnaps/adblock-core` package that both platforms consume?

---

## 7. Source Files for Reference

The expert may want to inspect these files directly:

| Purpose | File |
|---------|------|
| Remote blocklist config | [`blocklist.json`](blocklist.json) |
| Kotlin AdblockEngine (Aho-Corasick) | [`AdblockEngine.kt`](apps/mobile/modules/player-webview/android/src/main/java/expo/modules/playerwebview/AdblockEngine.kt) |
| WebView request interception (8-rule waterfall) | [`PlayerWebViewOverlayView.kt`](apps/mobile/modules/player-webview/android/src/main/java/expo/modules/playerwebview/PlayerWebViewOverlayView.kt) |
| Filter compiler — compile pipeline | [`compile.ts`](packages/filter-compiler/src/compile.ts) |
| Filter compiler — Android pattern export | [`export-android.ts`](packages/filter-compiler/src/export-android.ts) |
| Filter compiler — runtime API | [`index.ts`](packages/filter-compiler/src/index.ts) |
| Per-provider overrides | [`overrides/index.ts`](packages/filter-compiler/src/overrides/index.ts) |
| Provider registry (embed URLs, metadata) | [`registry.ts`](packages/shared/src/providers/registry.ts) |
| In-browser JS guard (15 layers) | [`playerGuard.ts`](packages/shared/src/security/playerGuard.ts) |
| JS guard (lighter variant) | [`minimal-guard.ts`](packages/filter-compiler/src/minimal-guard.ts) |
| Provider type definitions | [`provider.ts`](packages/shared/src/types/provider.ts) |
| Blocklist config loader (Android) | [`BlocklistConfigLoader.kt`](apps/mobile/modules/player-webview/android/src/main/java/expo/modules/playerwebview/BlocklistConfigLoader.kt) |

---

## 8. Recommended Architecture (Expert Response)

*This section is intentionally blank — to be filled with the expert's recommendations.*

---

## Appendix A: Full URL Pattern Reference

### A.1 Embed URL Patterns

| Provider | Movie URL | TV URL |
|----------|-----------|--------|
| nxsha | `/embed/movie/{id}?disable_dl_button=true&lang=hi` | `/embed/tv/{id}/{season}/{ep}?disable_dl_button=true&lang=hi` |
| peachify | `/movie/{id}` | `/tv/{id}/{season}/{ep}` |
| screenscape | `?tmdb={id}&type=movie` | `?tmdb={id}&type=tv&s={season}&e={ep}` |
| nhdapi | `/embed/movie/{id}?lang=Hindi&...` | `/embed/tv/{id}/{season}/{ep}?lang=Hindi&...` |
| zxcstream | `/player/movie/{id}?dubLang=hi` | `/player/tv/{id}/{season}/{ep}?dubLang=hi` |
| cinemaos | `/movie/watch/{id}` | `/tv/watch/{id}?season={n}&episode={n}` |
| vidnest | `/movie/{id}` | `/tv/{id}/{season}/{ep}` |
| chillflix | `/embed/movie/{id}?autoplay=true&...` | `/embed/tv/{id}/{season}/{ep}?autoplay=true&...` |
| toustream | `/tou/movies/{id}` | `/tou/tv/{id}/{season}/{ep}` |
| vidking | `/embed/movie/{id}?color=ff0000` | `/embed/tv/{id}/{season}/{ep}?color=ff0000` |
| streamguide | `/embed/?type=m&id=m-api-{id}&ep=m-api-{id}` | `/embed/?type=t&id=t-api-{id}&ep=t-api-{id}-s{season}e{ep}` |

### A.2 Video CDN URL Patterns (Observed)

```
{protocol}://{cdn-domain}/{path}/{resource}.{extension}
{protocol}://{cdn-domain}/{base64-session}/{resource}.{extension}
{protocol}://{cdn-domain}/{type}/{id}/{season}/{ep}/{resource}.{extension}
{protocol}://{cdn-domain}/hls/{uuid}/master.m3u8
{protocol}://{cdn-domain}/vod/{hash}/index.m3u8
{protocol}://{cdn-domain}/media/{slug}/{quality}.mp4
```

### A.3 Ad URL Patterns (Observed, for contrast)

```
{protocol}://*.doubleclick.net/{ad-unit}
{protocol}://*.googlesyndication.com/{ad-slot}
{protocol}://{domain}/pop.js
{protocol}://{domain}/popunder.js
{protocol}://{domain}/track.php?id={tracker-id}
{protocol}://{domain}/banner-{size}.{format}
{protocol}://{domain}/ad.php?zone={zone-id}
```

### A.4 Key Discriminating Features

| Feature | Video URLs | Ad URLs |
|---------|-----------|---------|
| Extensions | `.m3u8`, `.ts`, `.mp4`, `.m4s`, `.webm` | `.js`, `.php`, `.html` (or no extension) |
| Path depth | Deep (≥3 segments) | Shallow (1–2 segments) |
| ID patterns | Numeric (TMDB IDs), base64, UUIDs | Short alphanumeric zone/slot IDs |
| Content indicators | `/tv/`, `/movie/`, `/hls/`, `/vod/`, `/media/` | `/ad/`, `/banner/`, `/pop/`, `/track/` |
| CDN domains | Large-scale CDNs (CloudFront, Akamai, Fastly) + provider-specific | Ad network domains, tracker domains |
| Response type | Media streams (m3u8, MP4, TS) | Scripts, pixels, iframes |
| Request headers | Often have `Range`, `Sec-Fetch-Dest: video` | Usually `Sec-Fetch-Dest: script`, `image`, `iframe` |

---

*End of consultation document*

---

*This document is intended for an external technical expert to review and provide recommendations. All code references point to the `m:\filmsnaps-main` repository.*
