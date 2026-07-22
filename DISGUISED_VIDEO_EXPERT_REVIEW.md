---
name: disguised-video-smart-system
description: Expert consultation on R0 video detection system — previous vs current patterns, disguised segment URLs, and request for more provider evasion patterns
metadata:
  type: reference
---

# Smart Video Detection System: Expert Review Request

## 1. Context

Our Android app runs streaming providers (nxsha, peachify, vidnest, etc.) inside a WebView with a native adblock engine. In Phase 1 (expert-led) we built a **smart video detection system** (R0/R0b) as the first gate in a waterfall of 8 blocking rules:

```
R0b (session trust, O(1) HashMap)
  → R0 (regex path detection)
    → R1 (media/range content-type)
      → R2 (provider embed domain)
        → R3 (CDN allowlist)
          → R4 (Aho-Corasick adblock engine)
            → R5-R8 (fallback rules)
```

## 2. Previous Smart System (Phase 1)

Three regex checks inside R0, run on the URL **path** (query params stripped, lowercased):

| Rule | Regex | Match Example |
|------|-------|---------------|
| `VIDEO_EXTENSION_REGEX` | `\.(m3u8\|mpd\|ts\|m4s\|mp4\|webm\|mkv\|m4v\|3gp\|cmfv\|cmfa\|aac\|key)(\?.*)?$` | `video.mp4`, `master.m3u8?token=abc`, `seg-001.ts` |
| `VIDEO_PATH_REGEX` | `/(movie\|tv\|embed\|watch\|player\|tou)/\d+(/\d+)?(/\d+)?/.*\.(m3u8\|mpd\|ts\|m4s\|mp4\|webm)(\?.*)?$` | `/tv/94997/1/1/master.m3u8`, `/movie/1431071/video.mp4` |
| `BASE64_VIDEO_PATH_REGEX` | `^/[a-zA-Z0-9_-]{20,}/(master\|index\|playlist\|manifest)\.(m3u8\|mpd)(\?.*)?$` | `/nitro/ZXlKa.../master.m3u8` |

R0b (session trust) is activated by any R0 match — the host is added to a `ConcurrentHashMap` and all future requests to that host skip EVERY blocking layer via an O(1) lookup.

## 3. Why We Updated

We observed a specific case where legitimate HLS video was being blocked:

**Provider:** nxsha (Server 1)
**CDN host:** `s6p9.urbancreativepoint.site`
**Blocked URLs:**
```
https://s6p9.urbancreativepoint.site/v4/np/lnhlsj/seg-1-f1-v1.woff2?k=...
https://s6p9.urbancreativepoint.site/v4/np/lnhlsj/init-f1-a1.woff?k=...
https://s6p9.urbancreativepoint.site/v4/np/lnhlsj/seg-1-f2-v1.woff2?k=...
https://s6p9.urbancreativepoint.site/v4/np/lnhlsj/init-f2-v1.woff?k=...
https://s6p9.urbancreativepoint.site/v4/np/lnhlsj/seg-1-f1-a1.woff2?k=...
https://s6p9.urbancreativepoint.site/v4/np/lnhlsj/init-f1-a1.woff?k=...
```

**Why the old system failed:**

| Check | Against `/v4/np/lnhlsj/seg-1-f1-v1.woff2` | Result |
|-------|-------------------------------------------|--------|
| `VIDEO_EXTENSION_REGEX` | Ends with `.woff2` — not in `m3u8\|mpd\|ts\|...` | ❌ Miss |
| `VIDEO_PATH_REGEX` | No `/movie\|tv\|embed\|watch\|player\|tou/` prefix | ❌ Miss |
| `BASE64_VIDEO_PATH_REGEX` | Path starts with `/v4/` (3 chars, need 20+) | ❌ Miss |
| **Session trust (R0b)** | Never activated because R0 never matched | ❌ Never triggers |

**Result:** The disguised segments fell through R0 → R0b never activated → passed through R1-R3 (no profile match) → reached R4 ADBLOCK_ENGINE → blocked by EasyList pattern matching `urbancreativepoint.site`.

**The chicken-and-egg problem:** Session trust can only help AFTER the first R0 match. If the disguise prevents that first match, the trust system is useless for that host.

## 4. Current Smart System (After Update)

**Immediate fix:** Added `s6p9.urbancreativepoint.site` to `allowedCdnHosts` in `blocklist.json` (served via web API, fetched by app on launch — no rebuild needed).

**Systemic fix:** Added a 4th R0 regex — `DISGUISED_MEDIA_REGEX`:

```kotlin
// Disguised HLS/DASH segments: providers serve video segments with
// non-video extensions (.woff2, .woff, .png, .css, .js) to evade
// adblockers that match on .ts/.m4s/.mp4.
//
// The path still follows HLS packaging conventions: seg-N, init-N,
// chunk-N, or part-N at the end of the URL path.
private val DISGUISED_MEDIA_REGEX = Regex(
  "/(seg|init|chunk|part)(-\\d{1,4})?(-[a-zA-Z0-9]+)*" +
  "\\.(woff2?|png|jpg|jpeg|gif|svg|css|js)(\\?.*)?$"
)
```

**Matching logic is now:**
```kotlin
val r0Path = Uri.parse(url).path?.lowercase() ?: ""
val hasVideoExt = VIDEO_EXTENSION_REGEX.containsMatchIn(r0Path)
val hasStructPath = VIDEO_PATH_REGEX.containsMatchIn(r0Path)
val hasBase64Path = BASE64_VIDEO_PATH_REGEX.containsMatchIn(r0Path)
val hasDisguisedMedia = DISGUISED_MEDIA_REGEX.containsMatchIn(r0Path)
if (hasVideoExt || hasStructPath || hasBase64Path || hasDisguisedMedia) {
  addSessionTrustedHost(r0Host)  // ← session trust now activates
  logRequest("ALLOW", "R0:video-detection", r0Host, ...)
  return null
}
```

**Match/non-match examples:**

| URL | Matches? | Reason |
|-----|----------|--------|
| `/v4/np/lnhlsj/seg-1-f1-v1.woff2` | ✅ | `seg`→`-1`→`-f1-v1`→`.woff2` |
| `/v4/np/lnhlsj/init-f1-a1.woff` | ✅ | `init`→(no digit block)→`-f1-a1`→`.woff` |
| `/cdn/session/chunk-3-video.png` | ✅ | `chunk`→`-3`→`-video`→`.png` |
| `/cdn/session/part-2-data.css` | ✅ | `part`→`-2`→`-data`→`.css` |
| `/fonts/inter/Inter-Regular.woff2` | ❌ | No `seg\|init\|chunk\|part` keyword |
| `/css/main.css` | ❌ | No keyword |
| `/segue-styles.css` | ❌ | `seg` matched but `u` ≠ `-` or digit → regex fails at `.` check |
| `/image/gallery/photo.jpg` | ❌ | No keyword |

**Full R0 system now (all 4 regexes):**

| # | Pattern | Purpose |
|---|---------|---------|
| 1 | `VIDEO_EXTENSION_REGEX` | Standard video extensions (.m3u8, .ts, .mp4, .mpd, .key, .m4s, etc.) |
| 2 | `VIDEO_PATH_REGEX` | Provider-structured paths (/tv/{id}/{s}/{e}/..., /movie/{id}/...) |
| 3 | `BASE64_VIDEO_PATH_REGEX` | Long-base64 session proxy paths (/{40+chars}/{manifest}.{ext}) |
| 4 | `DISGUISED_MEDIA_REGEX` | HLS segment naming structure with non-video extensions (woff2, png, css, etc.) |

## 5. Request for Expert Review

### 5.1 Is the approach correct?

Our strategy is: **detect video by URL path STRUCTURE, not file extension.** The assumption is that HLS/DASH packaging tools produce predictable path patterns (seg-N, init-N, chunk-N, part-N) that are hard for providers to change without modifying their packaging pipeline, whereas file extensions are trivial to swap.

Is this a sound long-term strategy? What weaknesses do you see?

### 5.2 What disguised URL patterns should we expect?

We only have one real-world example so far. What other patterns do providers commonly use to disguise video segments?

Specifically:
- **Extensions used as disguise:** We've seen `.woff2` and `.woff`. What other extensions are common? (e.g., `.js`, `.css`, `.html`, `.xml`, `.json`, `.txt`, `.svg`, `.gif`, `.ico`?)
- **Path structures:** Are there segment naming conventions other than `seg-N` / `init-N` / `chunk-N` / `part-N`?
- **HLS packaging tools:** Which packaging tools commonly produce disguised URLs? (e.g., unified-stream, bitmovin, nginx-rtmp-module?)
- **No-extension URLs:** Do any providers serve segments with NO file extension at all (like `GET /segment/abc123`)?

### 5.3 Anti-adblock escalation

If providers detect that our system matches on path structure, they could start producing URLs like:
```
/s6p9/fonts/Inter-Regular-Normal.woff2?v=123&seg=1
```

Where the segment identifier moves to a query parameter rather than the path. How should we handle:
- Query-parameter-based segment identification?
- Random-length opaque paths (`/aB3xK7mP9...`)?
- CDN proxies that rewrite paths entirely?

### 5.4 Session trust architecture

Currently session trust is a `ConcurrentHashMap<String, Boolean>` within a single WebView session, cleared on provider switch. Should we consider:
- **Multi-provider trust:** A host trusted by one provider is trusted for all (good: handles shared CDNs like CloudFront; bad: if one provider's CDN serves ads for another)?
- **Disk-persistent trust:** Save trusted hosts across app restarts to avoid re-detection cost?
- **Config-pushable trust:** Allow `blocklist.json` to pre-seed trusted hosts so the first request doesn't need regex?

### 5.5 What are we missing?

Are there entire categories of video delivery patterns we haven't addressed? For example:
- **WebSocket-based video** (no HTTP requests to pattern-match)?
- **MSE + in-memory segments** (video data constructed in JS)?
- **Progressive Web Apps with service workers** serving video from cache?
- **WebRTC-based streaming** (peer-to-peer video delivery)?
